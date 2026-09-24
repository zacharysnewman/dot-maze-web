/**
 * Connection details, small enough for a QR code.
 *
 * Two browsers opening a WebRTC connection must each tell the other four
 * things: an ICE username and password (which sign the connectivity checks),
 * the fingerprint of their DTLS certificate (which the encrypted connection is
 * checked against), and the addresses to try. Everything else in a session
 * description is boilerplate for a data channel, identical every time.
 *
 * So instead of shipping the 600-byte SDP, pack those four things into roughly
 * eighty bytes, carry them in a link, and rebuild a valid SDP on arrival. A QR
 * code carries the link — which is how devices on one network connect with no
 * internet and no server at all.
 */

/** Which half of the exchange a blob is. */
export type SignalKind = 'offer' | 'answer';

export interface SignalBlob {
    kind: SignalKind;
    /**
     * Ties an answer to the offer it answers. A host keeps one offer open at a
     * time, and two joiners can scan the same one; the second answer then names
     * an offer that is gone, and is refused rather than wrecking the first.
     */
    pairId: number;
    ufrag: string;
    pwd: string;
    /** SHA-256 certificate fingerprint, 32 bytes. */
    fingerprint: Uint8Array;
    setup: 'actpass' | 'active' | 'passive';
    candidates: SignalCandidate[];
}

export interface SignalCandidate {
    /** An IPv4 or IPv6 address, or a browser's `<uuid>.local` mDNS name. */
    address: string;
    port: number;
}

const FORMAT_VERSION = 1;
const SETUPS = ['actpass', 'active', 'passive'] as const;
const ADDR_IPV4 = 0, ADDR_IPV6 = 1, ADDR_MDNS = 2;
/** Enough for every interface a phone or laptop really has; the rest is noise. */
const MAX_CANDIDATES = 4;

// ── From and to SDP ───────────────────────────────────────────────────────────

/**
 * Pull the essentials out of a browser's session description. Null when there
 * is something here that cannot be carried — a fingerprint that is not SHA-256,
 * or no usable address — which is a reason to say so rather than to send a
 * blob that can never connect.
 */
export function blobFromSdp(sdp: string, kind: SignalKind, pairId: number): SignalBlob | null {
    const line = (prefix: string): string | null => {
        const found = sdp.split(/\r?\n/).find(l => l.startsWith(prefix));
        return found === undefined ? null : found.slice(prefix.length).trim();
    };

    const ufrag = line('a=ice-ufrag:');
    const pwd = line('a=ice-pwd:');
    const fp = line('a=fingerprint:');
    const setup = line('a=setup:');
    if (ufrag === null || pwd === null || fp === null || setup === null) return null;

    const [alg, hex] = fp.split(' ');
    if (alg.toLowerCase() !== 'sha-256' || hex === undefined) return null;
    const fingerprint = new Uint8Array(hex.split(':').map(h => parseInt(h, 16)));
    if (fingerprint.length !== 32 || fingerprint.some(Number.isNaN)) return null;
    if (!(SETUPS as readonly string[]).includes(setup)) return null;

    const candidates: SignalCandidate[] = [];
    for (const l of sdp.split(/\r?\n/)) {
        if (!l.startsWith('a=candidate:')) continue;
        // foundation component transport priority address port typ type ...
        const parts = l.slice('a=candidate:'.length).split(' ');
        if (parts.length < 8 || parts[2].toLowerCase() !== 'udp' || parts[1] !== '1') continue;
        const address = parts[4];
        const port = Number(parts[5]);
        if (addressKind(address) === null || !(port > 0 && port < 65536)) continue;
        if (candidates.some(c => c.address === address && c.port === port)) continue;
        candidates.push({ address, port });
        if (candidates.length === MAX_CANDIDATES) break;
    }
    if (candidates.length === 0) return null;

    return { kind, pairId, ufrag, pwd, fingerprint, setup: setup as SignalBlob['setup'], candidates };
}

/**
 * A complete data-channel session description from the essentials. The
 * boilerplate is what every browser puts in a data-channel-only description;
 * the priorities are the ones for a host candidate, so each address is tried
 * as what it is.
 */
