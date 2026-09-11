import type { LevelData } from '../types';
import { RemotePlayerInput } from './RemotePlayerInput';
import type { ClientMessage, HostMessage, PeerInfo, RejectReason, Snapshot } from './Protocol';
import {
    MAX_PLAYERS, PROTOCOL_VERSION,
    decodeMessage, encodeMessage, isProtocolCompatible, randomLobbyCode,
} from './Protocol';
import type { Transport, TransportFactory } from './Transport';
import { trysteroTransport } from './Transport';

/** A seated remote player, from the host's side. */
export interface HostSeat {
    playerId: number;
    peerId: string;
    name: string;
    input: RemotePlayerInput;
}

export interface NetHostOptions {
    level: LevelData;
    name: string;
    /** Fires whenever the roster changes — someone joined, left, or was refused. */
    onRosterChange: (roster: PeerInfo[]) => void;
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
    private readonly seats = new Map<string, HostSeat>();
    private readonly onRosterChange: (roster: PeerInfo[]) => void;

    private level: LevelData;
    /** Set once a game is running — late joiners are refused until the next level. */
    private inProgress = false;

    constructor(options: NetHostOptions) {
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
            const seat = this.seats.get(peerId);
            if (seat === undefined) return;
            // Drop whatever they were holding. Mid-game their avatar stops
            // rather than running at a wall for the rest of the level.
            seat.input.clearHeld();
            this.seats.delete(peerId);
            this.publishRoster();
        };
    }

    /** Player 1 plus everyone seated. */
    roster(): PeerInfo[] {
        return [
            { playerId: HOST_PLAYER_ID, name: this.name, connected: true },
            ...[...this.seats.values()]
                .sort((a, b) => a.playerId - b.playerId)
                .map(seat => ({ playerId: seat.playerId, name: seat.name, connected: true })),
        ];
    }

    /** Seats in play order, for `start()` to build its slots from. */
    seatList(): HostSeat[] {
        return [...this.seats.values()].sort((a, b) => a.playerId - b.playerId);
    }

    setLevel(level: LevelData): void {
        this.level = level;
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

    /** Last input sequence seen per seated player, for the snapshot's `ack`. */
    acks(): Record<number, number> {
        const acks: Record<number, number> = {};
        for (const seat of this.seats.values()) acks[seat.playerId] = seat.input.lastSeq;
        return acks;
    }

    close(): void {
        this.seats.clear();
        this.transport.leave();
    }

    private handle(msg: ClientMessage, peerId: string): void {
        switch (msg.t) {
            case 'hello':
                this.admit(msg.protocol, msg.name, peerId);
                break;
            case 'input': {
                // No game is running in the lobby, so this only matters once
                // Phase 3 seats these inputs — but a seat that has not been
                // handed to the simulation yet can still track its sequence.
                this.seats.get(peerId)?.input.receive(msg);
                break;
            }
            case 'leave':
                if (this.seats.delete(peerId)) this.publishRoster();
                break;
        }
    }

    private admit(protocol: unknown, name: string, peerId: string): void {
        const existing = this.seats.get(peerId);
        if (existing !== undefined) {
            // A duplicate hello — the joiner retried. Re-welcome rather than
            // seating them twice.
            this.welcome(existing, peerId);
            return;
        }

        const playerId = this.nextPlayerId();
        const reason = this.refusalFor(protocol, playerId);
        if (reason !== null || playerId === null) {
            this.sendTo({ t: 'reject', reason: reason ?? 'full' }, peerId);
            return;
        }

        const seat: HostSeat = {
            playerId,
            peerId,
            name: sanitizeName(name),
            input: new RemotePlayerInput(),
        };
        this.seats.set(peerId, seat);
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
            state: null,
        }, peerId);
    }

    private publishRoster(): void {
        const roster = this.roster();
        this.onRosterChange(roster);
        if (this.seats.size > 0) this.sendTo({ t: 'roster', roster });
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
