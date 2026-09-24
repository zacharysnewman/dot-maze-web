import type { Transport } from './Transport';
import type { SignalBlob } from './Signal';
import { blobFromSdp, randomPairId, sdpFromBlob } from './Signal';

/**
 * WebRTC connections set up by QR code: the host shows an offer, a joiner
 * scans it and shows an answer, the host scans that, and the two connect
 * directly over the local network — with no internet and no server at all.
 *
 * Devices usually need a signalling server to swap these details; on one
 * network they can already reach each other, so the codes are enough.
 *
 * No STUN servers: on one network every device is reachable by its own
 * address, and with no internet a STUN request only delays gathering.
 */
const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

/**
 * How long to wait for addresses before giving up on more. On one network a
 * browser has its host addresses in a few milliseconds; this only bounds a
 * browser that never reports gathering complete.
 */
const GATHER_TIMEOUT_MS = 2500;

/** A scanned answer that has not produced a connection by now never will. */
const CONNECT_TIMEOUT_MS = 20_000;

function gathered(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
        pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
        });
    });
}

export type AnswerResult = 'connecting' | 'stale' | 'unusable';

interface HostLink {
    peerId: string;
    pairId: number;
    pc: RTCPeerConnection;
    channel: RTCDataChannel;
    open: boolean;
    connectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * The host's side: always one offer ready to be shown, and a connection per
 * joiner who answered one.
 *
 * An offer is single-use — it belongs to one peer connection — so as soon as
 * one is answered the next is prepared, and the QR code on screen moves on to
 * it. That is why answers carry the offer's pair id: two joiners scanning the
 * same code both answer it, and the second is told to scan again rather than
 * being applied to a connection that is already taken.
 */
export class HostPairing implements Transport {
    onMessage: ((raw: string, peerId: string) => void) | null = null;
    onPeerJoin: ((peerId: string) => void) | null = null;
    onPeerLeave: ((peerId: string) => void) | null = null;
    /** The offer to show changed — prepared, or used up. */
    onOfferChange: ((offer: SignalBlob | null) => void) | null = null;

    private pending: { link: HostLink; offer: SignalBlob } | null = null;
    private readonly links = new Map<string, HostLink>();
    private nextPeer = 1;
    private closed = false;

    constructor() {
        void this.prepareOffer();
    }

    /** The offer to put in the QR code, or null while one is being prepared. */
    currentOffer(): SignalBlob | null {
        return this.pending?.offer ?? null;
    }

    /** Apply a scanned answer to the offer it names. */
    async acceptAnswer(answer: SignalBlob): Promise<AnswerResult> {
        const pending = this.pending;
        if (pending === null || answer.pairId !== pending.offer.pairId) return 'stale';
        this.pending = null;
        this.onOfferChange?.(null);
        const { link } = pending;
        try {
            await link.pc.setRemoteDescription({ type: 'answer', sdp: sdpFromBlob(answer) });
        } catch {
            this.drop(link);
            void this.prepareOffer();
            return 'unusable';
        }
        this.links.set(link.peerId, link);
        link.connectTimer = setTimeout(() => { if (!link.open) this.drop(link); }, CONNECT_TIMEOUT_MS);
        // The next joiner should not have to wait for this one to finish.
        void this.prepareOffer();
        return 'connecting';
    }

    send(data: string, target?: string): void {
        for (const link of this.links.values()) {
            if (!link.open || (target !== undefined && link.peerId !== target)) continue;
            try { link.channel.send(data); } catch { /* closing; its leave is on its way */ }
        }
    }

    leave(): void {
        this.closed = true;
        this.onMessage = null;
        this.onPeerJoin = null;
        this.onPeerLeave = null;
        this.onOfferChange = null;
        if (this.pending !== null) this.pending.link.pc.close();
        this.pending = null;
        for (const link of this.links.values()) link.pc.close();
        this.links.clear();
    }

