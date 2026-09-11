import { unit } from './constants';
import { gameState } from './game-state';
import { Time }  from './static/Time';
import { Draw }  from './static/Draw';
import { Move }  from './static/Move';
import { startEditorMode } from './editor/EditorLoop';
import { AI }    from './static/AI';
import { Levels } from './static/Levels';
import {
    getCurrentPlayerSpeed, getEnemyFrightSpeed, getEnemyNormalSpeed,
    getEnemyTunnelSpeed, getPlayerNormalSpeed,
} from './static/Speeds';
import { Stats }  from './static/Stats';
import type { HighScoreEntry } from './static/Stats';
import { Sound }  from './static/Sound';
import { GameObject } from './object/GameObject';
import type { IGameObject, Direction, PlayerState, LevelData } from './types';
import type { PlayerInput } from './input/PlayerInput';

// Confirmed player slot: id + pre-constructed input instance
interface ConfirmedSlot { id: number; input: PlayerInput }
import { KeyboardPlayerInput } from './input/KeyboardPlayerInput';
import { TouchPlayerInput    } from './input/TouchPlayerInput';
import { GamepadPlayerInput  } from './input/GamepadPlayerInput';
import { CompositePlayerInput } from './input/CompositePlayerInput';
import { RemotePlayerInput } from './net/RemotePlayerInput';
import type { InputMsg } from './net/Protocol';
import { encodeHeld, encodeMessage, decodeMessage } from './net/Protocol';
import { NetHost } from './net/NetHost';
import { NetClient } from './net/NetClient';
import type { JoinFailure } from './net/NetClient';
import type { CodeEntry, LobbyView } from './net/LobbyScreen';
import { drawClientGameOver, drawLobbyScreen, drawWaitingBanner, hitsLeaveButton, hitsMapButton, hitsStartButton, showCodeEntry } from './net/LobbyScreen';
import { openLibraryModal } from './editor/LibraryModal';
import { validateLevel } from './editor/Validate';
import { getTileSet } from './editor/TileSet';
import { deepCopyLevel } from './editor/EditorState';
import { NetEvents } from './net/NetEvents';
import { InputSampler } from './net/InputSampler';
import { ClientGame } from './net/ClientGame';
import type { ConnectionState } from './net/NetClient';
import type { HostPhase, Snapshot } from './net/Protocol';
import { ENEMY_POPUP_SECONDS, FRUIT_POPUP_SECONDS, SNAPSHOT_HZ, tileIndex } from './net/Protocol';


// Enemy eye-return speed (constant regardless of level)
const SPEED_EYES = 1.5;

// ── Fruit (Phase 7) ───────────────────────────────────────────────────────────

const FRUIT_DURATION = 9.5; // seconds

function getFruitPoints(level: number): number {
    if (level === 1) return 100;
    if (level === 2) return 300;
    if (level <= 4)  return 500;
    if (level <= 6)  return 700;
    if (level <= 8)  return 1000;
    if (level <= 10) return 2000;
    if (level <= 12) return 3000;
    return 5000;
}

function spawnFruit(): void {
    const { x, y } = gameState.currentLevel.fruitSpawn;
    gameState.fruitActive = { x: x * unit + unit / 2, y: y * unit + unit / 2, endTime: Time.timeSinceStart + FRUIT_DURATION };
}

function updateFruit(): void {
    if (gameState.fruitActive && Time.timeSinceStart >= gameState.fruitActive.endTime) {
        gameState.fruitActive = null;
    }
}

function checkFruitCollision(): void {
    if (!gameState.fruitActive) return;
    const { x: fx, y: fy } = gameState.fruitActive;
    for (const player of gameState.players) {
        if (player.active && Math.abs(player.actor.x - fx) < unit && Math.abs(player.actor.y - fy) < unit) {
            const score = getFruitPoints(gameState.level);
            Stats.addToScore(score);
            gameState.scorePopups.push({ x: fx, y: fy, score, endTime: Time.timeSinceStart + FRUIT_POPUP_SECONDS });
            gameState.fruitActive = null;
            NetEvents.record({ e: 'fruit', score, x: fx, y: fy });
            break;
        }
    }
}

// ── Cruise Elroy (Phase 8) ────────────────────────────────────────────────────

// Dot count at which red enters Elroy 1 / Elroy 2 for the current level
function getElroyThreshold1(level: number): number {
    if (level === 1) return 20;
    if (level === 2) return 30;
    if (level <= 7)  return 40;
    if (level <= 10) return 50;
    if (level <= 13) return 60;
    if (level <= 17) return 80;
    return 100; // level 18+
}

function getElroyThreshold2(level: number): number {
    if (level === 1) return 10;
    if (level === 2) return 15;
    if (level <= 7)  return 20;
    if (level <= 10) return 25;
    if (level <= 13) return 30;
    if (level <= 17) return 40;
    return 50; // level 18+
}

function getElroySpeed1(level: number): number {
    if (level === 1) return 0.80;
    if (level <= 4)  return 0.90;
    return 1.00; // level 5+
}

function getElroySpeed2(level: number): number {
    if (level === 1) return 0.85;
    if (level <= 4)  return 0.95;
    return 1.05; // level 5+
}

// Total collectible dot count (240 small dots + 4 energizers)
const TOTAL_DOTS = 244;

function updateElroy(): void {
    if (gameState.elroySuspended) {
        gameState.elroyLevel = 0;
        return;
    }
    const remaining = TOTAL_DOTS - gameState.dotsEaten;
    if (remaining <= getElroyThreshold2(gameState.level)) {
        gameState.elroyLevel = 2;
    } else if (remaining <= getElroyThreshold1(gameState.level)) {
        gameState.elroyLevel = 1;
    } else {
        gameState.elroyLevel = 0;
    }
}

// Returns the speed the Player should be moving at right now (used after a dot pause)
function isEnemyInTunnel(enemy: IGameObject): boolean {
    const x = enemy.roundedX();
    const y = enemy.roundedY();
    return gameState.currentLevel.tunnelSlowTiles.some(t => t.x === x && t.y === y);
}

// Apply correct speed to all active enemies based on their current mode and position
function updateEnemyTunnelSpeeds(): void {
    if (gameState.frozen || gameState.gameOver) return;
    for (const enemy of gameState.enemies) {
        // Modes managed outside this function
        if (enemy.enemyMode === 'eyes' || enemy.enemyMode === 'entering' ||
            enemy.enemyMode === 'house' || enemy.enemyMode === 'exiting') continue;

        if (isEnemyInTunnel(enemy)) {
            enemy.moveSpeed = getEnemyTunnelSpeed(gameState.level);
        } else if (enemy.enemyMode === 'frightened') {
            enemy.moveSpeed = getEnemyFrightSpeed(gameState.level);
        } else if (enemy.color === 'red' && gameState.elroyLevel > 0) {
            // Cruise Elroy: red gets a speed boost in chase/scatter mode
            enemy.moveSpeed = gameState.elroyLevel === 2
                ? getElroySpeed2(gameState.level)
                : getElroySpeed1(gameState.level);
        } else {
            enemy.moveSpeed = getEnemyNormalSpeed(gameState.level);
        }
    }
}

// Personal dot-counter limits per enemy color and level group (Phase 3)
function getPersonalLimit(color: string, level: number): number {
    if (color === 'hotpink') return 0;
    if (color === 'cyan')    return level === 1 ? 30 : 0;
    if (color === 'orange')  return level === 1 ? 60 : level === 2 ? 50 : 0;
    return 0;
}

// Global counter thresholds after a life is lost
const GLOBAL_THRESHOLDS: Record<string, number> = {
    'hotpink': 7,
    'cyan':    17,
    'orange':  32,
};

function tileToPixel(tileX: number, tileY: number): { x: number; y: number } {
    return { x: tileX * unit + unit / 2, y: tileY * unit + unit / 2 };
}

function oppositeDir(dir: Direction): Direction {
    const opp: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' };
    return opp[dir];
}

// Frightened duration by level (seconds; 0 = reverse only, no blue)
function getFrightenedDuration(level: number): number {
    return Draw.getFrightenedDuration(level);
}

// Returns true if enemy can physically move in dir from its current rounded tile
function canEnemyMoveDir(enemy: IGameObject, dir: Direction): boolean {
    const onTunnelRow = Levels.wrapsAt(gameState.currentLevel, enemy.roundedY());
    switch (dir) {
        case 'left':  return (enemy.leftObject()   ?? 0) > 2 || (onTunnelRow && enemy.leftObject()  === undefined);
        case 'right': return (enemy.rightObject()  ?? 0) > 2 || (onTunnelRow && enemy.rightObject() === undefined);
        case 'up':    return (enemy.topObject()    ?? 0) > 2;
        case 'down':  return (enemy.bottomObject() ?? 0) > 2;
    }
}

// ── Scatter/Chase Timer ───────────────────────────────────────────────────────

function resetScatterChaseTimer(): void {
    gameState.scatterChaseIndex = 0;
    gameState.scatterChaseElapsed = 0;
    for (const enemy of gameState.enemies) {
        if (enemy.enemyMode !== 'frightened' && enemy.enemyMode !== 'eyes' &&
            enemy.enemyMode !== 'entering' && enemy.enemyMode !== 'house' &&
            enemy.enemyMode !== 'exiting') {
            enemy.enemyMode = 'scatter';
        }
    }
}

function updateScatterChaseMode(dt: number): void {
    if (gameState.frozen || gameState.gameOver) return;
    // Pause timer while any enemy is frightened (Phase 4 requirement)
    if (gameState.enemies.some(g => g.enemyMode === 'frightened')) return;

    const duration = AI.getCurrentPhaseDuration();
    if (duration < 0) return; // indefinite phase

    gameState.scatterChaseElapsed += dt;

    if (gameState.scatterChaseElapsed >= duration) {
        gameState.scatterChaseElapsed -= duration;
        if (gameState.scatterChaseIndex < AI.modePatterns.length - 1) {
            gameState.scatterChaseIndex++;
        }
        const newMode = AI.getCurrentGlobalMode();
        for (const enemy of gameState.enemies) {
            if (enemy.enemyMode === 'house') {
                // Track mode change so exit direction flips to right
                gameState.modeChangesInHouse[enemy.color] =
                    (gameState.modeChangesInHouse[enemy.color] ?? 0) + 1;
            } else if (enemy.enemyMode !== 'frightened' && enemy.enemyMode !== 'eyes' &&
                       enemy.enemyMode !== 'entering' && enemy.enemyMode !== 'exiting') {
                enemy.enemyMode = newMode;
                reverseEnemy(enemy);
            }
        }
    }
}

// ── Frightened Mode ───────────────────────────────────────────────────────────

// Reverse an enemy's direction; if the reversed direction is into a wall, keep current
function reverseEnemy(enemy: IGameObject): void {
    const rev = oppositeDir(enemy.moveDir);
    if (canEnemyMoveDir(enemy, rev)) enemy.moveDir = rev;
}

function activateFrightened(): void {
    const duration = getFrightenedDuration(gameState.level);
    gameState.enemyEatenChain = 0;

    if (duration <= 0) {
        // Zero duration: reverse enemies but don't turn them blue
        for (const enemy of gameState.enemies) {
            if (enemy.enemyMode !== 'eyes' && enemy.enemyMode !== 'entering' &&
                enemy.enemyMode !== 'house' && enemy.enemyMode !== 'exiting') {
                reverseEnemy(enemy);
            }
        }
        return;
    }

    // Reset countdown (use game-time delta so pauses don't eat into it)
    gameState.frightenedRemaining = duration;
    for (const enemy of gameState.enemies) {
        if (enemy.enemyMode !== 'eyes' && enemy.enemyMode !== 'entering' &&
            enemy.enemyMode !== 'house' && enemy.enemyMode !== 'exiting') {
            enemy.enemyMode = 'frightened';
            reverseEnemy(enemy);
            enemy.moveSpeed = getEnemyFrightSpeed(gameState.level);
        }
    }
}

