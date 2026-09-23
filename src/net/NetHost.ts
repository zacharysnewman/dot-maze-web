import type { LevelData } from '../types';
import { RemotePlayerInput } from './RemotePlayerInput';
import type { ClientMessage, HostMessage, PeerInfo, RejectReason, Snapshot } from './Protocol';
import {
    MAX_PLAYERS, PROTOCOL_VERSION, RECONNECT_GRACE_MS,
    decodeMessage, encodeMessage, isProtocolCompatible, randomLobbyCode,
} from './Protocol';
import type { Transport, TransportFactory } from './Transport';
import { trysteroTransport } from './Transport';

/** A seated remote player, from the host's side. */
export interface HostSeat {
    playerId: number;
    /** The peer this seat last spoke through. */
    peerId: string;
    clientId: string;
    name: string;
    input: RemotePlayerInput;
    /** False while the seat is being held open for someone who dropped. */
    connected: boolean;
    /** Runs out the grace period on a held seat. */
    releaseTimer: ReturnType<typeof setTimeout> | null;
}

export interface NetHostOptions {
    level: LevelData;
    name: string;
    /** Fires whenever the roster changes — someone joined, left, or was refused. */
    onRosterChange: (roster: PeerInfo[]) => void;
    /**
     * A seated player dropped or came back. The game, not the room, decides
     * what that means for the player standing in the maze.
     */
    onSeatConnectionChange?: (playerId: number, connected: boolean) => void;
    /** The latest state of the running game, for a returning player's welcome. */
    latestSnapshot?: () => Snapshot | null;
    /** Overridable so the handshake can be exercised without a network. */
    transport?: TransportFactory;
}

/** The host always holds player 1; joiners take 2, 3, 4 in whatever order they arrive. */
const HOST_PLAYER_ID = 1;

/**
 * The host half of a room.
 *
 * The lobby code *is* the room id, so there is no allocation step, no collision
 * table and no TTL — and no way to enumerate active codes, since a joiner needs
 * both the code and the app id.
 *
 * The topology is a star: clients talk to the host and to nobody else. Trystero
 * connects every peer in a room to every other, but nothing here sends
 * client-to-client, so a full room is three connections rather than a mesh.
 */
export class NetHost {
    readonly code: string;
    readonly name: string;

    private readonly transport: Transport;
    /** Keyed by client id, so a seat outlives the connection that made it. */
    private readonly seats = new Map<string, HostSeat>();
    private readonly options: NetHostOptions;
    private readonly onRosterChange: (roster: PeerInfo[]) => void;

    private level: LevelData;
    /** Set once a game is running — late joiners are refused until the next level. */
    private inProgress = false;

    constructor(options: NetHostOptions) {
        this.options = options;
        this.code = randomLobbyCode();
        this.name = options.name;
        this.level = options.level;
        this.onRosterChange = options.onRosterChange;

        this.transport = (options.transport ?? trysteroTransport)(this.code);

        this.transport.onMessage = (raw, peerId) => {
            const msg = decodeMessage(raw);
            if (msg !== null) this.handle(msg as ClientMessage, peerId);
        };

        this.transport.onPeerLeave = (peerId) => {
            const seat = this.seatByPeer(peerId);
            if (seat !== undefined && seat.connected) this.holdSeat(seat);
        };
    }

    /** Player 1 plus everyone seated, including seats being held. */
    roster(): PeerInfo[] {
        return [
            { playerId: HOST_PLAYER_ID, name: this.name, connected: true },
            ...this.seatList().map(seat => ({
                playerId: seat.playerId,
                name: seat.name,
                connected: seat.connected,
            })),
        ];
    }

    /** Seats in play order, for `start()` to build its slots from. */
    seatList(): HostSeat[] {
        return [...this.seats.values()].sort((a, b) => a.playerId - b.playerId);
    }

    setLevel(level: LevelData): void {
        this.level = level;
        // Everyone waiting in the lobby is looking at a map name; tell them it
        // changed rather than surprising them when the game starts.
        this.publishRoster();
    }

    setInProgress(inProgress: boolean): void {
        this.inProgress = inProgress;
    }

    /**
     * Tell everyone a game is beginning, carrying the level in case the host
     * picked a different one since they were welcomed.
     */
    startGame(): void {
        this.inProgress = true;
        this.sendTo({ t: 'start', level: this.level });
    }

    broadcastSnapshot(snapshot: Snapshot): void {
        if (this.seats.size === 0) return;
        this.sendTo(snapshot);
    }

    /**
     * Notice clients that have gone quiet.
     *
     * Clients send a heartbeat several times a second, so silence means a tab
     * switch or a connection in trouble. WebRTC takes ten seconds or more to
     * admit a peer is gone, which is far too long to leave someone standing in
     * a maze full of enemies, so silence is the faster signal:
     *
     * - briefly: let go of their controls, or they run at a wall until
     *   something kills them;
     * - for a while: hold the seat and sit them out, so the team does not lose
     *   lives to an empty chair.
     */
    presenceCheck(clearHeldAfterMs: number, holdSeatAfterMs: number): void {
        const now = performance.now();
        for (const seat of this.seats.values()) {
            if (seat.input.lastReceivedAt === 0) continue; // never spoken; nothing to miss
            const silent = now - seat.input.lastReceivedAt;
            if (silent > clearHeldAfterMs) seat.input.clearHeld();
            if (silent > holdSeatAfterMs && seat.connected) this.holdSeat(seat);
        }
    }