    private async prepareOffer(): Promise<void> {
        if (this.closed) return;
        const pc = new RTCPeerConnection(RTC_CONFIG);
        const channel = pc.createDataChannel('net', { ordered: true });
        const link: HostLink = {
            peerId: `p${this.nextPeer++}`, pairId: randomPairId(), pc, channel, open: false, connectTimer: null,
        };

        channel.onopen = () => {
            if (this.closed || !this.links.has(link.peerId)) return;
            link.open = true;
            if (link.connectTimer !== null) clearTimeout(link.connectTimer);
            this.onPeerJoin?.(link.peerId);
        };
        channel.onmessage = (e) => {
            if (typeof e.data === 'string') this.onMessage?.(e.data, link.peerId);
        };
        channel.onclose = () => this.drop(link);
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(link);
        };

        try {
            await pc.setLocalDescription(await pc.createOffer());
            await gathered(pc);
        } catch {
            pc.close();
            return;
        }
        const offer = pc.localDescription === null ? null : blobFromSdp(pc.localDescription.sdp, 'offer', link.pairId);
        if (this.closed || offer === null) {
            pc.close();
            return;
        }
        this.pending = { link, offer };
        this.onOfferChange?.(offer);
    }

    private drop(link: HostLink): void {
        if (link.connectTimer !== null) clearTimeout(link.connectTimer);
        const wasOpen = link.open;
        link.open = false;
        const known = this.links.delete(link.peerId);
        link.pc.close();
        if (known && wasOpen) this.onPeerLeave?.(link.peerId);
    }
}

/** The one peer a joiner's pairing connects to. */
export const PAIRED_HOST = 'host';

/**
 * The joiner's side: answer one offer, and hold the connection that comes of
 * it.
 *
 * The connection is separate from the `Transport` view the client talks
 * through: a connection that took two QR scans to set up is only ended by
 * `close`, never by a view being dropped.
 */
export class ClientPairing {
    /** The answer to show the host, once it is ready; null if it cannot be made. */
    readonly answer: Promise<SignalBlob | null>;

    private readonly pc = new RTCPeerConnection(RTC_CONFIG);
    private channel: RTCDataChannel | null = null;
    private open = false;
    private view: Transport | null = null;
    private closed = false;

    constructor(offer: SignalBlob) {
        this.pc.ondatachannel = (e) => {
            this.channel = e.channel;
            e.channel.onopen = () => {
                this.open = true;
                this.view?.onPeerJoin?.(PAIRED_HOST);
            };
            e.channel.onmessage = (m) => {
                if (typeof m.data === 'string') this.view?.onMessage?.(m.data, PAIRED_HOST);
            };
            e.channel.onclose = () => this.lost();
        };
        this.pc.onconnectionstatechange = () => {
            if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') this.lost();
        };
        this.answer = this.makeAnswer(offer);
    }

    get connected(): boolean {
        return this.open;
    }

    /** A transport over this connection, for the client to use until it rebuilds. */
    attach(): Transport {
        const view: Transport = {
            send: (data, target) => {
                if (this.view !== view || !this.open || (target !== undefined && target !== PAIRED_HOST)) return;
                try { this.channel?.send(data); } catch { /* closing */ }
            },
            leave: () => {
                if (this.view === view) this.view = null;
            },
            onMessage: null,
            onPeerJoin: null,
            onPeerLeave: null,
        };
        this.view = view;
        // Already connected: say so once the caller has wired up its handlers.
        if (this.open) setTimeout(() => { if (this.view === view && this.open) view.onPeerJoin?.(PAIRED_HOST); }, 0);
        return view;
    }

    close(): void {
        this.closed = true;
        this.view = null;
        this.pc.close();
    }

    private lost(): void {
        if (!this.open) return;
        this.open = false;
        this.view?.onPeerLeave?.(PAIRED_HOST);
    }

    private async makeAnswer(offer: SignalBlob): Promise<SignalBlob | null> {
        try {
            await this.pc.setRemoteDescription({ type: 'offer', sdp: sdpFromBlob(offer) });
            await this.pc.setLocalDescription(await this.pc.createAnswer());
            await gathered(this.pc);
        } catch {
            return null;
        }
        if (this.closed || this.pc.localDescription === null) return null;
        return blobFromSdp(this.pc.localDescription.sdp, 'answer', offer.pairId);
    }
}