function updateFrightenedMode(dt: number): void {
    if (gameState.frightenedRemaining <= 0) return;
    // Pause the countdown during enemy-eating freeze so those pauses don't
    // consume vulnerability time (matches original arcade behavior)
    if (!gameState.players.some(p => p.frozen)) {
        gameState.frightenedRemaining -= dt;
    }
    if (gameState.frightenedRemaining > 0) return;

    gameState.frightenedRemaining = 0;
    const globalMode = AI.getCurrentGlobalMode();
    for (const enemy of gameState.enemies) {
        if (enemy.enemyMode === 'frightened') {
            enemy.enemyMode = globalMode;
            // Speed will be corrected by updateEnemyTunnelSpeeds() this same frame
        }
    }
    // Restore Player speed if not currently paused for a dot
    for (const player of gameState.players) {
        if (player.actor.moveSpeed !== 0) {
            player.actor.moveSpeed = getPlayerNormalSpeed(gameState.level);
        }
    }
}

function eatEnemy(enemy: IGameObject, player: PlayerState): void {
    const scores = [200, 400, 800, 1600];
    const score = scores[Math.min(gameState.enemyEatenChain, 3)];
    gameState.enemyEatenChain++;
    Stats.addToScore(score);

    // Show score popup at the capture location
    gameState.scorePopups.push({
        x: enemy.x,
        y: enemy.y,
        score,
        endTime: Time.timeSinceStart + ENEMY_POPUP_SECONDS,
    });

    // Freeze this player briefly while score is shown
    player.frozen = true;
    Time.addTimer(0.5, () => { player.frozen = false; });

    Sound.enemyEaten();
    NetEvents.record({
        e: 'eatEnemy',
        chain: gameState.enemyEatenChain,
        score,
        x: enemy.x,
        y: enemy.y,
    });

    // Enemy becomes eyes and speeds home
    enemy.enemyMode = 'eyes';
    enemy.moveSpeed = SPEED_EYES;
}

// ── Enemy House Release (Phase 3) ──────────────────────────────────────────────

function releaseEnemy(enemy: IGameObject): void {
    enemy.enemyMode = 'exiting';
    enemy.moveSpeed = getEnemyNormalSpeed(gameState.level);
    // Cruise Elroy resumes once orange begins exiting the enemy house
    if (enemy.color === 'orange' && gameState.elroySuspended) {
        gameState.elroySuspended = false;
    }
}

function getNextHouseEnemy(): IGameObject | null {
    for (const enemy of [gameState.hotpinkEnemy, gameState.cyanEnemy, gameState.orangeEnemy]) {
        if (enemy.enemyMode === 'house') return enemy;
    }
    return null;
}

// Release all house enemies whose personal counter has reached their limit (cascading)
function checkAndReleaseHouseEnemies(): void {
    if (gameState.useGlobalDotCounter) return; // global counter handles its own releases
    for (const enemy of [gameState.hotpinkEnemy, gameState.cyanEnemy, gameState.orangeEnemy]) {
        if (enemy.enemyMode !== 'house') continue;
        const limit = getPersonalLimit(enemy.color, gameState.level);
        if (gameState.personalDotCounters[enemy.color] >= limit) {
            releaseEnemy(enemy);
            // Don't break — next iteration picks up the newly-active enemy
        } else {
            break; // This enemy's counter is active and not yet at limit
        }
    }
}

function incrementDotCounters(): void {
    // Reset idle timer every time a dot is eaten
    gameState.idleTimer = 0;

    // Track total dots eaten this level for fruit spawning
    gameState.dotsEaten++;
    if (gameState.dotsEaten === 70 && !gameState.fruitSpawned1) {
        gameState.fruitSpawned1 = true;
        spawnFruit();
    } else if (gameState.dotsEaten === 170 && !gameState.fruitSpawned2) {
        gameState.fruitSpawned2 = true;
        spawnFruit();
    }

    if (gameState.useGlobalDotCounter) {
        gameState.globalDotCounter++;
        const gc = gameState.globalDotCounter;
        if (gc >= GLOBAL_THRESHOLDS['hotpink'] && gameState.hotpinkEnemy.enemyMode === 'house') {
            releaseEnemy(gameState.hotpinkEnemy);
        }
        if (gc >= GLOBAL_THRESHOLDS['cyan'] && gameState.cyanEnemy.enemyMode === 'house') {
            releaseEnemy(gameState.cyanEnemy);
        }
        if (gc >= GLOBAL_THRESHOLDS['orange'] && gameState.orangeEnemy.enemyMode === 'house') {
            releaseEnemy(gameState.orangeEnemy);
            gameState.useGlobalDotCounter = false; // deactivate (orange was inside at 32)
        }
        // If orange was already outside at 32, the counter keeps running (stuck-enemy exploit)
    } else {
        // Increment only the active enemy's personal counter (first one still in house)
        for (const enemy of [gameState.hotpinkEnemy, gameState.cyanEnemy, gameState.orangeEnemy]) {
            if (enemy.enemyMode === 'house') {
                gameState.personalDotCounters[enemy.color]++;
                break;
            }
        }
        checkAndReleaseHouseEnemies();
    }
}

function updateIdleTimer(dt: number): void {
    const hasHouseEnemy = [gameState.hotpinkEnemy, gameState.cyanEnemy, gameState.orangeEnemy]
        .some(g => g.enemyMode === 'house');
    if (!hasHouseEnemy) { gameState.idleTimer = 0; return; }

    gameState.idleTimer += dt;
    const limit = gameState.level >= 5 ? 3 : 4;
    if (gameState.idleTimer >= limit) {
        gameState.idleTimer = 0;
        const enemy = getNextHouseEnemy();
        if (enemy) releaseEnemy(enemy);
    }
}

// ── Game Object Callbacks ─────────────────────────────────────────────────────

function makeEnemyTileCentered(getEnemy: () => IGameObject): (_x: number, _y: number) => void {
    return (_x: number, _y: number) => {
        const enemy = getEnemy();
        // Skip AI for enemies managed by the house system
        if (enemy.enemyMode === 'house' || enemy.enemyMode === 'entering' || enemy.enemyMode === 'exiting') return;
        // Eyes arrive at enemy house entrance — align to center column and enter the house
        if (enemy.enemyMode === 'eyes' && enemy.roundedX() === 13 && enemy.roundedY() === 14) {
            enemy.x = 13 * unit + unit / 2; // snap to center column so entry goes straight down
            enemy.enemyMode = 'entering'; // keep SPEED_EYES — enemyEnter sets normal speed on exit
            return;
        }
        AI.enemyTileCenter(enemy);
    };
}

// ── Positions & Reset ─────────────────────────────────────────────────────────

function resetPositions(afterDeath = false): void {
    const lv = gameState.currentLevel;

    // Players
    const pmPos = tileToPixel(lv.playerStart.x, lv.playerStart.y);
    for (const player of gameState.players) {
        player.actor.x = pmPos.x; player.actor.y = pmPos.y;
        player.actor.moveDir = (player.id === 2 || player.id === 4) ? 'right' : 'left';
        player.actor.moveSpeed = getPlayerNormalSpeed(gameState.level);
        player.frozen = false;
    }

    // Red always starts outside
    const bl = gameState.redEnemy;
    const blPos = tileToPixel(lv.enemyStarts.redEnemy.x, lv.enemyStarts.redEnemy.y);
    bl.x = blPos.x; bl.y = blPos.y;
    bl.moveDir = 'left'; bl.moveSpeed = getEnemyNormalSpeed(gameState.level);
    bl.enemyMode = 'scatter';

    // House enemies reset to their starting positions inside
    const houseActors: Array<{ enemy: IGameObject; start: { x: number; y: number }; dir: Direction }> = [
        { enemy: gameState.hotpinkEnemy, start: lv.enemyStarts.hotpinkEnemy, dir: 'down' }, // center starts down
        { enemy: gameState.cyanEnemy,    start: lv.enemyStarts.cyanEnemy,    dir: 'up'   }, // left starts up
        { enemy: gameState.orangeEnemy,  start: lv.enemyStarts.orangeEnemy,  dir: 'up'   }, // right starts up
    ];
    for (const { enemy, start, dir } of houseActors) {
        const pos = tileToPixel(start.x, start.y);
        enemy.x = pos.x; enemy.y = pos.y;
        enemy.moveDir = dir;
        enemy.moveSpeed = 1.0;  // bounce/exit uses fixed speed; maze speed applied on release
        enemy.enemyMode = 'house';
    }

    // Enemy house release state
    gameState.useGlobalDotCounter = afterDeath;
    gameState.globalDotCounter = 0;
    if (!afterDeath) {
        // Level start: reset personal counters
        gameState.personalDotCounters = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };
    }
    // Always reset mode-change tracking and idle timer
    gameState.modeChangesInHouse = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };
    gameState.idleTimer = 0;

    gameState.frightenedRemaining = 0;
    gameState.enemyEatenChain = 0;
    gameState.scorePopups = [];
    gameState.fruitActive = null;
    // Cruise Elroy: suspend after death; clear for fresh level start
    gameState.elroyLevel = 0;
    gameState.elroySuspended = afterDeath;
    resetScatterChaseTimer();
    AI.resetPrng();

    // Immediately release any enemy whose counter is already at its limit (e.g. hotpink=0)
    checkAndReleaseHouseEnemies();
}

function countRemainingDots(): number {
    let count = 0;
    for (const row of Levels.levelDynamic) {
        for (const tile of row) {
            if (tile === 3 || tile === 4) count++;
        }
    }
    return count;
}

function levelClear(): void {
    gameState.frozen = true;
    Sound.levelClear();
    NetEvents.record({ e: 'levelClear' });
    gameState.fruitHistory.push(gameState.level);
    Time.addTimer(1.5, () => {
        gameState.level++;
        Levels.levelDynamic = gameState.currentLevel.tiles.map(row => [...row]);
        gameState.dotsEaten = 0;
        gameState.fruitSpawned1 = false;
        gameState.fruitSpawned2 = false;
        gameState.fruitActive = null;
        // Revive everyone still connected. A held seat stays sat out; reviving
        // an absent player would feed the shared life pool to an empty chair.
        for (const p of gameState.players) {
            if (disconnectedPlayers.has(p.id)) continue;
            p.active = true;
            p.dying = false;
        }
        resetPositions(false);
        gameState.showReady = true;
        Time.addTimer(1.5, () => {
            gameState.frozen = false;
            gameState.showReady = false;
            staggerLateStarters();
        });
    });
}

