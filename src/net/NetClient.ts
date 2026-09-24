import type { LevelData } from '../types';
import { migrateLevel } from '../editor/LevelMigrate';
import type { Direction } from '../types';
import type { ClientMessage, HostMessage, PeerInfo, RejectReason, Snapshot } from './Protocol';
import { PROTOCOL_VERSION, decodeMessage, encodeMessage, localClientId } from './Protocol';
import type { Transport } from './Transport';
import type { ClientPairing } from './Pairing';

export type JoinFailure = RejectReason | 'host-left';

/** What the client is doing about its connection, for the screen to report. */
export type ConnectionState = 'connected' | 'reconnecting';

export interface NetClientOptions {
    name: string;
    /**
     * The connection to the host, set up by scanning QR codes. Joining waits on
     * it for as long as it takes: until the host scans the reply, nothing can
     * happen, and the player can cancel.
     */
    pairing: ClientPairing;
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
    /** The host went quiet, or came back. */
    onConnectionState?: (state: ConnectionState) => void;
}

/**
 * How long a silent host is waited for. The host holds a seat for 30 s, so
 * give up a little before that rather than hanging on for a seat that has been
 * freed. Silence is not a dead connection — a host whose tab was backgrounded
 * or whose Wi-Fi hiccuped comes back on the same connection, and WebRTC
 * recovers a path by itself when packets flow again — so this only waits.
 * There is nothing to rebuild: a new connection would take new QR scans.
 */
const SILENCE_GIVE_UP_MS = 28_000;

/** The client half of a room: everything it knows, the host told it. */
export class NetClient {
    private readonly options: NetClientOptions;
    private readonly transport: Transport;

    private hostPeerId: string | null = null;
    private closed = false;
    private seq = 0;
    /** When the host went quiet; 0 while it is talking. */
    private lostAt = 0;
    private giveUpTimer: ReturnType<typeof setTimeout> | null = null;

    playerId = 0;
    roster: PeerInfo[] = [];
    level: LevelData | null = null;

    constructor(options: NetClientOptions) {
        this.options = options;
        this.transport = options.pairing.attach();

        this.transport.onMessage = (raw, peerId) => {
            const msg = decodeMessage(raw);
            if (msg !== null) this.handle(msg as HostMessage, peerId);
        };

        // The only peer is the host, and it seats nobody who has not said hello.
        this.transport.onPeerJoin = (peerId) => {
            this.sendTo({
                t: 'hello',
                protocol: PROTOCOL_VERSION,
                name: this.options.name,
                clientId: localClientId(),
            }, peerId);
        };

        // The connection itself closed or failed: that is not coming back
        // without scanning again.
        this.transport.onPeerLeave = () => this.fail('host-left');
    }

    /** True while the host is silent and being waited for. */
    isReconnecting(): boolean {
        return this.lostAt !== 0;
    }

    /** Whole seconds left before waiting gives up, for the screen to show. */
    reconnectSecondsLeft(): number {
        if (this.lostAt === 0) return 0;
        const left = SILENCE_GIVE_UP_MS - (performance.now() - this.lostAt);
        return Math.max(0, Math.ceil(left / 1000));
    }

    /** The game noticed the host has gone quiet. Wait for it, up to a point. */
    reportSilence(): void {
        if (this.closed || this.lostAt !== 0) return;
        this.lostAt = performance.now();
        this.options.onConnectionState?.('reconnecting');
        this.giveUpTimer = setTimeout(() => this.fail('host-left'), SILENCE_GIVE_UP_MS);
    }

    /** The host is talking again. */
    private heardHost(): void {
        if (this.lostAt === 0) return;
        this.lostAt = 0;
        if (this.giveUpTimer !== null) clearTimeout(this.giveUpTimer);
        this.giveUpTimer = null;
        this.options.onConnectionState?.('connected');
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
        if (this.giveUpTimer !== null) clearTimeout(this.giveUpTimer);
        // Leaving on purpose frees the seat now; a seat is only held for someone
        // who dropped.
        if (this.hostPeerId !== null) this.sendTo({ t: 'leave' }, this.hostPeerId);
        this.transport.onMessage = null;
        this.transport.onPeerJoin = null;
        this.transport.onPeerLeave = null;
        this.transport.leave();
    }

    private handle(msg: HostMessage, peerId: string): void {
        if (this.closed) return;
        this.heardHost();

        switch (msg.t) {
            case 'welcome': {
                const returning = this.hostPeerId !== null;
                this.hostPeerId = peerId;
                this.playerId = msg.playerId;
                // migrateLevel only upgrades forwards, which is exactly why the
                // handshake carries a version: a level too new to migrate has
                // already been refused by then.
                this.level = migrateLevel(msg.level);
                this.roster = msg.roster;
                if (returning) return; // a repeat welcome changes nothing
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

    private sendTo(msg: ClientMessage, peerId?: string): void {
        this.transport.send(encodeMessage(msg), peerId);
    }
}
