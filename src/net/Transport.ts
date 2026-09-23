import { getRelaySockets, joinRoom } from 'trystero';
import type { JoinRoomCallbacks, MessageAction, Room } from 'trystero';
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

/**
 * The signalling relays every device uses. Signalling is only how two devices
 * on the same Wi-Fi find each other; once they have, traffic goes directly
 * between them and no relay is involved. But finding each other is where
 * joins stalled.
 *
 * Left to itself Trystero derives five relays from the app id, out of its list
 * of small public ones — for this app a Raspberry Pi, a relay named
 * "testrelay" and three more of similar size. Every game depended on those
 * five, so two or three being down or rate-limiting was enough to make a join
 * crawl or fail.
 *
 * Now every device announces on all of these, and two devices meet as long as
 * any one relay works for both:
 *
 * - The first group are large, long-running relays that accept the ephemeral
 *   events Trystero signals with.
 * - The second group are the five Trystero picked before, pinned here rather
 *   than derived, so a device still on an older build — which only speaks to
 *   those — can still find a host on this one, and so a Trystero upgrade that
 *   reshuffles its list cannot quietly move everyone.
 *
 * A relay that refuses Trystero's events is retired by Trystero on the spot,
 * so a bad entry costs one wasted socket, not a failed join.
 */
export const SIGNALLING_RELAYS: readonly string[] = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr.mom',
    'wss://relay.nostr.net',
    'wss://offchain.pub',

    'wss://relay-rpi.edufeed.org',
    'wss://purplerelay.com',
    'wss://schnorr.me',
    'wss://relay.mostr.pub',
    'wss://top.testrelay.top',
];

/**
 * How many signalling relays this device has an open connection to right now.
 * Zero means nobody can find this device, which is worth saying on screen
 * rather than leaving a player to wonder why nothing happens.
 */
export function openRelayCount(): number {
    const sockets = getRelaySockets() as Record<string, WebSocket | undefined>;
    return Object.values(sockets).filter(ws => ws?.readyState === WebSocket.OPEN).length;
}

/**
 * Join the room the game uses, configured the way the game configures it.
 * Separate from the transport below so a diagnostic can join exactly what a
 * player joins and still reach the room handle — nothing is worth measuring if
 * the measurement sets up its own connection differently.
 */
export function joinGameRoom(roomCode: string, callbacks?: JoinRoomCallbacks): Room {
    const urls = relayOverride() ?? [...SIGNALLING_RELAYS];
    return joinRoom(
        { appId: APP_ID, relayConfig: { urls } },
        roomCode,
        callbacks,
    );
}

/**
 * Rooms on their way out, by code. Trystero's `leave()` takes a tenth of a
 * second or so before it forgets the room, and until then `joinRoom` on the
 * same code hands back that same departing room rather than a new one — which
 * then finishes leaving underneath whoever just joined it. Reconnecting and
 * retrying a join both leave and rejoin one code back to back, so a join
 * waits here for the previous leave of its code to finish.
 */
const leaving = new Map<string, Promise<void>>();

export const trysteroTransport: TransportFactory = (roomCode) => {
    let room: Room | null = null;
    let action: MessageAction<string> | null = null;
    let left = false;

    const transport: Transport = {
        send(data, target) {
            // Nothing is sent before a peer has joined, and no peer can join
            // before the room exists, so there is nothing to queue.
            if (action === null) return;
            void action.send(data, target === undefined ? undefined : { target });
        },
        leave() {
            if (left) return;
            left = true;
            if (room === null) return; // still waiting to join; open() sees `left`
            room.onPeerJoin = null;
            room.onPeerLeave = null;
            if (action !== null) action.onMessage = null;
            const done = room.leave().catch(() => undefined);
            leaving.set(roomCode, done);
            void done.then(() => {
                if (leaving.get(roomCode) === done) leaving.delete(roomCode);
            });
        },
        onMessage: null,
        onPeerJoin: null,
        onPeerLeave: null,
    };

    const open = (): void => {
        if (left) return;
        room = joinGameRoom(roomCode);
        const netAction = room.makeAction<string>(NET_ACTION);
        action = netAction;
        netAction.onMessage = (raw, context) => transport.onMessage?.(raw as string, context.peerId);
        room.onPeerJoin  = (peerId) => transport.onPeerJoin?.(peerId);
        room.onPeerLeave = (peerId) => transport.onPeerLeave?.(peerId);
    };

    const pending = leaving.get(roomCode);
    if (pending === undefined) open();
    else void pending.then(open);

    return transport;
};