function showInitialsEntry(onDone: () => void): void {
    Sound.stopSiren();
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:2000',
        'background:rgba(0,0,0,0.9)',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px',
        'padding-bottom:20vh', // shifts content up ~10% of screen height, clear of mobile keyboard
        'font-family:monospace;color:white',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'ENTER INITIALS';
    title.style.cssText = 'font-size:28px;font-weight:bold;color:yellow;letter-spacing:4px';

    const scoreEl = document.createElement('div');
    scoreEl.textContent = `SCORE  ${Stats.currentScore}`;
    scoreEl.style.cssText = 'font-size:22px';

    // Hidden input — captures keyboard / mobile keyboard; opacity:0 keeps it in the flow
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 3;
    (input as HTMLInputElement & { autocomplete: string }).autocomplete = 'off';
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'characters');
    // font-size ≥16px prevents iOS Safari from zooming when focused.
    // Covers the full overlay so any tap anywhere opens the keyboard.
    // z-index kept below the DONE button (which gets z-index:1).
    input.style.cssText = [
        'position:absolute;inset:0;width:100%;height:100%',
        'opacity:0.01;font-size:16px;cursor:text;z-index:0',
        'background:transparent;border:none;outline:none;color:transparent;caret-color:transparent',
    ].join(';');

    // Three slot divs — fixed width for monospaced look regardless of font
    // Wrap in a relative container so the input can be overlaid for direct iOS taps
    const slotsWrap = document.createElement('div');
    slotsWrap.style.cssText = 'position:relative;display:flex;gap:20px;cursor:text;padding:8px 16px';

    const slotEls: HTMLDivElement[] = [];
    for (let i = 0; i < 3; i++) {
        const slot = document.createElement('div');
        slot.style.cssText = [
            'width:84px;text-align:center',
            'font-size:84px;font-weight:bold',
            'border-bottom:3px solid #666',
            'padding-bottom:6px;line-height:1.1',
            'color:#444',
        ].join(';');
        slot.textContent = '_';
        slotsWrap.appendChild(slot);
        slotEls.push(slot);
    }
    // Input is appended to the overlay (full-screen) instead of slotsWrap

    const hint = document.createElement('div');
    hint.textContent = 'TAP ANYWHERE TO ENTER INITIALS';
    hint.style.cssText = 'font-size:20px;color:#666;letter-spacing:2px;text-align:center';

    const btn = document.createElement('button');
    btn.textContent = 'DONE';
    btn.style.cssText = [
        'font-family:monospace;font-size:48px;font-weight:bold',
        'background:#222;color:white;border:2px solid #888',
        'border-radius:8px;padding:24px 80px;cursor:default;letter-spacing:2px',
    ].join(';');

    function updateSlots(): void {
        const val = input.value;
        const done = val.length >= 3;
        for (let i = 0; i < 3; i++) {
            const filled = i < val.length;
            const active = i === val.length;
            slotEls[i].textContent = filled ? val[i] : '_';
            slotEls[i].style.color = filled ? 'yellow' : (active ? '#aaa' : '#444');
            slotEls[i].style.borderBottomColor = active ? 'white' : (filled ? 'yellow' : '#444');
        }
        // Gray out DONE until all 3 letters entered
        btn.style.opacity = done ? '1' : '0.35';
        btn.style.cursor  = done ? 'pointer' : 'default';
        // Hide hint once typing starts
        hint.style.visibility = val.length === 0 ? 'visible' : 'hidden';
    }
    updateSlots();

    function submit(): void {
        const raw = input.value.replace(/[^A-Za-z]/g, '');
        if (raw.length < 3) return; // require exactly 3 letters
        Stats.saveScore(raw.toUpperCase().slice(0, 3), Stats.currentScore);
        document.body.removeChild(overlay);
        onDone();
    }

    input.oninput = () => {
        input.value = input.value.replace(/[^A-Za-z]/g, '').toUpperCase();
        updateSlots();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    btn.style.position = 'relative';
    btn.style.zIndex   = '1'; // sit above the full-screen input
    btn.onclick = (e) => { e.stopPropagation(); submit(); };

    overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('click',      (e) => e.stopPropagation());

    // input is position:absolute inset:0 — contained by the fixed overlay (full screen)
    overlay.append(title, scoreEl, slotsWrap, hint, btn, input);
    document.body.appendChild(overlay);
    // Best-effort autofocus for non-iOS browsers; iOS requires a direct tap on the input
    setTimeout(() => input.focus(), 80);
}

const DEATH_ANIM_DURATION = 2.0;

// Stagger P3 and P4 by 0.5 s after each READY! so starts feel less chaotic
function staggerLateStarters(): void {
    for (const p of gameState.players) {
        if (p.id === 3 || p.id === 4) {
            p.frozen = true;
            Time.addTimer(0.5, () => { p.frozen = false; });
        }
    }
}

function triggerGameOver(): void {
    gameState.gameOver = true;
    gameState.frozen = true;
    if (testMode) {
        setTimeout(() => { returningToEditor = true; }, 1500);
        return;
    }
    // An online host falls back to its own lobby, code still live and roster
    // intact, rather than to the menu. Game over ends the game, not the room.
    const hosting = isNetHosting();
    if (hosting) setHostPhase('gameover');

    // Use native setTimeout so the transition is independent of the game-loop
    // timer system — any error in a pending Time.addTimer callback won't block it.
    setTimeout(() => {
        const done = (): void => {
            if (hosting) returningToLobby = true;
            else returningToMenu = true;
        };
        if (Stats.qualifiesForTopTen(Stats.currentScore)) {
            // Clients sit on GAME OVER meanwhile — the host saves the score, so
            // there is nothing for them to type, only something to wait for.
            if (hosting) setHostPhase('initials');
            showInitialsEntry(done);
        } else {
            setTimeout(done, 2000);
        }
    }, 1500);
}

function loseLife(player: PlayerState): void {
    if (player.dying || !player.active || gameState.gameOver) return;
    player.dying = true;
    player.deathProgress = 0;
    Sound.death();
    NetEvents.record({ e: 'death', playerId: player.id });

    Time.addTimer(DEATH_ANIM_DURATION, () => {
        // levelClear() resets dying to false — if it already fired, skip this death entirely
        if (!player.dying) return;
        // Guard: another player's death may have already triggered game over in the same frame
        if (gameState.gameOver) return;
        player.dying = false;
        player.active = false;

        const anyoneAlive = gameState.players.some(p => p.active);
        if (anyoneAlive) {
            // Other players still alive — dead player sits out until next level
        } else if (gameState.sharedLives > 0) {
            // All players down but lives remain — spend one and revive everyone
            gameState.sharedLives--;
            // Revive everyone still connected — see levelClear.
            for (const p of gameState.players) {
                if (disconnectedPlayers.has(p.id)) continue;
                p.active = true;
                p.dying = false;
            }
            resetPositions(true);
            gameState.showReady = true;
            gameState.frozen = true;
            Time.addTimer(1.5, () => {
                gameState.frozen = false;
                gameState.showReady = false;
                staggerLateStarters();
            });
        } else {
            // All players dead with no lives remaining
            triggerGameOver();
        }
    });
}

// ── Collision Detection ───────────────────────────────────────────────────────

function checkCollisions(): void {
    for (const player of gameState.players) {
        if (!player.active || player.dying || player.frozen) continue;
        const px = player.actor.roundedX();
        const py = player.actor.roundedY();
        for (const enemy of gameState.enemies) {
            if (enemy.roundedX() === px && enemy.roundedY() === py) {
                if (enemy.enemyMode === 'frightened') {
                    eatEnemy(enemy, player);
                } else if (enemy.enemyMode !== 'eyes' && enemy.enemyMode !== 'entering' &&
                           enemy.enemyMode !== 'house' && enemy.enemyMode !== 'exiting') {
                    loseLife(player);
                    break; // stop checking enemies for this player; continue to next player
                }
            }
        }
    }
}

// ── Player Tile Callbacks ───────────────────────────────────────────────────────

function makePlayerOnTileChanged(player: PlayerState): (x: number, y: number) => void {
    return (x: number, y: number) => {
        const curTile = Levels.levelDynamic[y][x];

        // Small dot
        if (curTile === 3) {
            Levels.levelDynamic[y][x] = 5;
            Stats.addToScore(10);
            player.actor.moveSpeed = 0.0;
            Time.addTimer(0.01666666667, () => { player.actor.moveSpeed = getCurrentPlayerSpeed(); });
            incrementDotCounters();
            Sound.dot();
            NetEvents.record({ e: 'dot' });
            NetEvents.recordEaten(x, y);
            if (countRemainingDots() === 0) levelClear();
        }

        // Power pellet — triggers frightened mode
        if (curTile === 4) {
            Levels.levelDynamic[y][x] = 5;
            Stats.addToScore(50);
            player.actor.moveSpeed = 0.0;
            Time.addTimer(0.05, () => { player.actor.moveSpeed = getCurrentPlayerSpeed(); });
            incrementDotCounters();
            Sound.energizer();
            NetEvents.record({ e: 'power' });
            NetEvents.recordEaten(x, y);
            activateFrightened();
            if (countRemainingDots() === 0) levelClear();
        }
    };
}

function enemyOnTileChanged(_x: number, _y: number): void {}

// ── Initialization ────────────────────────────────────────────────────────────

function createPlayer(id: number, startTile: { x: number; y: number }, input: PlayerInput): PlayerState {
    let playerState!: PlayerState;
    const actor = new GameObject(
        'yellow',
        startTile.x, startTile.y,
        0.667,
        () => Move.player(playerState),
        (obj) => Draw.player(obj, playerState),
        (x, y) => makePlayerOnTileChanged(playerState)(x, y),
        (_x, _y) => {},
    );
    playerState = { id, actor, input, frozen: false, dying: false, deathProgress: 0, active: true };
    return playerState;
}

function initializeLevel(slots: ConfirmedSlot[], levelOverride?: LevelData): void {
    gameState.currentLevel = levelOverride ?? Levels.level1Data;
    const lv = gameState.currentLevel;

    Levels.levelSetup   = lv.tiles;
    Levels.levelDynamic = lv.tiles.map(row => [...row]);

    // Pre-initialize personal counters so resetPositions can reference them
    gameState.personalDotCounters = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };
    gameState.modeChangesInHouse  = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };

    // Create all players from confirmed slots
    gameState.players = slots.map(s => createPlayer(s.id, lv.playerStart, s.input));

    const es = lv.enemyStarts;
    gameState.redEnemy     = new GameObject('red',     es.redEnemy.x,     es.redEnemy.y,     0.667, Move.redEnemy,     Draw.enemy, enemyOnTileChanged, makeEnemyTileCentered(() => gameState.redEnemy));
    gameState.cyanEnemy    = new GameObject('cyan',    es.cyanEnemy.x,    es.cyanEnemy.y,    0.667, Move.cyanEnemy,    Draw.enemy, enemyOnTileChanged, makeEnemyTileCentered(() => gameState.cyanEnemy));
    gameState.hotpinkEnemy = new GameObject('hotpink', es.hotpinkEnemy.x, es.hotpinkEnemy.y, 0.667, Move.hotpinkEnemy, Draw.enemy, enemyOnTileChanged, makeEnemyTileCentered(() => gameState.hotpinkEnemy));
    gameState.orangeEnemy  = new GameObject('orange',  es.orangeEnemy.x,  es.orangeEnemy.y,  0.667, Move.orangeEnemy,  Draw.enemy, enemyOnTileChanged, makeEnemyTileCentered(() => gameState.orangeEnemy));

    // Player actors drawn first (under enemies)
    gameState.gameObjects = [...gameState.players.map(p => p.actor), gameState.redEnemy, gameState.cyanEnemy, gameState.hotpinkEnemy, gameState.orangeEnemy];
    gameState.enemies      = [gameState.redEnemy, gameState.cyanEnemy, gameState.hotpinkEnemy, gameState.orangeEnemy];

    // resetPositions sets all positions, modes, and triggers initial house releases
    resetPositions(false);
}

// ── Ambient Siren ─────────────────────────────────────────────────────────────

function updateAmbientSiren(): void {
    if (gameState.enemies.some(g => g.enemyMode === 'eyes')) {
        Sound.startSiren('eyes');
    } else if (gameState.frightenedRemaining > 0) {
        Sound.startSiren('blue');
    } else {
        Sound.startSiren('normal');
    }
}

// ── Main Update Loop ──────────────────────────────────────────────────────────

