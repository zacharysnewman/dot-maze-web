/**
 * Everything the host and client halves need from the network: send a string to
 * one peer or all of them, and be told when peers come and go.
 *
 * The wire format is transport-agnostic by construction, and this is where that
 * is enforced. The one implementation is WebRTC set up by QR code — see
 * `Pairing.ts` — but nothing in the protocol knows that.
 */
export interface Transport {
    send(data: string, target?: string): void;
    leave(): void;
    onMessage: ((raw: string, peerId: string) => void) | null;
    onPeerJoin: ((peerId: string) => void) | null;
    onPeerLeave: ((peerId: string) => void) | null;
}
