import { joinRoom } from 'trystero';
import { APP_ID, NET_ACTION } from './Protocol';

/**
 * Everything the host and client halves need from the network: send a string to
 * one peer or all of them, and be told when peers come and go.
 *
 * The wire format is transport-agnostic by construction, and this is where that
 * is enforced — swapping Trystero for a WebSocket relay (the escape hatch if
 * NAT traversal proves too lossy without TURN) is a new implementation of this
 * interface and nothing else.
 */
export interface Transport {
    send(data: string, target?: string): void;
    leave(): void;
    onMessage: ((raw: string, peerId: string) => void) | null;
    onPeerJoin: ((peerId: string) => void) | null;
    onPeerLeave: ((peerId: string) => void) | null;
}

export type TransportFactory = (roomCode: string) => Transport;

/**
 * Serverless WebRTC, with the lobby code used directly as the room id — so
 * there is no code allocation, no collision table and no TTL, because there is
 * no server holding any of them.
 */
/**
 * Signalling relays to use instead of the public defaults, from `?relay=` on
 * the URL. Two uses: pointing a private group at their own relay, which is the
 * documented escape hatch, and pointing a test at a local one.
 */
function relayOverride(): string[] | null {
    const param = new URLSearchParams(window.location.search).get('relay');
    return param === null || param.length === 0 ? null : param.split(',');
}

export const trysteroTransport: TransportFactory = (roomCode) => {
    const urls = relayOverride();
    const room = joinRoom(urls === null ? { appId: APP_ID } : { appId: APP_ID, relayConfig: { urls } }, roomCode);
    const action = room.makeAction<string>(NET_ACTION);

    const transport: Transport = {
        send(data, target) {
            void action.send(data, target === undefined ? undefined : { target });
        },
        leave() {
            room.onPeerJoin = null;
            room.onPeerLeave = null;
            action.onMessage = null;
            void room.leave();
        },
        onMessage: null,
        onPeerJoin: null,
        onPeerLeave: null,
    };

    action.onMessage = (raw, context) => transport.onMessage?.(raw, context.peerId);
    room.onPeerJoin  = (peerId) => transport.onPeerJoin?.(peerId);
    room.onPeerLeave = (peerId) => transport.onPeerLeave?.(peerId);

    return transport;
};
