import type { LevelData } from '../types';
import { migrateLevel } from '../editor/LevelMigrate';
import type { Direction } from '../types';
import type { ClientMessage, HostMessage, PeerInfo, RejectReason, Snapshot } from './Protocol';
import { PROTOCOL_VERSION, decodeMessage, encodeMessage, isLobbyCode, localClientId } from './Protocol';
import type { Transport, TransportFactory } from './Transport';
import { trysteroTransport } from './Transport';

export type JoinFailure = RejectReason | 'timeout' | 'bad-code' | 'host-left';

/** What the client is doing about its connection, for the screen to report. */
export type ConnectionState = 'connected' | 'reconnecting';

export interface NetClientOptions {
    code: string;
    name: string;
    /**
     * The host welcomed us — the level and our player id are settled. `state`
     * is set when a game is already running, which is what a player coming back
     * to a held seat gets.
     */
    onWelcome: (playerId: number, level: LevelData, state: Snapshot | null) => void;
    onRosterChange: (roster: PeerInfo[], mapName: string | null) => void;
    /** The host pressed START. The level comes with it — it may have changed. */
    onStart: (level: LevelData) => void;
    onSnapshot: (snapshot: Snapshot) => void;
    onFailure: (failure: JoinFailure) => void;
    /** Connection lost and being rebuilt, or back. */
    onConnectionState?: (state: ConnectionState) => void;
    /** Overridable so the handshake can be exercised without a network. */
    transport?: TransportFactory;
}

/**
 * How long to wait for a welcome before giving up. Signalling goes through
 * public relays and a fresh WebRTC connection is not instant, so this is long
 * enough to cover a slow handshake and short enough that a wrong code does not
 * look like a hang.
 */
const WELCOME_TIMEOUT_MS = 20_000;

/**
 * Reconnection budget. The host holds a seat for 30 s, so give up a little
 * before that rather than succeeding into a seat that has just been freed.
 * Each attempt is a fresh room join, and a connection that is coming back
 * usually does so on the first or second.
 */
const RECONNECT_WINDOW_MS = 28_000;
const RECONNECT_ATTEMPT_MS = 5_000;

/** The client half of a room: everything it knows, the host told it. */
export class NetClient {
    readonly code: string;

    private readonly options: NetClientOptions;
    private readonly newTransport: TransportFactory;
    private transport: Transport | null = null;

    private hostPeerId: string | null = null;
    private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
    private closed = false;
    private seq = 0;
    /** When the connection was lost; 0 while it is up. */
    private lostAt = 0;

    playerId = 0;
    roster: PeerInfo[] = [];
    level: LevelData | null = null;

    constructor(options: NetClientOptions) {
        this.options = options;
        this.code = options.code;
        this.newTransport = options.transport ?? trysteroTransport;

        if (!isLobbyCode(options.code)) {
            this.closed = true;
            // Report asynchronously so a caller can finish wiring up first.
            setTimeout(() => options.onFailure('bad-code'), 0);
            return;
        }

        this.openRoom(WELCOME_TIMEOUT_MS);
    }

    /** Join the room and wait to be welcomed. Used to connect and to reconnect. */
    private openRoom(welcomeTimeout: number): void {
        this.hostPeerId = null;
        this.transport = this.newTransport(this.code);

        this.transport.onMessage = (raw, peerId) => {
            const msg = decodeMessage(raw);
            if (msg !== null) this.handle(msg as HostMessage, peerId);
        };

        // Everyone in the room is a peer, but only the host answers a hello —
        // other clients ignore it. Greeting each arrival covers both orders:
        // joining an existing lobby, and being first in with the host to come.
        this.transport.onPeerJoin = (peerId) => {
            this.sendTo({
                t: 'hello',
                protocol: PROTOCOL_VERSION,
                name: this.options.name,
                clientId: localClientId(),
            }, peerId);
        };

        this.transport.onPeerLeave = (peerId) => {
            if (peerId === this.hostPeerId) this.connectionLost();
        };

        this.clearWelcomeTimer();
        this.welcomeTimer = setTimeout(() => {
            if (this.lostAt === 0) this.fail('timeout');
            else this.tryAgain();
        }, welcomeTimeout);
    }