/**
 * Debug harness for the multiplayer input path: take player 1's input, encode
 * it as an InputMsg, run it back through the codec, and feed the result to
 * every RemotePlayerInput in the game. Phantom players then mirror player 1.
 *
 * There is no transport yet, so this is what proves the
 * encode -> decode -> RemotePlayerInput -> actor path works end to end.
 */
function feedDebugNetLoopback(): void {
    const source = gameState.players.find(p => !(p.input instanceof RemotePlayerInput));
    if (source === undefined) return;

    const msg: InputMsg = {
        t: 'input',
        held: encodeHeld(source.input),
        buffered: source.input.bufferedDir,
        seq: ++debugNetSeq,
    };

    const decoded = decodeMessage(encodeMessage(msg));
    if (decoded === null || decoded.t !== 'input') return;

    for (const p of gameState.players) {
        if (p.input instanceof RemotePlayerInput) p.input.receive(decoded);
    }
}

function update(): void {
    try { Time.update(); } catch (e) { console.error('Time.update error:', e); }

    if (returningToEditor) {
        returningToEditor = false;
        testMode = false;
        Sound.stopSiren();
        for (const p of gameState.players) p.input.destroy();
        gameState.players = [];
        gameStarted = false;
        document.removeEventListener('keydown', testModeEscHandler);
        const cb = editorReturnCallback;
        editorReturnCallback = null;
        if (cb) cb();
        return;
    }

    if (returningToLobby) {
        returningToLobby = false;
        Sound.stopSiren();
        // Tell the clients where the host went before the world they are
        // drawing is torn down.
        setHostPhase('lobby');
        broadcastSnapshotNow();
        NetEvents.setRecording(false);
        // Seat inputs belong to NetHost and are reused by the next game, so
        // only the host's own input is destroyed with the player list.
        for (const p of gameState.players) {
            if (!(p.input instanceof RemotePlayerInput)) p.input.destroy();
        }
        gameState.players = [];
        gameState.gameObjects = [];
        gameStarted = true; // the lobby is a screen, not the menu
        netHost?.setInProgress(false);
        if (lobbyView !== null) {
            lobbyView.status = lobbyStatusFor(netHost?.roster().length ?? 1);
            lobbyView.roster = netHost?.roster() ?? lobbyView.roster;
        }
        enterLobby();
        return;
    }

    if (returningToMenu || returningToPlayerSelect) {
        const toSelect = returningToPlayerSelect;
        returningToMenu = false;
        returningToPlayerSelect = false;
        Sound.stopSiren();
        for (const p of gameState.players) p.input.destroy();
        gameState.players = [];
        if (toSelect) {
            gameStarted = true; // keep startScreenLoop from re-entering
            playerSelectLoop();
        } else {
            gameStarted = false;
            menuMusicPlaying = false;
            document.onkeydown = menuKeyHandler;
            startScreenLoop();
        }
        return;
    }

    if (!gameState.frozen && !gameState.gameOver) {
        if (debugNetLoopback) feedDebugNetLoopback();
        for (const p of gameState.players) {
            if (p.active && !p.dying) p.input.update(p.actor);
        }
        updateScatterChaseMode(Time.deltaTime);
        updateFrightenedMode(Time.deltaTime);
        updateElroy();
        updateEnemyTunnelSpeeds();
        updateIdleTimer(Time.deltaTime);
        updateFruit();
        updateAmbientSiren();
    } else {
        Sound.stopSiren();
    }

    for (const p of gameState.players) {
        if (p.dying) {
            p.deathProgress = Math.min(p.deathProgress + Time.deltaTime / DEATH_ANIM_DURATION, 1.0);
        }
    }

    Draw.level();
    Draw.advancePlayerAnim();

    for (const go of gameState.gameObjects) {
        go.update();
    }

    Draw.scorePopups();
    Draw.debug();
    Draw.readyText();

    if (!gameState.frozen && !gameState.gameOver) {
        checkCollisions();
        checkFruitCollision();
    }

    Draw.hud();

    if (gameState.gameOver) {
        Draw.gameOverScreen();
    }

    broadcastSnapshotIfDue();

    window.requestAnimationFrame(update);
}

/** 60 Hz render, 20 Hz on the wire — every third frame. */
const FRAMES_PER_SNAPSHOT = Math.round(60 / SNAPSHOT_HZ);

// How long a client can go quiet before the host lets go of their controls,
// and before it holds their seat and sits them out. See NetHost.presenceCheck.
const INPUT_SILENCE_MS = 1000;
const PRESENCE_TIMEOUT_MS = 8000;

function broadcastSnapshotIfDue(): void {
    if (netHost === null || hostPhase === 'lobby') return;
    netHost.presenceCheck(INPUT_SILENCE_MS, PRESENCE_TIMEOUT_MS);
    snapshotTick++;
    if (snapshotTick % FRAMES_PER_SNAPSHOT !== 0) return;
    netHost.broadcastSnapshot(buildSnapshot());
}

/**
 * Send state now rather than on the next tick. Used for the last snapshot of a
 * game, the one that tells clients the host has gone back to the lobby — after
 * it, this loop stops and there is no next tick.
 */
function broadcastSnapshotNow(): void {
    netHost?.broadcastSnapshot(buildSnapshot());
}

/**
 * `forWelcome` builds the state a joiner or a returning player needs, which is
 * not the same as the next broadcast. It carries every tile eaten so far rather
 * than the handful since the last snapshot — a delta means nothing to someone
 * who has never seen the ones before it — and it takes no events, because
 * draining them here would steal sounds from everyone else's next snapshot.
 */
function buildSnapshot(forWelcome = false): Snapshot {
    const { events, eaten } = forWelcome
        ? { events: [], eaten: allEatenTiles() }
        : NetEvents.drain();
    return {
        t: 'snap',
        tick: snapshotTick,
        ack: netHost?.acks() ?? {},
        players: gameState.players.map(p => ({
            id: p.id,
            x: p.actor.x,
            y: p.actor.y,
            dir: p.actor.moveDir,
            active: p.active,
            dying: p.dying,
            deathProgress: p.deathProgress,
            frozen: p.frozen,
        })),
        enemies: gameState.enemies.map(e => ({
            x: e.x,
            y: e.y,
            dir: e.moveDir,
            mode: e.enemyMode ?? 'house',
        })),
        score: Stats.currentScore,
        lives: gameState.sharedLives,
        level: gameState.level,
        frightenedRemaining: gameState.frightenedRemaining,
        fruit: gameState.fruitActive === null
            ? null
            : { x: gameState.fruitActive.x, y: gameState.fruitActive.y },
        showReady: gameState.showReady,
        frozen: gameState.frozen,
        gameOver: gameState.gameOver,
        hostPhase,
        eaten,
        events,
    };
}

/** Every dot and pellet the level started with that is no longer there. */
function allEatenTiles(): number[] {
    const eaten: number[] = [];
    const original = gameState.currentLevel?.tiles;
    if (original === undefined) return eaten;
    for (let y = 0; y < original.length; y++) {
        for (let x = 0; x < original[y].length; x++) {
            const was = original[y][x];
            if ((was === 3 || was === 4) && Levels.levelDynamic[y]?.[x] !== was) {
                eaten.push(tileIndex(x, y));
            }
        }
    }
    return eaten;
}

function setHostPhase(phase: HostPhase): void {
    hostPhase = phase;
}

/** True while this machine is hosting a networked game, not just a lobby. */
function isNetHosting(): boolean {
    return netHost !== null && hostPhase !== 'lobby';
}

function testModeEscHandler(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
        exitTestGame();
    }
}

/**
 * Leave a play-test and hand the canvas back to the editor. Escape does this on
 * a keyboard; the editor puts a button on screen for everyone else.
 */
export function exitTestGame(): void {
    if (!testMode) return;
    returningToEditor = true;
    document.removeEventListener('keydown', testModeEscHandler);
}

export function startTestGame(level: LevelData, onReturn: () => void): void {
    editorReturnCallback = onReturn;
    testMode = true;

    Stats.reset();
    gameState.sharedLives = 2;
    gameState.level = 1;
    gameState.scatterChaseIndex = 0;
    gameState.scatterChaseElapsed = 0;
    gameState.frightenedRemaining = 0;
    gameState.enemyEatenChain = 0;
    gameState.scorePopups = [];
    gameState.useGlobalDotCounter = false;
    gameState.globalDotCounter = 0;
    gameState.idleTimer = 0;
    gameState.dotsEaten = 0;
    gameState.fruitActive = null;
    gameState.fruitSpawned1 = false;
    gameState.fruitSpawned2 = false;
    gameState.fruitHistory = [];
    gameState.elroyLevel = 0;
    gameState.elroySuspended = false;
    gameState.gameOver = false;
    AI.resetPrng();

    Sound.stopMenuMusic();

    gameStarted = true;
    Time.setup();
    const slot = { id: 1, input: new CompositePlayerInput([new KeyboardPlayerInput(), new TouchPlayerInput()]) as PlayerInput };
    initializeLevel([slot], level);
    gameState.frozen = true;
    gameState.showReady = true;
    Sound.introChimes();
    Time.addTimer(2.0, () => {
        gameState.frozen = false;
        gameState.showReady = false;
    });
    document.addEventListener('keydown', testModeEscHandler);
    update();
}

function start(slots: ConfirmedSlot[], level?: LevelData): void {
    // Inject debug phantom players. They are seated with the same
    // RemotePlayerInput an online player gets, so the multiplayer input path is
    // exercised locally; idle unless the debug net loopback is driving them.
    const maxId = slots.reduce((m, s) => Math.max(m, s.id), 0);
    for (let i = 0; i < debugExtraPlayers && slots.length < 4; i++) {
        slots = [...slots, { id: maxId + i + 1, input: new RemotePlayerInput() as PlayerInput }];
    }

    // Full game state reset for a fresh play
    Stats.reset();
    gameState.sharedLives = 2;
    gameState.level = 1;
    gameState.scatterChaseIndex = 0;
    gameState.scatterChaseElapsed = 0;
    gameState.frightenedRemaining = 0;
    gameState.enemyEatenChain = 0;
    gameState.scorePopups = [];
    gameState.useGlobalDotCounter = false;
    gameState.globalDotCounter = 0;
    gameState.idleTimer = 0;
    gameState.dotsEaten = 0;
    gameState.fruitActive = null;
    gameState.fruitSpawned1 = false;
    gameState.fruitSpawned2 = false;
    gameState.fruitHistory = [];
    gameState.elroyLevel = 0;
    gameState.elroySuspended = false;
    gameState.gameOver = false;
    AI.resetPrng();

    Sound.stopMenuMusic();
    menuMusicPlaying = false;

    // Online games carry their lobby code into the HUD, and mark which player
    // is the one at this keyboard; local ones show neither.
    const hosting = netHost !== null && hostPhase !== 'lobby';
    gameState.onlineCode = hosting ? netHost?.code ?? null : null;
    gameState.onlinePlayerId = hosting ? 1 : null;

    gameStarted = true;
    Time.setup();
    initializeLevel(slots, level);
    gameState.frozen = true;
    gameState.showReady = true;
    Sound.introChimes();
    Time.addTimer(2.0, () => {
        gameState.frozen = false;
        gameState.showReady = false;
        staggerLateStarters();
    });
    update();
}

// ── Start Screen ──────────────────────────────────────────────────────────────

let gameStarted = false;
let returningToMenu = false;
let returningToPlayerSelect = false;
let returningToEditor = false;
let editorReturnCallback: (() => void) | null = null;
let testMode = false;
let debugExtraPlayers = 0; // injected phantom players for testing multiplayer
let debugNetLoopback = false; // mirror P1 through the wire codec into phantom players
let debugNetSeq = 0;
let audioUnlocked = false;   // true after first user gesture (AudioContext created)
let menuMusicPlaying = false; // true while menu music is actively playing
let controllerActive = false; // true once any gamepad interaction is detected; never resets

