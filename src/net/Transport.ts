/**
 * Everything the host and client halves need from the network: send a string to
 * one peer or all of them, and be told when peers come and go.
 *
 * The wire format is transport-agnostic by construction, and this is where that
 * is enforced — the game's messages neither know nor care what carries them.
 */
export interface Transport {
    send(data: string, target?: string): void;
    leave(): void;
    onMessage: ((raw: string, peerId: string) => void) | null;
    onPeerJoin: ((peerId: string) => void) | null;
    onPeerLeave: ((peerId: string) => void) | null;
    /** The link to the LAN server went down or came back. */
    onServerConnection: ((connected: boolean) => void) | null;
}

export interface RoomOptions {
    /** Hosts are listed for joiners to find; clients are not. */
    role: 'host' | 'client';
    name: string;
}

export type TransportFactory = (roomCode: string, options: RoomOptions) => Transport;

/**
 * How soon to retry a dropped socket, doubling up to the cap. On a LAN the
 * server is either there within a moment or not there at all, so this starts
 * fast and stays fast.
 */
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 2000;

/**
 * A room on the LAN server, over a WebSocket to the machine that served this
 * page. The server relays each message to the peer it names, or to everyone
 * else in the room.
 *
 * A dropped socket is reopened by itself. Every peer seen through the old one
 * is reported gone on the way down, and everyone in the room is reported
 * joining again on the way back — under new peer ids, since the server hands
 * out a fresh one per connection. That is exactly what a peer that left and
 * came back looks like, which both halves already handle: the host holds the
 * seat, and a client greets the host as it reappears.
 */
export const lanTransport: TransportFactory = (roomCode, options) => {
    let socket: WebSocket | null = null;
    let peers = new Set<string>();
    let left = false;
    let retryMs = RETRY_FIRST_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const transport: Transport = {
        send(data, target) {
            if (socket === null || socket.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify(target === undefined ? { data } : { to: target, data }));
        },
        leave() {
            left = true;
            if (retryTimer !== null) clearTimeout(retryTimer);
            transport.onMessage = null;
            transport.onPeerJoin = null;
            transport.onPeerLeave = null;
            transport.onServerConnection = null;
            socket?.close(1000, 'leave');
            socket = null;
        },
        onMessage: null,
        onPeerJoin: null,
        onPeerLeave: null,
        onServerConnection: null,
    };

    function open(): void {
        const query = new URLSearchParams({ room: roomCode, role: options.role, name: options.name });
        const ws = new WebSocket(`${serverSocketBase()}/net?${query.toString()}`);
        socket = ws;
        let wasOpen = false;

        ws.onopen = () => {
            wasOpen = true;
            retryMs = RETRY_FIRST_MS;
            transport.onServerConnection?.(true);
        };

        ws.onmessage = (event) => {
            if (typeof event.data !== 'string') return;
            let frame: ServerFrame;
            try {
                frame = JSON.parse(event.data) as ServerFrame;
            } catch {
                return;
            }
            switch (frame.op) {
                case 'peers':
                    for (const peerId of frame.peers) {
                        peers.add(peerId);
                        transport.onPeerJoin?.(peerId);
                    }
                    break;
                case 'join':
                    peers.add(frame.peer);
                    transport.onPeerJoin?.(frame.peer);
                    break;
                case 'leave':
                    if (peers.delete(frame.peer)) transport.onPeerLeave?.(frame.peer);
                    break;
                case 'msg':
                    transport.onMessage?.(frame.data, frame.from);
                    break;
            }
        };

        ws.onclose = () => {
            if (socket !== ws) return;
            socket = null;
            // Everyone reached through this socket is out of reach now.
            const lost = peers;
            peers = new Set();
            for (const peerId of lost) transport.onPeerLeave?.(peerId);
            if (left) return;
            if (wasOpen) transport.onServerConnection?.(false);
            retryTimer = setTimeout(open, retryMs);
            retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
        };
    }

    open();
    return transport;
};

type ServerFrame =
    | { op: 'peers'; self: string; peers: string[] }
    | { op: 'join'; peer: string }
    | { op: 'leave'; peer: string }
    | { op: 'msg'; from: string; data: string };

/** The LAN server is whatever served this page. */
function serverSocketBase(): string {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${window.location.host}`;
}

// ── Server info ───────────────────────────────────────────────────────────────

export interface OpenRoom {
    code: string;
    /** The host's name, as the roster shows it. */
    host: string;
    players: number;
}

export interface LanInfo {
    /** Addresses other devices can reach this server on, best first. */
    urls: string[];
    rooms: OpenRoom[];
}

/**
 * Ask the server for its addresses and open rooms. Null means this page was not
 * served by the LAN server — opened from a file, or from the static site —
 * and there is nobody to play with.
 */
export async function fetchLanInfo(timeoutMs = 2000): Promise<LanInfo | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch('lan.json', { cache: 'no-store', signal: controller.signal });
        if (!res.ok) return null;
        const body = await res.json() as Partial<LanInfo> & { lan?: unknown };
        if (body.lan !== true) return null;
        return {
            urls: Array.isArray(body.urls) ? body.urls : [],
            rooms: Array.isArray(body.rooms) ? body.rooms : [],
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The address to tell other players to open. The page's own address works
 * unless it is this machine's loopback, which means nothing to anyone else.
 */
export function shareableUrl(info: LanInfo | null): string {
    const host = window.location.hostname;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (!loopback) return `${window.location.protocol}//${window.location.host}`;
    return info?.urls[0] ?? `${window.location.protocol}//${window.location.host}`;
}