export function sdpFromBlob(blob: SignalBlob): string {
    const fingerprint = Array.from(blob.fingerprint, b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
    const lines = [
        'v=0',
        `o=- ${blob.pairId} 2 IN IP4 127.0.0.1`,
        's=-',
        't=0 0',
        'a=group:BUNDLE 0',
        'a=msid-semantic: WMS',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        ...blob.candidates.map((c, i) =>
            `a=candidate:${i + 1} 1 udp ${2113937151 - i} ${c.address} ${c.port} typ host`),
        'a=end-of-candidates',
        `a=ice-ufrag:${blob.ufrag}`,
        `a=ice-pwd:${blob.pwd}`,
        `a=fingerprint:sha-256 ${fingerprint}`,
        `a=setup:${blob.setup}`,
        'a=mid:0',
        'a=sctp-port:5000',
        'a=max-message-size:262144',
    ];
    return lines.join('\r\n') + '\r\n';
}

// ── Binary packing ────────────────────────────────────────────────────────────

/** Pack a blob into URL-safe base64, about 110 characters for one candidate. */
export function packBlob(blob: SignalBlob): string {
    const bytes: number[] = [];
    bytes.push((FORMAT_VERSION << 4) | (blob.kind === 'answer' ? 8 : 0) | SETUPS.indexOf(blob.setup));
    bytes.push((blob.pairId >>> 24) & 255, (blob.pairId >>> 16) & 255, (blob.pairId >>> 8) & 255, blob.pairId & 255);
    pushString(bytes, blob.ufrag);
    pushString(bytes, blob.pwd);
    bytes.push(...blob.fingerprint);
    bytes.push(blob.candidates.length);
    for (const c of blob.candidates) {
        const kind = addressKind(c.address);
        bytes.push(kind ?? ADDR_IPV4);
        if (kind === ADDR_IPV4) bytes.push(...c.address.split('.').map(Number));
        else if (kind === ADDR_IPV6) bytes.push(...ipv6Bytes(c.address));
        else bytes.push(...uuidBytes(c.address.slice(0, -'.local'.length)));
        bytes.push((c.port >> 8) & 255, c.port & 255);
    }
    return toBase64Url(new Uint8Array(bytes));
}

/** The reverse of `packBlob`; null for anything malformed or from another format. */
export function unpackBlob(text: string): SignalBlob | null {
    try {
        const bytes = fromBase64Url(text);
        let at = 0;
        const take = (n: number): Uint8Array => {
            if (at + n > bytes.length) throw new Error('short');
            const out = bytes.subarray(at, at + n);
            at += n;
            return out;
        };
        const head = take(1)[0];
        if (head >> 4 !== FORMAT_VERSION) return null;
        const setup = SETUPS[head & 3];
        if (setup === undefined) return null;
        const kind: SignalKind = (head & 8) !== 0 ? 'answer' : 'offer';
        const id = take(4);
        const pairId = ((id[0] << 24) | (id[1] << 16) | (id[2] << 8) | id[3]) >>> 0;
        const ufrag = takeString(take);
        const pwd = takeString(take);
        const fingerprint = Uint8Array.from(take(32));
        const count = take(1)[0];
        const candidates: SignalCandidate[] = [];
        for (let i = 0; i < count; i++) {
            const addrKind = take(1)[0];
            let address: string;
            if (addrKind === ADDR_IPV4) address = Array.from(take(4)).join('.');
            else if (addrKind === ADDR_IPV6) address = ipv6String(take(16));
            else if (addrKind === ADDR_MDNS) address = `${uuidString(take(16))}.local`;
            else return null;
            const p = take(2);
            candidates.push({ address, port: (p[0] << 8) | p[1] });
        }
        if (at !== bytes.length || candidates.length === 0) return null;
        return { kind, pairId, ufrag, pwd, fingerprint, setup, candidates };
    } catch {
        return null;
    }
}

export function randomPairId(): number {
    return crypto.getRandomValues(new Uint32Array(1))[0];
}

// ── Links ─────────────────────────────────────────────────────────────────────
//
// Every QR code the game shows is a link to the game. A phone's own camera app
// opens it; the in-game scanner reads the same link and never leaves the page.
// The details ride in the fragment, which browsers never send to the server.

/** The address of this game, without whatever query or fragment it was opened with. */
function gameBase(): string {
    return `${window.location.origin}${window.location.pathname}`;
}

/** The host's invitation: open it, and the game starts joining. */
export function joinLinkUrl(offer: SignalBlob): string {
    return `${gameBase()}?multiplayer#o=${packBlob(offer)}`;
}

export function answerLinkUrl(answer: SignalBlob): string {
    return `${gameBase()}?multiplayer#a=${packBlob(answer)}`;
}

/** Read a join link, from the page's own address or a scanned QR code. */
export function parseJoinLink(url: string): SignalBlob | null {
    const text = fragmentParams(url)?.get('o') ?? null;
    if (text === null) return null;
    const blob = unpackBlob(text);
    return blob !== null && blob.kind === 'offer' ? blob : null;
}

/** Read an answer link — a joiner's reply, scanned by the host. */
export function parseAnswerLink(url: string): SignalBlob | null {
    const params = fragmentParams(url);
    const text = params?.get('a') ?? null;
    if (text === null) return null;
    const blob = unpackBlob(text);
    return blob !== null && blob.kind === 'answer' ? blob : null;
}

function fragmentParams(url: string): URLSearchParams | null {
    const hash = url.indexOf('#');
    if (hash < 0) return null;
    return new URLSearchParams(url.slice(hash + 1));
}

// ── Byte helpers ──────────────────────────────────────────────────────────────

function addressKind(address: string): number | null {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return ADDR_IPV4;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i.test(address)) return ADDR_MDNS;
    if (address.includes(':') && /^[0-9a-f:]+$/i.test(address)) return ADDR_IPV6;
    return null;
}

function pushString(bytes: number[], text: string): void {
    const encoded = new TextEncoder().encode(text);
    bytes.push(encoded.length, ...encoded);
}

function takeString(take: (n: number) => Uint8Array): string {
    const length = take(1)[0];
    return new TextDecoder().decode(take(length));
}

function uuidBytes(uuid: string): number[] {
    const hex = uuid.replace(/-/g, '');
    const out: number[] = [];
    for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
}

function uuidString(bytes: Uint8Array): string {
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function ipv6Bytes(address: string): number[] {
    const [head, tail] = address.split('::');
    const headParts = head === '' ? [] : head.split(':');
    const tailParts = tail === undefined || tail === '' ? [] : tail.split(':');
    const missing = 8 - headParts.length - tailParts.length;
    const groups = [...headParts, ...Array(tail === undefined ? 0 : missing).fill('0'), ...tailParts];
    const out: number[] = [];
    for (const g of groups) {
        const n = parseInt(g, 16);
        out.push((n >> 8) & 255, n & 255);
    }
    return out;
}

function ipv6String(bytes: Uint8Array): string {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    return groups.join(':');
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}