// Start-screen menu. 'play' is first so the long-standing flow — tap, tap, play
// — reaches the same place it always did without touching the arrows.
const MENU_ITEMS = ['play', 'host', 'join'] as const;
type MenuItem = typeof MENU_ITEMS[number];
let menuIndex = 0;

// Online session state. Exactly one of netHost / netClient is set while a
// lobby is up, and stays set through the game that lobby starts.
let netHost: NetHost | null = null;
let netClient: NetClient | null = null;
let lobbyView: LobbyView | null = null;
let lobbyRunning = false;
let returningToLobby = false;

// Host side, while a networked game runs.
let hostPhase: HostPhase = 'lobby';
let snapshotTick = 0;
/** The map the host will start, and sends to everyone who joins. */
let hostLevel: LevelData = Levels.level1Data;
/** Players whose seat is being held open — they sit out until they are back. */
const disconnectedPlayers = new Set<number>();

// Client side, while a networked game runs.
let clientGame: ClientGame | null = null;
let clientRunning = false;
let clientInput: InputSampler | null = null;
let clientPhase: HostPhase = 'lobby';
let clientConnection: ConnectionState = 'connected';
let lastSentHeld = -1;
let framesSinceInput = 0;

let menuAnimTime = 0;
let menuAnimLastTs = 0;
// Gamepad button states on the start screen, for rising-edge detection
let startScreenPrevA = false;
let startScreenPrevUp = false;
let startScreenPrevDown = false;

function drawMenuPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dir: 'left' | 'right', mouthOpen: number): void {
    const dirMultiplier = dir === 'right' ? 0 : 1;
    ctx.fillStyle = 'yellow';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, size,
        mouthOpen * Math.PI + Math.PI * dirMultiplier,
        (1.0 + mouthOpen) * Math.PI + Math.PI * dirMultiplier,
        false);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, size,
        (1 - mouthOpen) * Math.PI + Math.PI * dirMultiplier,
        (1 + (1 - mouthOpen)) * Math.PI + Math.PI * dirMultiplier,
        false);
    ctx.closePath();
    ctx.fill();
}

function drawMenuChase(t: number): void {
    const ctx = gameState.ctx;
    const w = gameState.canvas.width;
    const scale = 0.55;
    const size = scale * unit;
    // Above the menu rather than through it: phase B draws the player at double
    // size, which reached into the first menu row at the old height.
    const y = unit * 27.2;
    const spacing = unit * 1.8;
    const spacingB = unit * 2.8;  // wider spacing for phase B
    const enemyColors = ['red', '#ffb8ff', 'cyan', 'orange'];
    const PHASE_A = 4;
    const PAUSE   = 1;
    const PHASE_B = 4;
    const CYCLE   = PHASE_A + PAUSE + PHASE_B;
    const totalDist = w + 2 * unit + enemyColors.length * spacing;
    const totalDistB = w + 2 * unit + enemyColors.length * spacingB;
    const cycleT = t % CYCLE;

    const frames = [0.0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1];
    const mouthOpen = frames[Math.floor(t * 30) % frames.length];

    if (cycleT < PHASE_A) {
        // Phase A: Player fleeing right, enemies chasing
        const progress = cycleT / PHASE_A;
        const pacX = -unit + totalDist * progress;
        for (let i = enemyColors.length - 1; i >= 0; i--) {
            const gx = pacX - (i + 1) * spacing;
            if (gx < -2 * unit || gx > w + 2 * unit) continue;
            Draw.drawEnemyBody(enemyColors[i], gx, y, scale);
            Draw.drawEnemyEyes(enemyColors[i], gx, y, scale, 'right');
        }
        if (pacX > -2 * unit && pacX < w + 2 * unit) {
            drawMenuPlayer(ctx, pacX, y, size, 'right', mouthOpen);
        }
    } else if (cycleT >= PHASE_A + PAUSE) {
        // Phase B: frightened enemies fleeing left, big Player chasing
        const progress = (cycleT - PHASE_A - PAUSE) / PHASE_B;
        const pacX = w + unit + enemyColors.length * spacingB - totalDistB * progress;
        const pacSize2 = scale * unit * 2;
        for (let i = 0; i < enemyColors.length; i++) {
            const gx = pacX - (i + 1) * spacingB;
            if (gx < -2 * unit || gx > w + 2 * unit) continue;
            Draw.drawEnemyBody('#0000cc', gx, y, scale);
            Draw.drawFrightenedEyes(gx, y, scale, '#0000cc');
        }
        if (pacX > -3 * unit && pacX < w + 3 * unit) {
            drawMenuPlayer(ctx, pacX, y, pacSize2, 'left', mouthOpen);
        }
    }
}

// Two-phase start:
//   Phase 1 (first gesture): unlock AudioContext + play menu music
//   Phase 2 (second gesture): go to player select screen
// After the first play-session, returning to menu auto-plays music, so
// subsequent sessions only need one tap/click to reach player select.
// hasGamepad: caller passes true when startScreenLoop confirmed a gamepad triggered this.
// Sets controllerActive so subsequent calls (e.g. from touchend) see the flag too.
function handleMenuInteraction(hasGamepad = false): void {
    if (gameStarted) return;
    if (hasGamepad) controllerActive = true;
    if (!audioUnlocked) {
        // First ever gesture — unlock audio and start menu music
        Sound.init();
        audioUnlocked = true;
        Sound.playMenuMusic();
        menuMusicPlaying = true;
        return;
    }
    const choice: MenuItem = MENU_ITEMS[menuIndex];
    if (choice === 'host') { startHosting(); return; }
    if (choice === 'join') { startJoining(); return; }

    // Audio already unlocked — go to player select if a controller is connected,
    // otherwise start solo directly (keeps single-player flow intact).
    gameStarted = true;
    if (controllerActive || GamepadPlayerInput.connectedIndices().length > 0) {
        playerSelectLoop();
    } else {
        start([{ id: 1, input: new CompositePlayerInput([new KeyboardPlayerInput(), new TouchPlayerInput()]) as PlayerInput }]);
    }
}

function moveMenu(delta: number): void {
    if (gameStarted || !audioUnlocked) return;
    menuIndex = (menuIndex + delta + MENU_ITEMS.length) % MENU_ITEMS.length;
}

/** Arrow keys pick a menu entry; anything else confirms, as it always has. */
function menuKeyHandler(e: KeyboardEvent): void {
    if (e.key === 'ArrowUp')        { e.preventDefault(); moveMenu(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveMenu(1); }
    else                            { handleMenuInteraction(); }
}

// ── Online lobby ──────────────────────────────────────────────────────────────

/**
 * The name shown on a lobby roster. The initials a player last entered on the
 * high-score screen are the name they already identify with, so online play
 * reuses them rather than asking for a name of its own. Anyone who has never
 * placed gets a tag generated once and kept.
 */
function localPlayerName(): string {
    const stored = Stats.loadInitials();
    if (stored !== null) return stored;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let tag = '';
    for (let i = 0; i < 3; i++) tag += letters[Math.floor(Math.random() * letters.length)];
    Stats.saveInitials(tag);
    return tag;
}

function lobbyStatusFor(playerCount: number): string {
    return playerCount < 2 ? 'WAITING FOR PLAYERS...' : `${playerCount} PLAYERS CONNECTED`;
}

function startHosting(): void {
    gameStarted = true; // keeps startScreenLoop and the menu handlers out of the way
    hostLevel = Levels.level1Data;
    netHost = new NetHost({
        level: hostLevel,
        name: localPlayerName(),
        onRosterChange: (roster) => {
            if (lobbyView === null) return;
            lobbyView.roster = roster;
            lobbyView.status = lobbyStatusFor(roster.length);
        },
        onSeatConnectionChange: (playerId, connected) => {
            if (connected) {
                // Back in their seat, but not back in the maze: they rejoin
                // the way a dead player does, at the next level or life.
                disconnectedPlayers.delete(playerId);
                return;
            }
            disconnectedPlayers.add(playerId);
            const player = gameState.players.find(p => p.id === playerId);
            if (player !== undefined) player.active = false;
        },
        latestSnapshot: () => (hostPhase === 'lobby' ? null : buildSnapshot(true)),
    });
    lobbyView = {
        role: 'host',
        code: netHost.code,
        roster: netHost.roster(),
        selfPlayerId: 1,
        mapName: hostLevel.name,
        status: lobbyStatusFor(1),
        error: null,
    };
    enterLobby();
}

function startJoining(): void {
    gameStarted = true;
    let entry: CodeEntry | null = null;

    entry = showCodeEntry({
        onSubmit: (code) => {
            entry?.setBusy('CONNECTING...');
            netClient = new NetClient({
                code,
                name: localPlayerName(),
                onStart: (level) => { startClientGame(level); },
                onSnapshot: (snapshot) => { applyClientSnapshot(snapshot); },
                onConnectionState: (state) => {
                    clientConnection = state;
                    if (lobbyView === null) return;
                    lobbyView.status = state === 'reconnecting'
                        ? 'RECONNECTING...'
                        : 'WAITING FOR THE HOST TO START A NEW GAME';
                },
                onWelcome: (playerId, level, state) => {
                    entry?.close();
                    if (state !== null) {
                        // A game is already running, so this is a player coming
                        // back to a seat that was held for them. Straight into
                        // the maze, no lobby in between.
                        startClientGame(level, state);
                        applyClientSnapshot(state);
                        return;
                    }
                    lobbyView = {
                        role: 'client',
                        code,
                        roster: netClient?.roster ?? [],
                        selfPlayerId: playerId,
                        mapName: level.name,
                        status: 'WAITING FOR THE HOST...',
                        error: null,
                    };
                    enterLobby();
                },
                onRosterChange: (roster, mapName) => {
                    if (lobbyView === null) return;
                    lobbyView.roster = roster;
                    if (mapName !== null) lobbyView.mapName = mapName;
                },
                onFailure: (failure) => {
                    netClient = null;
                    // Mid-game there is nothing left to watch, so the host
                    // leaving returns everyone to the menu. Once seated in a
                    // lobby the screen owns the message and its LEAVE button;
                    // before that, the code entry is still up and the player
                    // can simply retype.
                    if (clientRunning) leaveOnlineGame();
                    else if (lobbyView !== null) lobbyView.error = joinFailureText(failure);
                    else entry?.setError(joinFailureText(failure));
                },
            });
        },
        onCancel: () => {
            entry?.close();
            netClient?.leave();
            netClient = null;
            showStartScreen();
        },
    });
}

function joinFailureText(failure: JoinFailure): string {
    switch (failure) {
        case 'protocol':    return 'DIFFERENT GAME VERSION - RELOAD THE PAGE';
        case 'full':        return 'THAT GAME IS FULL';
        case 'in-progress': return 'THAT GAME HAS ALREADY STARTED';
        case 'timeout':     return 'NO GAME FOUND WITH THAT CODE';
        case 'bad-code':    return 'CODES ARE SIX DIGITS';
        case 'host-left':   return 'THE HOST LEFT';
    }
}

function enterLobby(): void {
    lobbyRunning = true;
    // The lobby is a menu screen and should sound like one, whether it is the
    // first one or the one a finished game came back to.
    if (audioUnlocked && !menuMusicPlaying) {
        Sound.playMenuMusic();
        menuMusicPlaying = true;
    }
    document.onkeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') leaveLobby();
        else if (e.key === 'Enter' || e.key === ' ') hostStartGame();
        else if (e.key === 'm' || e.key === 'M') openMapPicker();
    };
    gameState.canvas.addEventListener('click', onLobbyTap);
    gameState.canvas.addEventListener('touchend', onLobbyTouch, { passive: false } as EventListenerOptions);
    lobbyFrame();
}

