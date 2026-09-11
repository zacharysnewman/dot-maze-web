import { unit } from '../constants';
import { gameState } from '../game-state';
import { GameObject } from '../object/GameObject';
import { Draw } from '../static/Draw';
import { Levels } from '../static/Levels';
import { Move } from '../static/Move';
import { Sound } from '../static/Sound';
import { getCurrentPlayerSpeed } from '../static/Speeds';
import { Stats } from '../static/Stats';
import type { IGameObject, LevelData, PlayerState } from '../types';
import { RemotePlayerInput } from './RemotePlayerInput';
import type { InputMsg, NetEvent, Snapshot, SnapshotPlayer } from './Protocol';
import { tileFromIndex } from './Protocol';
import { TILE_EMPTY } from '../tiles';

const ENEMY_COLORS = ['red', 'cyan', 'hotpink', 'orange'] as const;

/** Far enough ahead that `Draw.fruit` never expires it; the host decides. */
const FRUIT_NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

/**
 * How far behind the newest snapshot the client draws.
 *
 * Snapshots land every 50 ms, so holding two of them means there is almost
 * always a later one to interpolate toward, and motion is smooth instead of
 * stepping 20 times a second. The cost is that everyone else is seen 100 ms in
 * the past, which for co-op costs nothing — nobody is racing anybody.
 */
const INTERP_DELAY_MS = 100;

/** Silence longer than this means the host has stopped sending. */
const STARVED_MS = 1500;

/** Divergence worth correcting, and divergence worth giving up on. */
const CORRECT_ABOVE = unit;          // one tile — a wrong turn
const SNAP_ABOVE    = unit * 4;      // a teleport, a death, a new level

interface Buffered {
    snap: Snapshot;
    at: number;
}

/**
 * The client's copy of the world.
 *
 * Nothing here simulates except the local player. `GameObject` takes its move
 * and draw functions as separate constructor arguments, so an actor built with
 * a no-op move function only draws — and snapshots write straight onto `x`,
 * `y` and `moveDir`.
 */
export class ClientGame {
    private readonly playerStart: { x: number; y: number };
    private readonly selfPlayerId: number;

    /** Snapshots that have arrived but are not old enough to draw yet. */
    private buffer: Buffered[] = [];
    /** The snapshot currently being drawn from, and the source of all discrete state. */
    private base: Buffered | null = null;
    private lastArrival = 0;
    private lastLevel = 0;

    /**
     * The local player is driven by the same class the host seats for a remote
     * one, fed the same messages. Prediction and authority then interpret input
     * through identical code, which is the only way they agree about what a
     * buffered turn means.
     */
    private readonly localInput = new RemotePlayerInput();
    /** Where the prediction thought it was when each input went out. */
    private readonly predicted = new Map<number, { x: number; y: number }>();

    constructor(level: LevelData, selfPlayerId: number) {
        this.selfPlayerId = selfPlayerId;
        this.playerStart = level.playerStart;

        gameState.currentLevel = level;
        Levels.levelSetup   = level.tiles;
        Levels.levelDynamic = level.tiles.map(row => [...row]);

        gameState.players = [];
        gameState.enemies = ENEMY_COLORS.map(color => makeRenderOnlyEnemy(color, level.enemyStarts));
        gameState.gameObjects = [...gameState.enemies];
        [gameState.redEnemy, gameState.cyanEnemy, gameState.hotpinkEnemy, gameState.orangeEnemy] = gameState.enemies;

        gameState.frozen = true;
        gameState.gameOver = false;
        gameState.showReady = true;
        gameState.level = 1;
        gameState.sharedLives = 0;
        gameState.scorePopups = [];
        gameState.fruitActive = null;
        gameState.fruitHistory = [];
        this.lastLevel = 1;
        this.lastArrival = performance.now();
    }

    push(snapshot: Snapshot): void {
        this.lastArrival = performance.now();
        this.buffer.push({ snap: snapshot, at: this.lastArrival });
    }

    /** True when the host has gone quiet — paused, lagging, or in trouble. */
    isStarved(): boolean {
        return performance.now() - this.lastArrival > STARVED_MS;
    }

    /**
     * A hidden tab stops rendering but keeps receiving, so coming back to a
     * queue of stale snapshots would replay the last few seconds in fast
     * forward. Throw them away and rejoin the present.
     */
    resync(): void {
        const newest = this.buffer.pop() ?? null;
        this.buffer = [];
        this.base = null;
        if (newest !== null) {
            this.applyDiscrete(newest.snap);
            writePositions(newest.snap, null);
            this.base = { snap: newest.snap, at: performance.now() };
        }
        this.lastArrival = performance.now();
    }

    /** Local input, already on its way to the host, also drives the prediction. */
    applyLocalInput(message: InputMsg, actorX: number, actorY: number): void {
        this.localInput.receive(message);
        this.predicted.set(message.seq, { x: actorX, y: actorY });
    }

    /** The local player's actor, so the caller can record where it predicted. */
    selfActor(): IGameObject | null {
        return gameState.players.find(p => p.id === this.selfPlayerId)?.actor ?? null;
    }

