import { gridW } from '../constants';
import type { Direction, EnemyMode, LevelData } from '../types';

/**
 * Wire format for online co-op.
 *
 * Bump PROTOCOL_VERSION whenever LevelData, the snapshot format or the input
 * format changes. `migrateLevel` only upgrades old level shapes to new ones, so
 * an older client handed a newer level has no recovery path — version skew must
 * be refused at the handshake rather than half-working. GitHub Pages users hold
 * stale tabs for a long time, so this will happen.
 */
export const PROTOCOL_VERSION = 5;

/** Seats in a room, host included. */
export const MAX_PLAYERS = 4;

/**
 * Namespaces the room. Two builds with different app ids never meet, even on
 * the same code — which is also why a code alone cannot be used to enumerate
 * games.
 */
export const APP_ID = 'dot-maze';

/**
 * The single Trystero action every message travels on. One channel keeps
 * ordering between a welcome and the snapshots that follow it; the envelope's
 * `t` field does the sorting.
 */
export const NET_ACTION = 'net';

/** Lobby codes are six digits: a million combinations, enterable on a d-pad. */
export const CODE_LENGTH = 6;

export function isLobbyCode(code: string): boolean {
    return new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(code);
}

const CLIENT_ID_KEY = 'dot-maze-client-id';

/**
 * This browser's identity to a host, stable across reloads and reconnections.
 * Peer ids are not: Trystero mints a new one every session, so without this a
 * player coming back looks like a stranger and their held seat is unreachable.
 */
export function localClientId(): string {
    try {
        const stored = localStorage.getItem(CLIENT_ID_KEY);
        if (stored !== null && stored.length > 0) return stored;
        const minted = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(CLIENT_ID_KEY, minted);
        return minted;
    } catch {
        // Private mode: a per-session id still works, it just cannot survive a
        // reload, so a reconnecting player takes a fresh seat instead.
        return `c${Math.random().toString(36).slice(2, 12)}`;
    }
}

/**
 * `Math.random` is fine here: a code is not a secret, only an address. Guessing
 * one lands you in a stranger's co-op game, which is why it is six digits and
 * not four.
 */
export function randomLobbyCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += Math.floor(Math.random() * 10);
    return code;
}

/** Snapshot broadcast rate. 60 Hz render / 20 Hz send = every 3rd frame. */
export const SNAPSHOT_HZ = 20;

// ── Held-direction bitmask ────────────────────────────────────────────────────
// Held state travels alongside the buffered direction because they mean
// different things: holding into a wall until a corridor opens is real
// behaviour, and "the direction I want" alone would lose it.

export const HELD_LEFT  = 1;
export const HELD_RIGHT = 2;
export const HELD_UP    = 4;
export const HELD_DOWN  = 8;

export interface HeldDirections {
    leftPressed: boolean;
    rightPressed: boolean;
    upPressed: boolean;
    downPressed: boolean;
}

export function encodeHeld(held: HeldDirections): number {
    return (held.leftPressed  ? HELD_LEFT  : 0)
         | (held.rightPressed ? HELD_RIGHT : 0)
         | (held.upPressed    ? HELD_UP    : 0)
         | (held.downPressed  ? HELD_DOWN  : 0);
}

export function decodeHeld(mask: number): HeldDirections {
    return {
        leftPressed:  (mask & HELD_LEFT)  !== 0,
        rightPressed: (mask & HELD_RIGHT) !== 0,
        upPressed:    (mask & HELD_UP)    !== 0,
        downPressed:  (mask & HELD_DOWN)  !== 0,
    };
}

// ── Tile indices ──────────────────────────────────────────────────────────────
// Eaten dots ship as flat indices rather than {x,y} pairs: one number instead
// of an object, and a level clear can name a lot of tiles at once.

export function tileIndex(x: number, y: number): number {
    return y * gridW + x;
}

export function tileFromIndex(index: number): { x: number; y: number } {
    return { x: index % gridW, y: Math.floor(index / gridW) };
}

// ── Messages ──────────────────────────────────────────────────────────────────

/**
 * Which screen the client belongs on. Distinct from the snapshot's
 * `gameOver`/`frozen`/`showReady`, which say how to draw the maze — a different
 * question once the host has left the maze behind.
 */
export type HostPhase = 'playing' | 'gameover' | 'initials' | 'lobby';

/**
 * Sound is triggered inline inside host-only game logic, so clients need it as
 * data. The ambient siren is derived rather than sent: it falls out of enemy
 * modes and `frightenedRemaining`, both already in every snapshot.
 */
export type NetEvent =
    | { e: 'dot' }
    | { e: 'power' }
    // Scored events carry where and how much, because the floating number the
    // host draws on the spot is not in the snapshot — and cannot be, since its
    // expiry is a time on the host's clock.
    | { e: 'fruit'; score: number; x: number; y: number }
    | { e: 'eatEnemy'; chain: number; score: number; x: number; y: number }
    | { e: 'death'; playerId: number }
    | { e: 'levelClear' }
    | { e: 'extraLife' };

/** How long a floating score stays up. Both sides count it on their own clock. */
export const ENEMY_POPUP_SECONDS = 1.0;
export const FRUIT_POPUP_SECONDS = 2.0;

export interface PeerInfo {
    playerId: number;
    name: string;
    /** False while a seat is held open for someone who dropped. */
    connected: boolean;
}

/** How long a seat is kept for a player who drops before it is given up. */
export const RECONNECT_GRACE_MS = 30_000;

export type RejectReason = 'protocol' | 'full' | 'in-progress';