// Stop the tap from reaching the document-level menu handler: leaveLobby clears
// gameStarted, and the same gesture would otherwise bubble up and immediately
// re-enter whatever the menu has highlighted.
function onLobbyTap(e: MouseEvent): void {
    e.stopPropagation();
    handleLobbyPoint(...canvasPoint(e.clientX, e.clientY));
}

function onLobbyTouch(e: TouchEvent): void {
    e.stopPropagation();
    e.preventDefault();
    const touch = e.changedTouches[0];
    handleLobbyPoint(...canvasPoint(touch.clientX, touch.clientY));
}

function handleLobbyPoint(x: number, y: number): void {
    if (hitsLeaveButton(x, y)) leaveLobby();
    else if (hitsStartButton(x, y)) hostStartGame();
    else if (hitsMapButton(x, y)) openMapPicker();
}

/**
 * Pick the map everyone is about to play, from the same library modal the
 * editor uses — the editor is the most active part of the project, and playing
 * a friend's maze together is the point of all this.
 *
 * A level that cannot be played is refused here, before anyone joins a game
 * built on it, rather than failing once four people are already in it.
 */
function openMapPicker(): void {
    if (netHost === null || !lobbyRunning) return;

    const use = (level: LevelData, close: () => void): void => {
        hostLevel = level;
        netHost?.setLevel(level);
        if (lobbyView !== null) lobbyView.mapName = level.name;
        close();
    };

    openLibraryModal({
        title: '🌐 Pick a map to host',
        emptyMessage: 'No saved maps yet.<br>Build one in the editor and save it to your library.',
        footer: 'TAP · OR D-PAD MOVE, A SELECT, B CLOSE',
        lead: {
            label: '▦ The classic maze',
            onClick: (controls) => use(Levels.level1Data, controls.close),
        },
        actions: (entry) => [{
            label: '🌐 Host this',
            tone: 'load',
            onClick: (chosen, controls) => {
                const result = validateLevel(chosen.level, getTileSet(chosen.tileSetId));
                if (!result.valid) {
                    alert(`"${chosen.level.name || 'Untitled'}" cannot be played yet:\n`
                        + result.errors.map(e => `• ${e}`).join('\n'));
                    return;
                }
                use(deepCopyLevel(chosen.level), controls.close);
            },
        }],
    });
}

/** Client coordinates to canvas coordinates — the canvas is CSS-scaled. */
function canvasPoint(clientX: number, clientY: number): [number, number] {
    const canvas = gameState.canvas;
    const rect = canvas.getBoundingClientRect();
    return [
        (clientX - rect.left) * (canvas.width  / rect.width),
        (clientY - rect.top)  * (canvas.height / rect.height),
    ];
}

// Standard gamepad face and d-pad indices, for the lobby's three controls.
const PAD_A = 0, PAD_B = 1, PAD_Y = 3, PAD_UP = 12, PAD_DOWN = 13;
let lobbyPrevPad: boolean[] = [];
let clientPrevB = false;

function lobbyFrame(): void {
    if (!lobbyRunning || lobbyView === null) return;

    const gp = (navigator.getGamepads ? navigator.getGamepads() : [])[0] ?? null;
    const pressed = gp === null ? [] : Array.from(gp.buttons, b => b.pressed);
    const rising = (index: number): boolean => (pressed[index] ?? false) && !(lobbyPrevPad[index] ?? false);

    // While the map picker is up it owns the pad, or A would start the game
    // behind it.
    const picker = document.getElementById('ed-library-modal');
    if (picker !== null) {
        drivePickerWithPad(picker, rising);
    } else if (rising(PAD_B)) {
        lobbyPrevPad = pressed;
        leaveLobby();
        return;
    } else if (rising(PAD_Y)) {
        openMapPicker();
    } else if (rising(PAD_A)) {
        lobbyPrevPad = pressed;
        hostStartGame();
        return;
    }
    lobbyPrevPad = pressed;

    drawLobbyScreen(lobbyView);
    window.requestAnimationFrame(lobbyFrame);
}

/**
 * The map picker is a DOM list, which a gamepad cannot click. Move the focus
 * with the d-pad and press the focused button with A, so opening it with Y is
 * not a door into a room with no handle.
 */
function drivePickerWithPad(picker: HTMLElement, rising: (index: number) => boolean): void {
    const buttons = Array.from(picker.querySelectorAll('button'));
    if (buttons.length === 0) return;

    const focused = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    const step = (delta: number): void => {
        buttons[(focused + delta + buttons.length) % buttons.length].focus();
    };

    if (rising(PAD_DOWN)) step(1);
    if (rising(PAD_UP)) step(-1);
    if (rising(PAD_A)) buttons[focused].click();
    if (rising(PAD_B)) (picker.querySelector('#ed-lib-close') as HTMLButtonElement | null)?.click();
}

/**
 * Start the game everyone in the lobby is waiting for.
 *
 * Remote players are seated exactly like local ones: a `RemotePlayerInput` is a
 * `PlayerInput`, so `start()` takes it without knowing the difference.
 */
function hostStartGame(): void {
    if (!lobbyRunning || netHost === null) return;
    disconnectedPlayers.clear();

    const localInputs: PlayerInput[] = [new KeyboardPlayerInput(), new TouchPlayerInput()];
    if (GamepadPlayerInput.connectedIndices().includes(0)) localInputs.push(new GamepadPlayerInput(0));
    const slots: ConfirmedSlot[] = [
        { id: 1, input: new CompositePlayerInput(localInputs) as PlayerInput },
        ...netHost.seatList().map(seat => ({ id: seat.playerId, input: seat.input as PlayerInput })),
    ];

    exitLobbyScreen();
    NetEvents.setRecording(true);
    snapshotTick = 0;
    setHostPhase('playing');
    netHost.startGame();
    start(slots, hostLevel);
}

/** Stop drawing the lobby and drop its handlers, without closing the room. */
function exitLobbyScreen(): void {
    lobbyRunning = false;
    gameState.canvas.removeEventListener('click', onLobbyTap);
    gameState.canvas.removeEventListener('touchend', onLobbyTouch);
    document.onkeydown = null;
}

function leaveLobby(): void {
    if (!lobbyRunning) return;
    exitLobbyScreen();
    closeOnlineSession();
    showStartScreen();
}

function closeOnlineSession(): void {
    gameState.onlineCode = null;
    gameState.onlinePlayerId = null;
    netHost?.close();
    netHost = null;
    netClient?.leave();
    netClient = null;
    lobbyView = null;
    setHostPhase('lobby');
    NetEvents.setRecording(false);
}

// Input goes out on change, with a heartbeat so a held direction keeps landing
// even when nothing about it changes.
const INPUT_HEARTBEAT_FRAMES = 6;

/**
 * How long a client watches a silent host before treating the connection as
 * lost and rebuilding it. Long enough to ride out a lag spike or a quick tab
 * switch, short enough to leave most of the host's 30 s seat-hold to work with.
 */
const RECONNECT_AFTER_SILENCE_MS = 6000;

function startClientGame(level: LevelData, state: Snapshot | null = null): void {
    if (netClient === null) return;
    if (clientRunning) stopClientGame();
    exitLobbyScreen();

    // The host's own `start()` does this for the host. A client never goes
    // through it, so without this the menu music plays over the whole game.
    Sound.stopMenuMusic();
    menuMusicPlaying = false;

    const inputs: PlayerInput[] = [new KeyboardPlayerInput(), new TouchPlayerInput()];
    if (GamepadPlayerInput.connectedIndices().includes(0)) inputs.push(new GamepadPlayerInput(0));
    clientInput = new InputSampler(new CompositePlayerInput(inputs) as PlayerInput);

    clientGame = new ClientGame(level, netClient.playerId, state?.level ?? 1);
    gameState.onlineCode = netClient.code;
    gameState.onlinePlayerId = netClient.playerId;
    clientPhase = 'playing';
    clientConnection = 'connected';
    clientRunning = true;
    lastSentHeld = -1;
    framesSinceInput = 0;

    document.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') leaveOnlineGame(); };
    gameState.canvas.addEventListener('click', onClientTap);
    gameState.canvas.addEventListener('touchend', onClientTouch, { passive: false } as EventListenerOptions);
    clientFrame();
}

function clientFrame(): void {
    if (!clientRunning) return;

    // The client runs no simulation, but animations, flashing and the death
    // fade all read the clock.
    Time.update();

    const gp = (navigator.getGamepads ? navigator.getGamepads() : [])[0] ?? null;
    const bDown = gp?.buttons[1]?.pressed ?? false;
    const canLeaveWithB = clientPhase !== 'playing' || clientConnection === 'reconnecting';
    if (bDown && !clientPrevB && canLeaveWithB) { clientPrevB = bDown; leaveOnlineGame(); return; }
    clientPrevB = bDown;

    if (clientPhase === 'playing' && clientConnection === 'connected') sendClientInput();

    if (clientPhase === 'initials') {
        // The host is typing initials. Clients never enter them — the host
        // saves the score — so all they need is to know the wait is real.
        Sound.stopSiren();
        drawClientGameOver(Stats.currentScore, 'WAITING FOR THE HOST...');
    } else if (clientGame !== null) {
        clientGame.update();
        clientGame.draw();
        if (clientConnection === 'reconnecting') {
            Sound.stopSiren();
            const left = netClient?.reconnectSecondsLeft() ?? 0;
            drawWaitingBanner('RECONNECTING...', `GIVING UP IN ${left}s - ESC OR B TO LEAVE`);
        } else if (clientGame.isStarved()) {
            Sound.stopSiren();
            drawWaitingBanner('WAITING FOR THE HOST...');
            // WebRTC will not admit a dead connection for another ten seconds or
            // more, and the seat is only held for thirty. Stop waiting on it.
            if (clientGame.silentForMs() > RECONNECT_AFTER_SILENCE_MS) netClient?.reportSilence();
        } else {
            clientGame.updateSiren();
        }
    }

    window.requestAnimationFrame(clientFrame);
}

function sendClientInput(): void {
    if (clientInput === null || netClient === null || clientGame === null) return;
    const { held, buffered } = clientInput.sample();
    framesSinceInput++;
    // A buffered turn is an edge and is never held back for the heartbeat.
    if (held === lastSentHeld && buffered === null && framesSinceInput < INPUT_HEARTBEAT_FRAMES) return;

    const seq = netClient.sendInput(held, buffered);
    lastSentHeld = held;
    framesSinceInput = 0;

    // The same message drives the local prediction, and the position it was
    // sent from is what the host's acknowledgement will be compared against.
    const actor = clientGame.selfActor();
    clientGame.applyLocalInput({ t: 'input', held, buffered, seq }, actor?.x ?? 0, actor?.y ?? 0);
}

function applyClientSnapshot(snapshot: Snapshot): void {
    if (clientGame === null) return;
    if (snapshot.hostPhase === 'lobby') { returnClientToLobby(); return; }
    clientPhase = snapshot.hostPhase;
    clientGame.push(snapshot);
}

function onClientTap(e: MouseEvent): void {
    e.stopPropagation();
    if (clientPhase === 'playing') return; // taps are steering during play
    if (hitsLeaveButton(...canvasPoint(e.clientX, e.clientY))) leaveOnlineGame();
}

function onClientTouch(e: TouchEvent): void {
    if (clientPhase === 'playing') return;
    e.stopPropagation();
    const touch = e.changedTouches[0];
    if (hitsLeaveButton(...canvasPoint(touch.clientX, touch.clientY))) leaveOnlineGame();
}

