// LAN server for co-op play.
//
// One machine on the network runs this. It does two jobs:
//
// - serves the built game over HTTP, so every device opens the same build from
//   the same place and nobody can be on a stale version;
// - relays game messages between the players in a room over WebSockets.
//
// It runs no game logic. The host's browser still simulates and every other
// browser still renders — this only carries the messages, which is what the
// public WebRTC relays and NAT traversal used to do, badly, for a room that was
// sitting on one network all along.
//
// Usage:  npm run lan            (builds, then serves on port 8080)
//         PORT=9000 npm run lan

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname, '..');

// Only what the game needs is served. Anything else in the repo — the server
// itself, node_modules, .git — stays off the network.
const SERVED = [/^\/index\.html$/, /^\/debug\.html$/, /^\/dist\/[\w.-]+\.js$/, /^\/assets\/[\w./-]+$/];

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

/**
 * Silence before a socket is declared dead. A closed tab closes its socket at
 * once; this is for the ones that vanish without a word — a phone locked
 * mid-game, a laptop lid, Wi-Fi dropping out — which TCP alone can take
 * minutes to notice.
 */
const PING_INTERVAL_MS = 2000;

// ── Addresses ────────────────────────────────────────────────────────────────

/**
 * This machine's LAN addresses, best guess first. Home networks are almost
 * always 192.168.x.x; 10.x and 172.16-31.x are more often VPNs and container
 * bridges, which a phone on the same Wi-Fi cannot reach.
 */
function lanAddresses() {
    const found = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const iface of list ?? []) {
            if (iface.family === 'IPv4' && !iface.internal) found.push(iface.address);
        }
    }
    const rank = (ip) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2;
    return found.sort((a, b) => rank(a) - rank(b));
}

function lanUrls() {
    return lanAddresses().map(ip => `http://${ip}${PORT === 80 ? '' : `:${PORT}`}`);
}

// ── Rooms ────────────────────────────────────────────────────────────────────
//
// A room is the players on one lobby code. The relay mirrors what the game's
// transport expects of a room: everyone is told who else is there, who arrives
// and who leaves, and a message goes to one peer or to all the others.

/** code → Map<peerId, { ws, role, name }> */
const rooms = new Map();
let nextPeer = 1;

/** Rooms someone is hosting, for a joiner to find without typing a code. */
function openRooms() {
    const list = [];
    for (const [code, peers] of rooms) {
        const host = [...peers.values()].find(p => p.role === 'host');
        if (host !== undefined) list.push({ code, host: host.name, players: peers.size });
    }
    return list;
}

function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function joinRoom(ws, code, role, name) {
    const peerId = `p${nextPeer++}`;
    let peers = rooms.get(code);
    if (peers === undefined) {
        peers = new Map();
        rooms.set(code, peers);
    }

    // Tell the newcomer who is already here, then tell them about the newcomer.
    send(ws, { op: 'peers', self: peerId, peers: [...peers.keys()] });
    for (const other of peers.values()) send(other.ws, { op: 'join', peer: peerId });

    peers.set(peerId, { ws, role, name });
    log(`${role} ${name || '?'} joined room ${code} (${peers.size} in room)`);
    return peerId;
}

function leaveRoom(code, peerId) {
    const peers = rooms.get(code);
    if (peers === undefined || !peers.has(peerId)) return;
    const { role, name } = peers.get(peerId);
    peers.delete(peerId);
    for (const other of peers.values()) send(other.ws, { op: 'leave', peer: peerId });
    if (peers.size === 0) rooms.delete(code);
    log(`${role} ${name || '?'} left room ${code} (${peers.size} in room)`);
}

function relay(code, from, to, data) {
    const peers = rooms.get(code);
    if (peers === undefined) return;
    const frame = JSON.stringify({ op: 'msg', from, data });
    if (typeof to === 'string') {
        const target = peers.get(to);
        if (target !== undefined && target.ws.readyState === target.ws.OPEN) target.ws.send(frame);
        return;
    }
    for (const [peerId, peer] of peers) {
        if (peerId !== from && peer.ws.readyState === peer.ws.OPEN) peer.ws.send(frame);
    }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    // The game asks this to find out it is on a LAN server at all, where to
    // tell other players to go, and which rooms are open to join.
    if (pathname === '/lan.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ lan: true, urls: lanUrls(), rooms: openRooms() }));
        return;
    }

    if (pathname === '/') pathname = '/index.html';
    if (!SERVED.some(re => re.test(pathname)) || pathname.includes('..')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    const file = path.join(ROOT, pathname);
    fs.readFile(file, (err, body) => {
        if (err !== null) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
            // Every device must run the build this server has. A cached page
            // from an earlier build is exactly the version skew the handshake
            // refuses, so never let one be kept.
            'Cache-Control': 'no-cache',
        });
        res.end(body);
    });
});

// ── WebSocket relay ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/net', maxPayload: 1 << 20 });

wss.on('connection', (ws, req) => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const code = params.get('room') ?? '';
    const role = params.get('role') === 'host' ? 'host' : 'client';
    const name = (params.get('name') ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();

    if (!/^[0-9]{6}$/.test(code)) {
        ws.close(4000, 'bad room code');
        return;
    }

    // Snapshots are small and frequent; Nagle's algorithm would batch them into
    // visible stutter. ws turns it off already — this says so on purpose.
    req.socket.setNoDelay(true);

    const peerId = joinRoom(ws, code, role, name);
    let alive = true;
    ws.on('pong', () => { alive = true; });

    const pinger = setInterval(() => {
        if (!alive) {
            log(`${role} ${name || '?'} in room ${code} stopped answering`);
            ws.terminate();
            return;
        }
        alive = false;
        ws.ping();
    }, PING_INTERVAL_MS);

    ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }
        if (msg === null || typeof msg !== 'object' || typeof msg.data !== 'string') return;
        relay(code, peerId, typeof msg.to === 'string' ? msg.to : undefined, msg.data);
    });

    ws.on('close', () => {
        clearInterval(pinger);
        leaveRoom(code, peerId);
    });
    ws.on('error', () => { /* close follows */ });
});

// ── Start ────────────────────────────────────────────────────────────────────

function log(line) {
    const time = new Date().toTimeString().slice(0, 8);
    console.log(`[${time}] ${line}`);
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try another: PORT=8081 npm run lan`);
    } else {
        console.error(err);
    }
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
    if (!fs.existsSync(path.join(ROOT, 'dist'))) {
        console.warn('No dist/ folder — run `npm run build` first, or use `npm run lan`.');
    }
    const urls = lanUrls();
    console.log('');
    console.log('  Dot Maze LAN server');
    console.log('');
    console.log(`  On this machine:   http://localhost${PORT === 80 ? '' : `:${PORT}`}`);
    for (const url of urls) console.log(`  On the network:    ${url}`);
    if (urls.length === 0) console.log('  No network address found — is this machine on Wi-Fi or Ethernet?');
    console.log('');
    console.log('  Everyone opens the same address, one player picks HOST LAN GAME,');
    console.log('  the rest pick JOIN LAN GAME. Ctrl+C to stop.');
    console.log('');
});