    /** Advance to what should be on screen now. */
    update(): void {
        const renderTime = performance.now() - INTERP_DELAY_MS;

        while (this.buffer.length > 0 && this.buffer[0].at <= renderTime) {
            this.base = this.buffer.shift() as Buffered;
            this.applyDiscrete(this.base.snap);
        }
        if (this.base === null) {
            // Nothing has aged in yet. Draw the newest arrival rather than an
            // empty maze for the first tenth of a second.
            const first = this.buffer.shift();
            if (first === undefined) return;
            this.base = first;
            this.applyDiscrete(first.snap);
        }

        const self = gameState.players.find(p => p.id === this.selfPlayerId) ?? null;
        // With no snapshots arriving there is nothing to correct against, so
        // predicting would just walk the player off into a maze nobody else
        // can see.
        const predicting = self !== null && self.active && !self.dying
            && !gameState.frozen && !this.isStarved();

        const next = this.buffer[0] ?? null;
        const span = next === null ? 0 : next.at - this.base.at;
        const t = span > 0 ? clamp01((renderTime - this.base.at) / span) : 1;
        writePositions(this.base.snap, next?.snap ?? null, t, predicting ? this.selfPlayerId : null);

        if (predicting && self !== null) {
            self.actor.moveSpeed = getCurrentPlayerSpeed();
            this.localInput.update(self.actor);
            Move.player(self);
        }
    }

    /** One frame of the host's game, drawn from whatever state has been applied. */
    draw(): void {
        Draw.level();
        Draw.advancePlayerAnim();
        for (const go of gameState.gameObjects) go.update();
        Draw.scorePopups();
        Draw.readyText();
        Draw.hud();
        if (gameState.gameOver) Draw.gameOverScreen();
    }

    /**
     * The siren is derived, not sent: it falls out of enemy modes and the
     * frightened timer, both of which are in every snapshot.
     */
    updateSiren(): void {
        if (gameState.frozen || gameState.gameOver) {
            Sound.stopSiren();
        } else if (gameState.enemies.some(e => e.enemyMode === 'eyes')) {
            Sound.startSiren('eyes');
        } else if (gameState.frightenedRemaining > 0) {
            Sound.startSiren('blue');
        } else {
            Sound.startSiren('normal');
        }
    }

    destroy(): void {
        Sound.stopSiren();
        this.buffer = [];
        this.base = null;
        this.predicted.clear();
        gameState.players = [];
        gameState.gameObjects = [];
        gameState.enemies = [];
    }

    /** Everything in a snapshot that is a fact rather than a position. */
    private applyDiscrete(snap: Snapshot): void {
        this.ensurePlayers(snap.players.map(p => p.id));

        // A new level means the host rebuilt its dot grid, which no list of
        // eaten tiles can express. Rebuild from the level and start again.
        if (snap.level !== this.lastLevel) {
            Levels.levelDynamic = gameState.currentLevel.tiles.map(row => [...row]);
            this.lastLevel = snap.level;
        }
        for (const index of snap.eaten) {
            const { x, y } = tileFromIndex(index);
            if (Levels.levelDynamic[y] !== undefined) Levels.levelDynamic[y][x] = TILE_EMPTY;
        }

        for (const p of snap.players) {
            const player = gameState.players.find(local => local.id === p.id);
            if (player === undefined) continue;
            player.active = p.active;
            player.dying = p.dying;
            player.deathProgress = p.deathProgress;
            player.frozen = p.frozen;
        }

        for (let i = 0; i < gameState.enemies.length && i < snap.enemies.length; i++) {
            gameState.enemies[i].enemyMode = snap.enemies[i].mode;
        }

        Stats.currentScore = snap.score;
        if (snap.score > Stats.highScore) Stats.highScore = snap.score;
        gameState.sharedLives = snap.lives;
        gameState.level = snap.level;
        gameState.frightenedRemaining = snap.frightenedRemaining;
        // Levels already cleared, which is what the counter along the bottom
        // shows. The host never needs to send it.
        gameState.fruitHistory = Array.from({ length: snap.level - 1 }, (_, i) => i + 1);
        gameState.fruitActive = snap.fruit === null
            ? null
            : { x: snap.fruit.x, y: snap.fruit.y, endTime: FRUIT_NEVER_EXPIRES };
        gameState.showReady = snap.showReady;
        gameState.frozen = snap.frozen;
        gameState.gameOver = snap.gameOver;

        // Events fire as the snapshot is drawn, not as it arrives, so a dot
        // sounds at the moment it visibly disappears.
        for (const event of snap.events) playEvent(event);

        this.reconcile(snap);
    }