/** Tear down the client's world, leaving the room connection alone. */
function stopClientGame(): void {
    clientRunning = false;
    gameState.onlineCode = null;
    gameState.onlinePlayerId = null;
    clientPhase = 'lobby';
    clientInput?.destroy();
    clientInput = null;
    clientGame?.destroy();
    clientGame = null;
    document.onkeydown = null;
    gameState.canvas.removeEventListener('click', onClientTap);
    gameState.canvas.removeEventListener('touchend', onClientTouch);
}

/** The host went back to its lobby, so the client follows it there. */
function returnClientToLobby(): void {
    stopClientGame();
    if (netClient === null) { showStartScreen(); return; }
    lobbyView = {
        role: 'client',
        code: netClient.code,
        roster: netClient.roster,
        selfPlayerId: netClient.playerId,
        mapName: netClient.level?.name ?? '',
        status: 'WAITING FOR THE HOST TO START A NEW GAME',
        error: null,
    };
    enterLobby();
}

function leaveOnlineGame(): void {
    stopClientGame();
    closeOnlineSession();
    showStartScreen();
}

function showStartScreen(): void {
    gameStarted = false;
    document.onkeydown = menuKeyHandler;
    startScreenLoop();
}

// ── Player Select Screen ──────────────────────────────────────────────────────

function playerSelectLoop(): void {
    // PAD SHIFT (default): P1=keyboard, P2=pad0, P3=pad1, P4=pad2
    // KEYBOARD:            P1=keyboard+pad0, P2=pad1, P3=pad2, P4=pad3
    let controllerMode = false;

    function connectedCount(): number { return GamepadPlayerInput.connectedIndices().length; }

    function maxAvailableCount(): number {
        const c = connectedCount();
        return controllerMode
            ? Math.min(1 + c, 4)               // kbd + up to 3 pads
            : Math.min(Math.max(c, 1), 4);      // kbd always, P2+ need pads starting at index 1
    }

    let playerCount = maxAvailableCount();

    function adjustCount(delta: number): void {
        playerCount = Math.max(1, Math.min(playerCount + delta, maxAvailableCount()));
    }

    function toggleMode(): void {
        controllerMode = !controllerMode;
        playerCount = maxAvailableCount();
    }

    let selectRunning = true;

    // Auto-select highest available count when controllers connect/disconnect
    GamepadPlayerInput.listenForConnectionChanges(() => {
        if (!selectRunning) return;
        playerCount = maxAvailableCount();
    });

    function confirmAndStart(): void {
        if (!selectRunning) return;
        const connected = GamepadPlayerInput.connectedIndices();
        const confirmedSlots: ConfirmedSlot[] = [];

        for (let id = 1; id <= playerCount; id++) {
            if (id === 1) {
                const inputs: PlayerInput[] = [new KeyboardPlayerInput(), new TouchPlayerInput()];
                if (!controllerMode && connected.includes(0)) inputs.push(new GamepadPlayerInput(0));
                confirmedSlots.push({ id: 1, input: new CompositePlayerInput(inputs) as PlayerInput });
            } else {
                // PAD SHIFT: P2=pad0, P3=pad1 ... KEYBOARD: P2=pad1, P3=pad2 ...
                const padIdx = controllerMode ? id - 2 : id - 1;
                if (padIdx >= 0 && connected.includes(padIdx)) {
                    confirmedSlots.push({ id, input: new GamepadPlayerInput(padIdx) as PlayerInput });
                }
            }
        }

        if (confirmedSlots.length === 0) return;
        selectRunning = false;
        start(confirmedSlots);
    }

    // Gamepad state tracking for rising-edge detection
    const prevBtns: boolean[][] = [[], [], [], []];

    function selectFrame(): void {
        if (!selectRunning) return;

        // Only gamepad 0 (P1) can navigate the player select screen
        const p1gp = (navigator.getGamepads ? navigator.getGamepads() : [])[0] ?? null;
        const prev0 = prevBtns[0] ?? [];
        if (p1gp) {
            const aPressed = (p1gp.buttons[0]?.pressed ?? false) || (p1gp.buttons[3]?.pressed ?? false);
            const dLeft    = p1gp.buttons[14]?.pressed ?? false;
            const dRight   = p1gp.buttons[15]?.pressed ?? false;
            const dUp      = p1gp.buttons[12]?.pressed ?? false;
            const dDown    = p1gp.buttons[13]?.pressed ?? false;
            if (aPressed  && !(prev0[0] || prev0[3]))  confirmAndStart();
            if ((dLeft && !prev0[14]) || (dRight && !prev0[15])) toggleMode();
            if (dUp   && !prev0[12]) adjustCount(-1);
            if (dDown && !prev0[13]) adjustCount(+1);
            prevBtns[0] = Array.from(p1gp.buttons, b => b.pressed);
        } else {
            prevBtns[0] = [];
        }

        Draw.playerSelectScreen(playerCount, controllerMode, connectedCount());
        window.requestAnimationFrame(selectFrame);
    }

    // Touch: swipe L/R → mode, swipe U/D → count, tap → confirm
    let touchStartX = 0;
    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            e.preventDefault(); toggleMode();
        } else if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) {
            e.preventDefault(); adjustCount(dy > 0 ? 1 : -1);
        } else {
            e.preventDefault(); confirmAndStart();
        }
    };
    document.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
    document.addEventListener('touchend',   onTouchEnd as EventListener,   { passive: false } as EventListenerOptions);

    document.onkeydown = (e: KeyboardEvent) => {
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
        if      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') toggleMode();
        else if (e.key === 'ArrowUp')                              adjustCount(-1);
        else if (e.key === 'ArrowDown')                            adjustCount(+1);
        else if (e.key === 'Enter' || e.key === ' ')               confirmAndStart();
    };
    document.addEventListener('click', confirmAndStart, { once: true });

    selectFrame();
}

const MENU_LABELS: Record<MenuItem, string> = {
    play: 'START GAME',
    host: 'HOST ONLINE',
    join: 'JOIN ONLINE',
};

function drawStartMenu(ctx: CanvasRenderingContext2D, w: number): void {
    const cx = w / 2;
    for (let i = 0; i < MENU_ITEMS.length; i++) {
        const selected = i === menuIndex;
        const y = unit * (29.6 + i * 1.4);
        ctx.fillStyle = selected ? 'yellow' : '#777';
        ctx.font = `bold ${Math.round(unit * (selected ? 0.9 : 0.8))}px monospace`;
        ctx.fillText(selected ? `\u25BA ${MENU_LABELS[MENU_ITEMS[i]]} \u25C4` : MENU_LABELS[MENU_ITEMS[i]], cx, y);
    }
    ctx.fillStyle = '#555';
    ctx.font = `${Math.round(unit * 0.48)}px monospace`;
    ctx.fillText('\u2191 \u2193 or swipe to choose - tap to confirm', cx, unit * 33.8);
}

