import type { LevelData } from '../types';
import { migrateLevel } from '../editor/LevelMigrate';
import type { ClientMessage, HostMessage, PeerInfo, RejectReason } from './Protocol';
import { PROTOCOL_VERSION, decodeMessage, encodeMessage, isLobbyCode } from './Protocol';
import type { Transport, TransportFactory } from './Transport';
import { trysteroTransport } from './Transport';

export type JoinFailure = RejectReason | 'timeout' | 'bad-code' | 'host-left';

export interface NetClientOptions {
    code: string;
    name: string;
    /** The host welcomed us — the level and our player id are settled. */
    onWelcome: (playerId: number, level: LevelData) => void;
    onRosterChange: (roster: PeerInfo[]) => void;
    onFailure: (failure: JoinFailure) => void;
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

/** The client half of a room: everything it knows, the host told it. */
export class NetClient {
    readonly code: string;

    private readonly options: NetClientOptions;
    private readonly transport: Transport | null = null;

    private hostPeerId: string | null = null;
    private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
    private closed = false;

    playerId = 0;
    roster: PeerInfo[] = [];
    level: LevelData | null = null;

    constructor(options: NetClientOptions) {
        this.options = options;
        this.code = options.code;

        if (!isLobbyCode(options.code)) {
            this.closed = true;
            // Report asynchronously so a caller can finish wiring up first.
            setTimeout(() => options.onFailure('bad-code'), 0);
            return;
        }

        this.transport = (options.transport ?? trysteroTransport)(options.code);

        this.transport.onMessage = (raw, peerId) => {
            const msg = decodeMessage(raw);
            if (msg !== null) this.handle(msg as HostMessage, peerId);
        };

        // Everyone in the room is a peer, but only the host answers a hello —
        // other clients ignore it. Greeting each arrival covers both orders:
        // joining an existing lobby, and being first in with the host to come.
        this.transport.onPeerJoin = (peerId) => {
            this.sendTo({ t: 'hello', protocol: PROTOCOL_VERSION, name: options.name }, peerId);
        };

        this.transport.onPeerLeave = (peerId) => {
            if (peerId === this.hostPeerId) this.fail('host-left');
        };

        this.welcomeTimer = setTimeout(() => this.fail('timeout'), WELCOME_TIMEOUT_MS);
    }

    leave(): void {
        if (this.closed) return;
        this.closed = true;
        this.clearWelcomeTimer();
        if (this.hostPeerId !== null) this.sendTo({ t: 'leave' }, this.hostPeerId);
        this.transport?.leave();
    }

    private handle(msg: HostMessage, peerId: string): void {
        if (this.closed) return;

        switch (msg.t) {
            case 'welcome': {
                if (this.hostPeerId !== null) return; // already seated
                this.hostPeerId = peerId;
                this.clearWelcomeTimer();
                this.playerId = msg.playerId;
                // migrateLevel only upgrades forwards, which is exactly why the
                // handshake carries a version: a level too new to migrate has
                // already been refused by then.
                this.level = migrateLevel(msg.level);
                this.roster = msg.roster;
                this.options.onWelcome(this.playerId, this.level);
                this.options.onRosterChange(this.roster);
                break;
            }
            case 'reject':
                this.fail(msg.reason);
                break;
            case 'roster':
                this.roster = msg.roster;
                this.options.onRosterChange(this.roster);
                break;
            case 'start':
            case 'snap':
                // Gameplay messages. Nothing runs them yet — a lobby client has
                // no game loop to feed until the simulation lands.
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
