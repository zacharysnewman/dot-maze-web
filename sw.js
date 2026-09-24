// Offline copy of the game.
//
// QR pairing connects devices with no internet at all, but only if the game
// itself can load with no internet — so every visit keeps a copy, and a device
// that has opened the game once can open it again anywhere.
//
// Network first: online, every request goes to the network as it always has,
// so nobody is ever held on an old build; the copy is only for when the
// network is not there. The page caches its own current files on each load
// (see `cacheForOffline` in src/Game.ts), and this answers from that cache
// when a fetch fails.

const CACHE = 'dot-maze-offline-v1';

/**
 * A Wi-Fi network with no internet behind it can leave a request hanging
 * rather than failing. Past this, answer from the cache — the network request
 * carries on and refreshes the copy if it ever lands.
 */
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    if (new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    const network = fetch(request).then((response) => {
        // Whole files only: a 206 is one slice of the music, not the file.
        if (response.status === 200 && !request.headers.has('range')) {
            void cache.put(request, response.clone());
        }
        return response;
    });
    try {
        return await withTimeout(network, NETWORK_TIMEOUT_MS);
    } catch {
        const cached = await fromCache(cache, request);
        if (cached !== null) return cached;
        return network; // nothing cached: let the real failure through
    }
}

async function fromCache(cache, request) {
    let hit = await cache.match(request, { ignoreSearch: true });
    // Any address of the game's page — with ?multiplayer, from a QR link —
    // is the same page.
    if (hit === undefined && request.mode === 'navigate') {
        hit = await cache.match(new URL('index.html', self.registration.scope).href);
    }
    if (hit === undefined) return null;
    const range = request.headers.get('range');
    return range === null ? hit : sliceForRange(hit, range);
}

/**
 * Media elements fetch in ranges, and Safari will not play a file answered
 * with the whole thing when it asked for a slice. Cut the slice out of the
 * cached copy.
 */
async function sliceForRange(response, range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const body = await response.arrayBuffer();
    if (match === null || (match[1] === '' && match[2] === '')) {
        return new Response(body, { status: 200, headers: response.headers });
    }
    const size = body.byteLength;
    let start = match[1] === '' ? size - Number(match[2]) : Number(match[1]);
    let end = match[1] !== '' && match[2] !== '' ? Number(match[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    const headers = new Headers(response.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(body.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (err) => { clearTimeout(timer); reject(err); },
        );
    });
}