    /**
     * Pull the prediction back toward the host when they have genuinely
     * diverged.
     *
     * The comparison is against where the prediction *was* when the host's
     * last acknowledged input went out, not against where it is now — those are
     * a round trip apart, and comparing them would report an error every frame.
     * Small disagreement is left alone: the host briefly stalls the player on
     * each dot, which the client does not model, and chasing that would jitter.
     */
    private reconcile(snap: Snapshot): void {
        const self = gameState.players.find(p => p.id === this.selfPlayerId);
        const authority = snap.players.find(p => p.id === this.selfPlayerId);
        if (self === undefined || authority === undefined) return;

        const ackSeq = snap.ack[this.selfPlayerId];
        const at = ackSeq === undefined ? undefined : this.predicted.get(ackSeq);
        for (const seq of this.predicted.keys()) {
            if (ackSeq !== undefined && seq <= ackSeq) this.predicted.delete(seq);
        }

        // Sitting out, dying, or frozen: the host's position is the only one
        // that means anything.
        if (!authority.active || authority.dying || snap.frozen) {
            snapTo(self, authority);
            return;
        }
        if (at === undefined) return;

        const dx = authority.x - at.x;
        const dy = authority.y - at.y;
        if (Math.abs(dx) > SNAP_ABOVE || Math.abs(dy) > SNAP_ABOVE) {
            snapTo(self, authority);
        } else if (Math.abs(dx) > CORRECT_ABOVE || Math.abs(dy) > CORRECT_ABOVE) {
            // Shift by the error rather than jumping to the host's position,
            // which would undo every step taken since that input went out.
            self.actor.x += dx;
            self.actor.y += dy;
        }
    }

    /**
     * Build the player list the first snapshot describes, and rebuild it if the
     * host's list ever changes. The snapshot is the authority on who is
     * playing — a roster read at START could already be stale.
     */
    private ensurePlayers(ids: number[]): void {
        const unchanged = ids.length === gameState.players.length
            && ids.every((id, i) => gameState.players[i].id === id);
        if (unchanged) return;

        gameState.players = ids.map(id => makeRenderOnlyPlayer(id, this.playerStart));
        // Player actors first, so enemies draw over them — the same order the
        // host builds, because the client draws the same list.
        gameState.gameObjects = [...gameState.players.map(p => p.actor), ...gameState.enemies];
    }
}

/**
 * Write positions for everyone, interpolated between two snapshots.
 *
 * `skipId` is the locally predicted player, whose position comes from the
 * prediction instead.
 */
function writePositions(a: Snapshot, b: Snapshot | null, t = 1, skipId: number | null = null): void {
    for (const player of gameState.players) {
        if (player.id === skipId) continue;
        const from = a.players.find(p => p.id === player.id);
        if (from === undefined) continue;
        const to = b?.players.find(p => p.id === player.id) ?? null;
        player.actor.x = blend(from.x, to?.x, t);
        player.actor.y = blend(from.y, to?.y, t);
        player.actor.moveDir = (to ?? from).dir;
    }

    for (let i = 0; i < gameState.enemies.length && i < a.enemies.length; i++) {
        const from = a.enemies[i];
        const to = b === null ? null : b.enemies[i] ?? null;
        gameState.enemies[i].x = blend(from.x, to?.x, t);
        gameState.enemies[i].y = blend(from.y, to?.y, t);
        gameState.enemies[i].moveDir = (to ?? from).dir;
    }
}

/**
 * A tunnel wrap is a teleport, not a movement, so interpolating it would slide
 * the actor back across the whole maze. Anything that big is taken whole.
 */
const TELEPORT_GAP = unit * 8;

function blend(from: number, to: number | undefined, t: number): number {
    if (to === undefined) return from;
    if (Math.abs(to - from) > TELEPORT_GAP) return t < 1 ? from : to;
    return from + (to - from) * t;
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

function snapTo(player: PlayerState, authority: SnapshotPlayer): void {
    player.actor.x = authority.x;
    player.actor.y = authority.y;
    player.actor.moveDir = authority.dir;
}

function playEvent(event: NetEvent): void {
    switch (event.e) {
        case 'dot':        Sound.dot();        break;
        case 'power':      Sound.energizer();  break;
        case 'eatEnemy':   Sound.enemyEaten(); break;
        case 'death':      Sound.death();      break;
        case 'levelClear': Sound.levelClear(); break;
        // The fruit and the extra life are scored, not sounded, on the host.
        case 'fruit':
        case 'extraLife':  break;
    }
}

function makeRenderOnlyPlayer(id: number, start: { x: number; y: number }): PlayerState {
    let player!: PlayerState;
    const actor = new GameObject(
        'yellow', start.x, start.y, 0.667,
        () => {},                       // the host moves this one
        (obj) => Draw.player(obj, player),
        () => {},                       // eaten dots arrive in snapshots
        () => {},
    );
    player = {
        id, actor, input: new RemotePlayerInput(),
        frozen: false, dying: false, deathProgress: 0, active: true,
    };
    return player;
}

function makeRenderOnlyEnemy(color: string, starts: LevelData['enemyStarts']): IGameObject {
    const start = starts[`${color}Enemy` as keyof LevelData['enemyStarts']];
    const enemy: IGameObject = new GameObject(color, start.x, start.y, 0.667, () => {}, Draw.enemy, () => {}, () => {});
    enemy.enemyMode = 'house';
    return enemy;
}