    /** Last input sequence seen per seated player, for the snapshot's `ack`. */
    acks(): Record<number, number> {
        const acks: Record<number, number> = {};
        for (const seat of this.seats.values()) acks[seat.playerId] = seat.input.lastSeq;
        return acks;
    }

    close(): void {
        for (const seat of this.seats.values()) {
            if (seat.releaseTimer !== null) clearTimeout(seat.releaseTimer);
        }
        this.seats.clear();
        this.transport.leave();
    }

    private seatByPeer(peerId: string): HostSeat | undefined {
        for (const seat of this.seats.values()) {
            if (seat.peerId === peerId) return seat;
        }
        return undefined;
    }

    /**
     * Hold the seat rather than freeing it. A player who drops keeps their slot
     * for half a minute, which covers a reload, a tunnel, or a flaky moment —
     * long enough to come back to the same game, short enough that a seat is
     * not held hostage.
     *
     * Their player sits out meanwhile, exactly as a dead player does, and the
     * existing revive-everyone paths bring them back at the next level or life.
     */
    private holdSeat(seat: HostSeat): void {
        seat.connected = false;
        seat.input.clearHeld();
        this.options.onSeatConnectionChange?.(seat.playerId, false);
        if (seat.releaseTimer !== null) clearTimeout(seat.releaseTimer);
        seat.releaseTimer = setTimeout(() => {
            this.seats.delete(seat.clientId);
            this.publishRoster();
        }, RECONNECT_GRACE_MS);
        this.publishRoster();
    }

    /** Someone is back — through a new connection, or just by speaking again. */
    private restoreSeat(seat: HostSeat, peerId: string): void {
        seat.peerId = peerId;
        seat.connected = true;
        if (seat.releaseTimer !== null) {
            clearTimeout(seat.releaseTimer);
            seat.releaseTimer = null;
        }
        this.options.onSeatConnectionChange?.(seat.playerId, true);
        this.publishRoster();
    }

    private handle(msg: ClientMessage, peerId: string): void {
        switch (msg.t) {
            case 'hello':
                this.admit(msg, peerId);
                break;
            case 'input': {
                const seat = this.seatByPeer(peerId);
                if (seat === undefined) break;
                // They were only quiet, not gone. Talking again is enough.
                if (!seat.connected) this.restoreSeat(seat, peerId);
                seat.input.receive(msg);
                break;
            }
            case 'leave': {
                // Leaving is deliberate, so the seat goes now rather than being
                // held the way a dropped connection is.
                const seat = this.seatByPeer(peerId);
                if (seat === undefined) break;
                if (seat.releaseTimer !== null) clearTimeout(seat.releaseTimer);
                this.seats.delete(seat.clientId);
                this.options.onSeatConnectionChange?.(seat.playerId, false);
                this.publishRoster();
                break;
            }
        }
    }

    private admit(hello: { protocol: unknown; name: string; clientId?: string }, peerId: string): void {
        const clientId = typeof hello.clientId === 'string' && hello.clientId.length > 0
            ? hello.clientId
            : peerId;

        const existing = this.seats.get(clientId);
        if (existing !== undefined) {
            // Either a duplicate hello from a joiner that retried, or someone
            // coming back to a seat that was held for them. Both are the same
            // thing: re-welcome, do not seat them twice.
            if (existing.connected) existing.peerId = peerId;
            else this.restoreSeat(existing, peerId);
            this.welcome(existing, peerId);
            return;
        }

        const protocol = hello.protocol;
        const name = hello.name;
        const playerId = this.nextPlayerId();
        const reason = this.refusalFor(protocol, playerId);
        if (reason !== null || playerId === null) {
            this.sendTo({ t: 'reject', reason: reason ?? 'full' }, peerId);
            return;
        }

        const seat: HostSeat = {
            playerId,
            peerId,
            clientId,
            name: sanitizeName(name),
            input: new RemotePlayerInput(),
            connected: true,
            releaseTimer: null,
        };
        this.seats.set(clientId, seat);
        this.welcome(seat, peerId);
        this.publishRoster();
    }

    private refusalFor(protocol: unknown, playerId: number | null): RejectReason | null {
        if (!isProtocolCompatible(protocol)) return 'protocol';
        if (this.inProgress) return 'in-progress';
        if (playerId === null) return 'full';
        return null;
    }

    /** Lowest free id, so a seat freed by a leaver is reused before a new one. */
    private nextPlayerId(): number | null {
        const taken = new Set([...this.seats.values()].map(s => s.playerId));
        for (let id = HOST_PLAYER_ID + 1; id <= MAX_PLAYERS; id++) {
            if (!taken.has(id)) return id;
        }
        return null;
    }

    private welcome(seat: HostSeat, peerId: string): void {
        this.sendTo({
            t: 'welcome',
            protocol: PROTOCOL_VERSION,
            playerId: seat.playerId,
            level: this.level,
            roster: this.roster(),
            // A returning player needs the running game, not an empty lobby.
            state: this.options.latestSnapshot?.() ?? null,
        }, peerId);
    }

    private publishRoster(): void {
        const roster = this.roster();
        this.onRosterChange(roster);
        if (this.seats.size > 0) this.sendTo({ t: 'roster', roster, mapName: this.level.name });
    }

    private sendTo(msg: HostMessage, peerId?: string): void {
        this.transport.send(encodeMessage(msg), peerId);
    }
}

/** Names come off the wire, so cap them before they reach a roster row. */
function sanitizeName(name: unknown): string {
    if (typeof name !== 'string') return '???';
    const cleaned = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3);
    return cleaned.length > 0 ? cleaned : '???';
}
