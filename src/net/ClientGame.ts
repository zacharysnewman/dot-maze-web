import { gameState } from '../game-state';
import { GameObject } from '../object/GameObject';
import { Draw } from '../static/Draw';
import { Levels } from '../static/Levels';
import { Sound } from '../static/Sound';
import { Stats } from '../static/Stats';
import { Time } from '../static/Time';
import type { IGameObject, LevelData, PlayerState } from '../types';
import { RemotePlayerInput } from './RemotePlayerInput';
import type { NetEvent, Snapshot } from './Protocol';
import { tileFromIndex } from './Protocol';
import { TILE_EMPTY } from '../tiles';

const ENEMY_COLORS = ['red', 'cyan', 'hotpink', 'orange'] as const;

/** Far enough ahead that `Draw.fruit` never expires it; the host decides. */
const FRUIT_NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

/**
 * The client's copy of the world.
 *
 * Nothing here simulates. `GameObject` takes its move and draw functions as
 * separate constructor arguments, so an actor built with a no-op move function
 * only draws — and the snapshot writes `x`, `y` and `moveDir` straight onto it
 * before each frame. That is why a render-only client needed no sim/render
 * split: the split was already in the constructor.
 */
export class ClientGame {
    private lastLevel = 0;
    private readonly playerStart: { x: number; y: number };

    constructor(level: LevelData) {
        gameState.currentLevel = level;
        Levels.levelSetup   = level.tiles;
        Levels.levelDynamic = level.tiles.map(row => [...row]);
        this.playerStart = level.playerStart;

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

    /** Write a snapshot onto the world, then let the normal draw path run. */
    apply(snap: Snapshot): void {
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
            player.actor.x = p.x;
            player.actor.y = p.y;
            player.actor.moveDir = p.dir;
            player.active = p.active;
            player.dying = p.dying;
            player.deathProgress = p.deathProgress;
            player.frozen = p.frozen;
        }

        for (let i = 0; i < gameState.enemies.length && i < snap.enemies.length; i++) {
            const enemy = gameState.enemies[i];
            enemy.x = snap.enemies[i].x;
            enemy.y = snap.enemies[i].y;
            enemy.moveDir = snap.enemies[i].dir;
            enemy.enemyMode = snap.enemies[i].mode;
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

        for (const event of snap.events) playEvent(event);
    }

    /** One frame of the host's game, drawn from whatever the last snapshot said. */
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
        gameState.players = [];
        gameState.gameObjects = [];
        gameState.enemies = [];
    }
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

/** Client frames still need `Time` advanced — animations and flashing read it. */
export function advanceClientTime(): void {
    Time.update();
}