export interface HelloMsg {
    t: 'hello';
    protocol: number;
    name: string;
    /**
     * Stable per browser, unlike a peer id, which is new on every connection.
     * It is what lets a player who drops out and comes back land in the seat
     * that was being held for them.
     */
    clientId: string;
}

export interface WelcomeMsg {
    t: 'welcome';
    protocol: number;
    playerId: number;
    level: LevelData;
    roster: PeerInfo[];
    /** Null while the room is still in the lobby and nothing is running yet. */
    state: Snapshot | null;
}

export interface RejectMsg {
    t: 'reject';
    reason: RejectReason;
}

/**
 * Lobby state changed — someone joined, left or reconnected, or the host picked
 * a different map. `mapName` is additive: a client that does not read it simply
 * shows the map it was welcomed with.
 */
export interface RosterMsg {
    t: 'roster';
    roster: PeerInfo[];
    mapName?: string;
}

/** Host pressed START. Carries the level in case the host picked a new one. */
export interface StartMsg {
    t: 'start';
    level: LevelData;
}

export interface InputMsg {
    t: 'input';
    /** Held-direction bitmask; see HELD_*. */
    held: number;
    buffered: Direction | null;
    /** Monotonic per-client, echoed back in `Snapshot.ack` for reconciliation. */
    seq: number;
    /**
     * Where the sender was standing when this was made.
     *
     * A turn is a decision about a *place*, not a moment. The host applies one
     * a round trip after the client made it, from a point further down the
     * corridor — so it starts around the corner that much later and stays that
     * much behind, every single time. A few corners of that and the two
     * disagree by more than the prediction can absorb.
     */
    x: number;
    y: number;
}

export interface LeaveMsg {
    t: 'leave';
}

export interface SnapshotPlayer {
    id: number;
    x: number;
    y: number;
    dir: Direction;
    active: boolean;
    dying: boolean;
    deathProgress: number;
    frozen: boolean;
}

export interface SnapshotEnemy {
    x: number;
    y: number;
    dir: Direction;
    mode: EnemyMode;
}

export interface Snapshot {
    t: 'snap';
    tick: number;
    /** Last input seq the host has seen, per player id. */
    ack: Record<number, number>;
    /**
     * Where the host's copy of each player stood when it applied that
     * acknowledged input.
     *
     * Reconciliation needs to compare like with like. The player's position
     * elsewhere in this snapshot is from the moment the snapshot was taken,
     * which is a third of a second further on than the input being
     * acknowledged — so comparing the two measures the round trip, not the
     * disagreement, and a jittery link pushes that difference past any
     * sensible threshold on its own. This is the same instant in the input
     * stream as the client's own record, so what is left over is divergence
     * and nothing else.
     */
    ackAt: Record<number, { x: number; y: number }>;
    players: SnapshotPlayer[];
    /** Always 4, in gameObjects order. */
    enemies: SnapshotEnemy[];
    score: number;
    lives: number;
    level: number;
    frightenedRemaining: number;
    fruit: { x: number; y: number } | null;
    showReady: boolean;
    frozen: boolean;
    gameOver: boolean;
    hostPhase: HostPhase;
    /** Tile indices eaten since the last acknowledged snapshot. */
    eaten: number[];
    events: NetEvent[];
}

export type ClientMessage = HelloMsg | InputMsg | LeaveMsg;
export type HostMessage   = WelcomeMsg | RejectMsg | RosterMsg | StartMsg | Snapshot;
export type NetMessage    = ClientMessage | HostMessage;

// ── Codec ─────────────────────────────────────────────────────────────────────
// JSON to start with: ~400 bytes per snapshot × 20 Hz × 3 clients is under
// 10 KB/s. A binary encoding quantising positions to 1/16 tile would reach
// ~90 bytes if that ever matters.

const MESSAGE_TAGS = new Set(['hello', 'welcome', 'reject', 'roster', 'start', 'input', 'leave', 'snap']);

/** Positions are pixel-space (tile * 20); one decimal is 1/200th of a tile. */
function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

export function encodeMessage(msg: NetMessage): string {
    return JSON.stringify(msg.t === 'snap' ? compactSnapshot(msg) : msg);
}

/**
 * Parse a message off the wire. Co-op means the host is trusted, so this checks
 * only enough to keep a truncated or stale-format payload from throwing inside
 * the render loop — it is not validation.
 */
export function decodeMessage(raw: string): NetMessage | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const tag = (parsed as { t?: unknown }).t;
    if (typeof tag !== 'string' || !MESSAGE_TAGS.has(tag)) return null;
    return parsed as NetMessage;
}

/** Drop position precision nobody can see. Roughly halves a snapshot. */
function compactSnapshot(snap: Snapshot): Snapshot {
    return {
        ...snap,
        players: snap.players.map(p => ({ ...p, x: round1(p.x), y: round1(p.y), deathProgress: round1(p.deathProgress) })),
        ackAt: Object.fromEntries(Object.entries(snap.ackAt).map(([id, at]) => [id, { x: round1(at.x), y: round1(at.y) }])),
        enemies: snap.enemies.map(e => ({ ...e, x: round1(e.x), y: round1(e.y) })),
    };
}

export function encodeSnapshot(snap: Snapshot): string {
    return encodeMessage(snap);
}

export function decodeSnapshot(raw: string): Snapshot | null {
    const msg = decodeMessage(raw);
    return msg !== null && msg.t === 'snap' ? msg : null;
}

export function isProtocolCompatible(version: unknown): boolean {
    return version === PROTOCOL_VERSION;
}