function startScreenLoop(): void {
    if (gameStarted) return;

    // Poll only gamepad 0 (P1) for A button — other controllers don't advance the menu
    const p1Gamepad = (navigator.getGamepads ? navigator.getGamepads() : [])[0] ?? null;
    const aDown = (p1Gamepad?.buttons[0]?.pressed ?? false) || (p1Gamepad?.buttons[3]?.pressed ?? false);
    if (aDown && !startScreenPrevA) handleMenuInteraction(true);
    startScreenPrevA = aDown;

    const dUp   = p1Gamepad?.buttons[12]?.pressed ?? false;
    const dDown = p1Gamepad?.buttons[13]?.pressed ?? false;
    if (dUp   && !startScreenPrevUp)   moveMenu(-1);
    if (dDown && !startScreenPrevDown) moveMenu(1);
    startScreenPrevUp   = dUp;
    startScreenPrevDown = dDown;

    // Auto-play menu music after returning from a game (audio already unlocked)
    if (audioUnlocked && !menuMusicPlaying) {
        Sound.playMenuMusic();
        menuMusicPlaying = true;
    }

    const ctx = gameState.ctx;
    const w = gameState.canvas.width;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, gameState.canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.fillStyle = 'yellow';
    ctx.font = `bold ${unit * 2}px monospace`;
    ctx.fillText('DOT MAZE', w / 2, unit * 5);

    // High scores
    const scores: HighScoreEntry[] = Stats.loadHighScores();
    ctx.fillStyle = 'cyan';
    ctx.font = `bold ${Math.round(unit * 0.9)}px monospace`;
    ctx.fillText('HIGH SCORES', w / 2, unit * 10);
    ctx.fillStyle = 'white';
    for (let i = 0; i < scores.length; i++) {
        const { initials, score } = scores[i];
        const rank = `${i + 1}.`.padStart(3);
        const line = `${rank} ${initials} ${String(score).padStart(6)}`;
        ctx.fillText(line, w / 2, unit * 11.5 + i * unit * 1.5);
    }

    // Animated chase scene
    const now = performance.now();
    const menuDt = menuAnimLastTs > 0 ? Math.min((now - menuAnimLastTs) / 1000, 0.05) : 0;
    menuAnimLastTs = now;
    menuAnimTime += menuDt;
    drawMenuChase(menuAnimTime);

    // Two-phase start: the first gesture only unlocks audio, so until then the
    // menu would be a list of things a tap cannot reach yet.
    if (!audioUnlocked) {
        ctx.fillStyle = 'white';
        ctx.font = `bold ${Math.round(unit * 0.9)}px monospace`;
        ctx.fillText('TAP TO PLAY MUSIC', w / 2, unit * 31);
    } else {
        drawStartMenu(ctx, w);
    }

    // Music credit
    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(unit * 0.6)}px monospace`;
    ctx.fillText('Music by HeatleyBros', w / 2, unit * 35);

    window.requestAnimationFrame(startScreenLoop);
}

/**
 * The area actually visible to the player.
 *
 * `window.innerWidth/innerHeight` describe the layout viewport, which on mobile
 * can be larger than what is on screen — while the URL bar slides, or the page
 * is pinched — and sizing the canvas from it renders the maze wider than the
 * screen, clipped at both edges. `visualViewport` tracks the visible area, so
 * prefer it and fall back only where it is unavailable.
 */
export function viewportSize(): { width: number; height: number } {
    const visual = window.visualViewport;
    return {
        width:  Math.min(window.innerWidth,  visual?.width  ?? window.innerWidth),
        height: Math.min(window.innerHeight, visual?.height ?? window.innerHeight),
    };
}

function resizeCanvas(): void {
    const canvas = gameState.canvas;
    const { width, height } = viewportSize();
    const scale = Math.min(width / 560, height / 720);
    canvas.style.width  = `${Math.floor(560 * scale)}px`;
    canvas.style.height = `${Math.floor(720 * scale)}px`;
}

window.onload = function () {
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    gameState.canvas = canvas;
    gameState.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    // iOS often reports URL-bar changes only through the visual viewport.
    window.visualViewport?.addEventListener('resize', resizeCanvas);
    window.visualViewport?.addEventListener('scroll', resizeCanvas);

    const params = new URLSearchParams(window.location.search);

    if (params.get('dev') === 'true') {
        gameState.debugEnabled = true;
        const panel = document.createElement('div');
        panel.id = 'debug-panel';
        panel.innerHTML = `
            <style>
            #debug-panel {
                position: fixed; top: 12px; right: 12px;
                background: rgba(0,0,0,0.92); color: #eee;
                padding: 18px 24px 27px; border: 2px solid #666;
                font-family: monospace; font-size: 33px;
                border-radius: 10px; z-index: 9999;
                user-select: none; min-width: 280px;
                touch-action: none;
            }
            #debug-panel h3 {
                margin: 0; color: yellow;
                font-size: 33px; letter-spacing: 1px;
                display: flex; align-items: center; justify-content: space-between;
                cursor: pointer; padding: 9px 0;
            }
            #dbg-toggle { font-size: 27px; color: #aaa; }
            #debug-panel label {
                display: flex; align-items: center;
                gap: 18px; cursor: pointer; margin: 15px 0;
                min-height: 54px;
            }
            #debug-panel input[type=checkbox] {
                cursor: pointer; width: 33px; height: 33px;
                flex-shrink: 0;
            }
            #debug-panel button {
                margin-top: 21px; width: 100%;
                background: #333; color: #eee;
                border: 2px solid #666; border-radius: 6px;
                font-family: monospace; font-size: 33px;
                padding: 12px 0; cursor: pointer; min-height: 66px;
            }
            #debug-panel button:hover { background: #444; }
            #dbg-reset-scores, #dbg-quit { color: #ff8888; border-color: #884444; }
            #dbg-reset-scores:hover, #dbg-quit:hover { background: #441111; }
            #dbg-error-log {
                margin-top: 18px; max-height: 240px; overflow-y: auto;
                background: #1a0000; border: 1px solid #663333;
                border-radius: 4px; padding: 9px 8px;
                font-size: 21px; color: #ff8888; line-height: 1.4;
                word-break: break-all; display: none;
            }
            #dbg-error-log-header {
                display: flex; align-items: center; justify-content: space-between;
                margin-top: 18px; font-size: 24px; color: #ff8888; display: none;
            }
            #dbg-clear-errors, #dbg-copy-errors {
                font-size: 20px; color: #aaa; background: none;
                border: 1px solid #555; border-radius: 3px;
                padding: 3px 6px; cursor: pointer; margin-top: 0; width: auto; min-height: 0;
            }
            #debug-panel input[type=range] {
                -webkit-appearance: none; appearance: none;
                width: 100%; height: 54px; background: transparent;
                cursor: pointer; padding: 0; margin: 0;
            }
            #debug-panel input[type=range]::-webkit-slider-runnable-track {
                height: 10px; border-radius: 5px; background: #555;
            }
            #debug-panel input[type=range]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 48px; height: 48px; border-radius: 50%;
                background: yellow; margin-top: -19px;
            }
            #debug-panel input[type=range]::-moz-range-track {
                height: 10px; border-radius: 5px; background: #555;
            }
            #debug-panel input[type=range]::-moz-range-thumb {
                width: 48px; height: 48px; border-radius: 50%;
                background: yellow; border: none;
            }
            </style>
            <h3 id="dbg-header">⚙ DEBUG <span id="dbg-toggle">▲</span></h3>
            <div id="dbg-content">
                <label><input type="checkbox" id="dbg-targets"> Target tiles</label>
                <label><input type="checkbox" id="dbg-viz"> Targeting viz</label>
                <label><input type="checkbox" id="dbg-modes"> Enemy modes</label>
                <label><input type="checkbox" id="dbg-redzones"> Red zones</label>
                <label><input type="checkbox" id="dbg-enemypaths"> Enemy paths</label>
                <label><input type="checkbox" id="dbg-tilepicker"> Tile picker</label>
                <label><input type="checkbox" id="dbg-no-predict"> Online: no prediction</label>
                <label style="flex-direction:column;align-items:flex-start;gap:10px">
                    <span id="dbg-extra-players-label">Extra players: 0</span>
                    <input type="range" id="dbg-extra-players" min="0" max="3" value="0"
                        style="width:100%;accent-color:yellow;cursor:pointer">
                </label>
                <label><input type="checkbox" id="dbg-net-loopback"> Mirror P1 to extras (net)</label>
                <button id="dbg-pause">⏸ Pause</button>
                <button id="dbg-player-select">◀ Player Select</button>
                <button id="dbg-initials">✏ Initials Screen</button>
                <button id="dbg-quit">💀 Quit Game</button>
                <button id="dbg-reset-scores">🗑 Reset High Scores</button>
                <div id="dbg-error-log-header">⚠ Errors <span style="display:flex;gap:6px"><button id="dbg-copy-errors">Copy</button><button id="dbg-clear-errors">Clear</button></span></div>
                <div id="dbg-error-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // Stop all input events from bubbling to document-level game handlers
        panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        panel.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });
        panel.addEventListener('click',      (e) => e.stopPropagation());

        (document.getElementById('dbg-targets') as HTMLInputElement).onchange = (e) => {
            gameState.debugShowTargetTiles = (e.target as HTMLInputElement).checked;
        };
        (document.getElementById('dbg-viz') as HTMLInputElement).onchange = (e) => {
            gameState.debugShowTargetingViz = (e.target as HTMLInputElement).checked;
        };
        (document.getElementById('dbg-modes') as HTMLInputElement).onchange = (e) => {
            gameState.debugShowModes = (e.target as HTMLInputElement).checked;
        };
        (document.getElementById('dbg-redzones') as HTMLInputElement).onchange = (e) => {
            gameState.debugShowRedZones = (e.target as HTMLInputElement).checked;
        };
        (document.getElementById('dbg-enemypaths') as HTMLInputElement).onchange = (e) => {
            gameState.debugShowEnemyPaths = (e.target as HTMLInputElement).checked;
        };
        (document.getElementById('dbg-tilepicker') as HTMLInputElement).onchange = (e) => {
            gameState.debugTilePicker = (e.target as HTMLInputElement).checked;
            if (!gameState.debugTilePicker) gameState.debugSelectedTile = null;
        };
        (document.getElementById('dbg-no-predict') as HTMLInputElement).onchange = (e) => {
            // Draws your own player from snapshots like everyone else. If a
            // movement problem survives this, it is the host's, not prediction.
            gameState.debugDisablePrediction = (e.target as HTMLInputElement).checked;
        };
        const extraPlayersSlider = document.getElementById('dbg-extra-players') as HTMLInputElement;
        const extraPlayersLabel  = document.getElementById('dbg-extra-players-label') as HTMLSpanElement;
        extraPlayersSlider.oninput = () => {
            debugExtraPlayers = parseInt(extraPlayersSlider.value);
            extraPlayersLabel.textContent = `Extra players: ${debugExtraPlayers}`;
        };
        (document.getElementById('dbg-net-loopback') as HTMLInputElement).onchange = (e) => {
            debugNetLoopback = (e.target as HTMLInputElement).checked;
        };

        const pauseBtn = document.getElementById('dbg-pause') as HTMLButtonElement;
        pauseBtn.onclick = () => {
            gameState.frozen = !gameState.frozen;
            pauseBtn.textContent = gameState.frozen ? '▶ Resume' : '⏸ Pause';
        };

        (document.getElementById('dbg-player-select') as HTMLButtonElement).onclick = () => {
            returningToPlayerSelect = true;
        };

        (document.getElementById('dbg-initials') as HTMLButtonElement).onclick = () => {
            if (Stats.currentScore === 0) Stats.currentScore = 12345; // mock score for preview
            showInitialsEntry(() => { Stats.currentScore = 0; });
        };

        (document.getElementById('dbg-quit') as HTMLButtonElement).onclick = () => {
            gameState.sharedLives = 0;
            for (const p of gameState.players) loseLife(p);
        };

        const resetScoresBtn = document.getElementById('dbg-reset-scores') as HTMLButtonElement;
        resetScoresBtn.onclick = () => {
            if (confirm('Reset all high scores?')) {
                Stats.resetHighScores();
                resetScoresBtn.textContent = '✓ Scores Reset';
                setTimeout(() => { resetScoresBtn.textContent = '🗑 Reset High Scores'; }, 2000);
            }
        };

        // Error log
        const errorLog    = document.getElementById('dbg-error-log')        as HTMLDivElement;
        const errorHeader = document.getElementById('dbg-error-log-header') as HTMLDivElement;
        function logError(msg: string): void {
            errorLog.style.display   = 'block';
            errorHeader.style.display = 'flex';
            const line = document.createElement('div');
            const time = Time.timeSinceStart.toFixed(2);
            line.textContent = `[${time}s] ${msg}`;
            errorLog.appendChild(line);
            errorLog.scrollTop = errorLog.scrollHeight;
        }
        const copyBtn = document.getElementById('dbg-copy-errors') as HTMLButtonElement;
        copyBtn.onclick = () => {
            const text = Array.from(errorLog.children).map(el => el.textContent ?? '').join('\n');
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
            });
        };
        (document.getElementById('dbg-clear-errors') as HTMLButtonElement).onclick = () => {
            errorLog.innerHTML = '';
            errorLog.style.display    = 'none';
            errorHeader.style.display = 'none';
        };
        // Intercept console.error so the existing try-catch in update() surfaces here
        const _origConsoleError = console.error.bind(console);
        console.error = (...args: unknown[]) => {
            _origConsoleError(...args);
            logError(args.map(a => a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a)).join(' '));
        };
        window.addEventListener('error', (e) => {
            logError(`${e.message} (${e.filename?.split('/').pop() ?? '?'}:${e.lineno})`);
        });
        window.addEventListener('unhandledrejection', (e) => {
            logError(`Unhandled rejection: ${e.reason}`);
        });

        // Collapsible panel
        const content = document.getElementById('dbg-content') as HTMLDivElement;
        const toggle  = document.getElementById('dbg-toggle')  as HTMLSpanElement;
        let collapsed = false;
        (document.getElementById('dbg-header') as HTMLElement).onclick = () => {
            collapsed = !collapsed;
            content.style.display = collapsed ? 'none' : '';
            toggle.textContent = collapsed ? '▼' : '▲';
        };

        // Canvas tile picker — converts click/tap position to tile coordinates
        function pickTile(clientX: number, clientY: number): void {
            if (!gameState.debugTilePicker) return;
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width  / rect.width;
            const scaleY = canvas.height / rect.height;
            const tx = Math.floor((clientX - rect.left) * scaleX / unit);
            const ty = Math.floor((clientY - rect.top)  * scaleY / unit);
            gameState.debugSelectedTile = { x: tx, y: ty };
        }
        canvas.addEventListener('click', (e) => pickTile(e.clientX, e.clientY));
        canvas.addEventListener('touchend', (e) => {
            if (!gameState.debugTilePicker) return;
            const t = e.changedTouches[0];
            pickTile(t.clientX, t.clientY);
        }, { passive: true });
    }

    if (params.get('editor') === 'true') {
        startEditorMode();
        return;
    }

    // Mark controllerActive as soon as any gamepad connects (covers mid-session plug-in)
    window.addEventListener('gamepadconnected', () => { controllerActive = true; });

    // A hidden tab stops rendering but keeps receiving. Let go of the controls
    // on the way out, so nobody's avatar keeps running while they are away, and
    // rejoin the present on the way back rather than replaying a backlog.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            clientGame?.resync();
        } else if (clientRunning) {
            netClient?.sendInput(0, null);
        }
    });

    document.onkeydown = menuKeyHandler;
    document.addEventListener('click', () => handleMenuInteraction());

    // Touch: a swipe up or down picks a menu entry, a tap confirms it — the same
    // idiom the player select screen uses.
    let menuTouchStartY = 0;
    document.addEventListener('touchstart', (e: TouchEvent) => {
        menuTouchStartY = e.touches[0]?.clientY ?? 0;
    }, { passive: true });
    document.addEventListener('touchend', (e: TouchEvent) => {
        e.preventDefault();
        if (gameStarted) return;
        const dy = (e.changedTouches[0]?.clientY ?? 0) - menuTouchStartY;
        if (audioUnlocked && Math.abs(dy) > 40) moveMenu(dy > 0 ? 1 : -1);
        else handleMenuInteraction();
    }, { passive: false } as EventListenerOptions);

    startScreenLoop();
};