    /** True while the connection is down and being rebuilt. */
    isReconnecting(): boolean {
        return this.lostAt !== 0;
    }

    /** Whole seconds left before reconnection gives up, for the screen to show. */
    reconnectSecondsLeft(): number {
        if (this.lostAt === 0) return 0;
        const left = RECONNECT_WINDOW_MS - (performance.now() - this.lostAt);
        return Math.max(0, Math.ceil(left / 1000));
    }

    /**
     * The game noticing the host has gone quiet. WebRTC takes twelve seconds or
     * more to report a dead connection, and the host only holds a seat for
     * thirty, so waiting for the transport to admit it wastes most of the
     * window a reconnection has to work with.
     */
    reportSilence(): void {
        this.connectionLost();
    }

    /**
     * Start rebuilding the connection. Further losses while an attempt is in
     * flight are ignored — the retry loop is driven by attempts timing out, not
     * by how often the game notices the silence.
     */
    private connectionLost(): void {
        if (this.closed || this.lostAt !== 0) return;
        this.lostAt = performance.now();
        this.options.onConnectionState?.('reconnecting');
        this.tryAgain();
    }

    private tryAgain(): void {
        if (this.closed) return;
        if (performance.now() - this.lostAt > RECONNECT_WINDOW_MS) {
            // Out of time: either the host is gone, or its seat for us is.
            this.fail('host-left');
            return;
        }
        this.dropRoom();
        this.openRoom(RECONNECT_ATTEMPT_MS);
    }

    /** Let go of the room without ending the session. */
    private dropRoom(): void {
        if (this.transport === null) return;
        this.transport.onMessage = null;
        this.transport.onPeerJoin = null;
        this.transport.onPeerLeave = null;
        this.transport.leave();
        this.transport = null;
        this.hostPeerId = null;
    }

    /**
     * Send what the local player is asking for, and return the sequence number
     * it went out with. The host echoes it back in `Snapshot.ack`, which is
     * what lets a seat drop anything late or duplicated — and what lets the
     * client line a snapshot up against what it predicted at the time.
     */
    sendInput(held: number, buffered: Direction | null): number {
        if (this.closed || this.hostPeerId === null) return this.seq;
        this.seq++;
        this.sendTo({ t: 'input', held, buffered, seq: this.seq }, this.hostPeerId);
        return this.seq;
    }

    leave(): void {
        if (this.closed) return;
        this.closed = true;
        this.clearWelcomeTimer();
        // Leaving on purpose frees the seat now; a seat is only held for someone
        // who dropped.
        if (this.hostPeerId !== null) this.sendTo({ t: 'leave' }, this.hostPeerId);
        this.dropRoom();
    }

    private handle(msg: HostMessage, peerId: string): void {
        if (this.closed) return;

        switch (msg.t) {
            case 'welcome': {
                if (this.hostPeerId !== null) return; // already seated
                this.hostPeerId = peerId;
                this.clearWelcomeTimer();
                if (this.lostAt !== 0) {
                    this.lostAt = 0;
                    this.options.onConnectionState?.('connected');
                }
                this.playerId = msg.playerId;
                // migrateLevel only upgrades forwards, which is exactly why the
                // handshake carries a version: a level too new to migrate has
                // already been refused by then.
                this.level = migrateLevel(msg.level);
                this.roster = msg.roster;
                this.options.onWelcome(this.playerId, this.level, msg.state);
                this.options.onRosterChange(this.roster, this.level.name);
                break;
            }
            case 'reject':
                this.fail(msg.reason);
                break;
            case 'roster':
                this.roster = msg.roster;
                this.options.onRosterChange(this.roster, msg.mapName ?? null);
                break;
            case 'start':
                this.level = migrateLevel(msg.level);
                this.options.onStart(this.level);
                break;
            case 'snap':
                this.options.onSnapshot(msg);
                break;
        }
    }

    private fail(failure: JoinFailure): void {
        if (this.closed) return;
        this.leave();
        this.options.onFailure(failure);
    }

    private clearWelcomeTimer(): void {
        if (this.welcomeTimer !== null) {
            clearTimeout(this.welcomeTimer);
            this.welcomeTimer = null;
        }
    }

    private sendTo(msg: ClientMessage, peerId?: string): void {
        this.transport?.send(encodeMessage(msg), peerId);
    }
}
