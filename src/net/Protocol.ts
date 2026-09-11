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
export const PROTOCOL_VERSION = 1;

/** Seats in a room, host included. */
export const MAX_PLAYERS = 4;

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
    | { e: 'fruit' }
    | { e: 'eatEnemy'; chain: number }
    | { e: 'death'; playerId: number }
    | { e: 'levelClear' }
    | { e: 'extraLife' };

export interface PeerInfo {
    playerId: number;
    name: string;
    connected: boolean;
}

export type RejectReason = 'protocol' | 'full' | 'in-progress';

export interface HelloMsg {
    t: 'hello';
    protocol: number;
    name: string;
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

/** Lobby roster changed — someone joined, left or reconnected. */
export interface RosterMsg {
    t: 'roster';
    roster: PeerInfo[];
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
