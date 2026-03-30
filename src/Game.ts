import { unit, TUNNEL_ROW, TUNNEL_SLOW_COL_MAX, TUNNEL_SLOW_COL_MIN } from './constants';
import { gameState } from './game-state';
import { Time }  from './static/Time';
import { Draw }  from './static/Draw';
import { Move }  from './static/Move';
import { AI }    from './static/AI';
import { Levels } from './static/Levels';
import { Stats }  from './static/Stats';
import type { HighScoreEntry } from './static/Stats';
import { Sound }  from './static/Sound';
import { GameObject } from './object/GameObject';
import type { IGameObject, Direction, PlayerState } from './types';
import type { PlayerInput } from './input/PlayerInput';

// Confirmed player slot: id + pre-constructed input instance
interface ConfirmedSlot { id: number; input: PlayerInput }
import { KeyboardPlayerInput } from './input/KeyboardPlayerInput';
import { TouchPlayerInput    } from './input/TouchPlayerInput';
import { GamepadPlayerInput  } from './input/GamepadPlayerInput';
import { CompositePlayerInput } from './input/CompositePlayerInput';

// Starting tile positions for each actor
const START = {
    player: { x: 13.5, y: 26 },
    blinky: { x: 13.5, y: 14 },
    inky:   { x: 12,   y: 17 },
    pinky:  { x: 13.5, y: 17 },
    clyde:  { x: 15,   y: 17 },
};

// Enemy eye-return speed (constant regardless of level)
const SPEED_EYES = 1.5;

// ── Fruit (Phase 7) ───────────────────────────────────────────────────────────

// Fruit spawns below the enemy house at tile (13, 20)
const FRUIT_X = 13 * unit + unit / 2;
const FRUIT_Y = 20 * unit + unit / 2;
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
    gameState.fruitActive = { x: FRUIT_X, y: FRUIT_Y, endTime: Time.timeSinceStart + FRUIT_DURATION };
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
            gameState.scorePopups.push({ x: fx, y: fy, score, endTime: Time.timeSinceStart + 2.0 });
            gameState.fruitActive = null;
            break;
        }
    }
}

// ── Speed Table (Phase 6) ─────────────────────────────────────────────────────
// All values are fractions of max speed (1.0 = 100%)

function getPlayerNormalSpeed(level: number): number {
    if (level === 1) return 0.80;
    if (level <= 4)  return 0.90;
    if (level <= 20) return 1.00;
    return 0.90; // level 21+
}

function getPlayerFrightSpeed(level: number): number {
    if (level === 1) return 0.90;
    if (level <= 4)  return 0.95;
    if (level <= 20) return 1.00;
    return 0.90; // level 21+ — no boost (same as normal)
}

function getEnemyNormalSpeed(level: number): number {
    if (level === 1) return 0.75;
    if (level <= 4)  return 0.85;
    return 0.95; // level 5+
}

function getEnemyFrightSpeed(level: number): number {
    if (level === 1) return 0.50;
    if (level <= 4)  return 0.55;
    return 0.60; // level 5+
}

function getEnemyTunnelSpeed(level: number): number {
    if (level === 1) return 0.40;
    if (level <= 4)  return 0.45;
    return 0.50; // level 5+
}

// ── Cruise Elroy (Phase 8) ────────────────────────────────────────────────────

// Dot count at which Blinky enters Elroy 1 / Elroy 2 for the current level
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
function getCurrentPlayerSpeed(): number {
    const anyFrightened = gameState.enemies.some(g => g.enemyMode === 'frightened');
    return anyFrightened
        ? getPlayerFrightSpeed(gameState.level)
        : getPlayerNormalSpeed(gameState.level);
}

function isEnemyInTunnel(enemy: IGameObject): boolean {
    if (enemy.roundedY() !== TUNNEL_ROW) return false;
    const col = enemy.roundedX();
    return col <= TUNNEL_SLOW_COL_MAX || col >= TUNNEL_SLOW_COL_MIN;
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
            // Cruise Elroy: Blinky gets a speed boost in chase/scatter mode
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
    const onTunnelRow = enemy.roundedY() === TUNNEL_ROW;
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
        endTime: Time.timeSinceStart + 1.0,
    });

    // Freeze this player briefly while score is shown
    player.frozen = true;
    Time.addTimer(0.5, () => { player.frozen = false; });

    Sound.enemyEaten();

    // Enemy becomes eyes and speeds home
    enemy.enemyMode = 'eyes';
    enemy.moveSpeed = SPEED_EYES;
}

// ── Enemy House Release (Phase 3) ──────────────────────────────────────────────

function releaseEnemy(enemy: IGameObject): void {
    enemy.enemyMode = 'exiting';
    enemy.moveSpeed = getEnemyNormalSpeed(gameState.level);
    // Cruise Elroy resumes once Clyde begins exiting the enemy house
    if (enemy.color === 'orange' && gameState.elroySuspended) {
        gameState.elroySuspended = false;
    }
}

function getNextHouseEnemy(): IGameObject | null {
    for (const enemy of [gameState.pinky, gameState.inky, gameState.clyde]) {
        if (enemy.enemyMode === 'house') return enemy;
    }
    return null;
}

// Release all house enemies whose personal counter has reached their limit (cascading)
function checkAndReleaseHouseEnemies(): void {
    if (gameState.useGlobalDotCounter) return; // global counter handles its own releases
    for (const enemy of [gameState.pinky, gameState.inky, gameState.clyde]) {
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
        if (gc >= GLOBAL_THRESHOLDS['hotpink'] && gameState.pinky.enemyMode === 'house') {
            releaseEnemy(gameState.pinky);
        }
        if (gc >= GLOBAL_THRESHOLDS['cyan'] && gameState.inky.enemyMode === 'house') {
            releaseEnemy(gameState.inky);
        }
        if (gc >= GLOBAL_THRESHOLDS['orange'] && gameState.clyde.enemyMode === 'house') {
            releaseEnemy(gameState.clyde);
            gameState.useGlobalDotCounter = false; // deactivate (Clyde was inside at 32)
        }
        // If Clyde was already outside at 32, the counter keeps running (stuck-enemy exploit)
    } else {
        // Increment only the active enemy's personal counter (first one still in house)
        for (const enemy of [gameState.pinky, gameState.inky, gameState.clyde]) {
            if (enemy.enemyMode === 'house') {
                gameState.personalDotCounters[enemy.color]++;
                break;
            }
        }
        checkAndReleaseHouseEnemies();
    }
}

function updateIdleTimer(dt: number): void {
    const hasHouseEnemy = [gameState.pinky, gameState.inky, gameState.clyde]
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
    // Players
    const pmPos = tileToPixel(START.player.x, START.player.y);
    for (const player of gameState.players) {
        player.actor.x = pmPos.x; player.actor.y = pmPos.y;
        player.actor.moveDir = (player.id === 2 || player.id === 4) ? 'right' : 'left';
        player.actor.moveSpeed = getPlayerNormalSpeed(gameState.level);
        player.frozen = false;
    }

    // Blinky always starts outside
    const bl = gameState.blinky;
    const blPos = tileToPixel(START.blinky.x, START.blinky.y);
    bl.x = blPos.x; bl.y = blPos.y;
    bl.moveDir = 'left'; bl.moveSpeed = getEnemyNormalSpeed(gameState.level);
    bl.enemyMode = 'scatter';

    // House ghosts reset to their starting positions inside
    const houseActors: Array<{ enemy: IGameObject; start: { x: number; y: number }; dir: Direction }> = [
        { enemy: gameState.pinky, start: START.pinky, dir: 'down' }, // center starts down
        { enemy: gameState.inky,  start: START.inky,  dir: 'up'   }, // left starts up
        { enemy: gameState.clyde, start: START.clyde, dir: 'up'   }, // right starts up
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

    // Immediately release any enemy whose counter is already at its limit (e.g. Pinky=0)
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
    gameState.fruitHistory.push(gameState.level);
    Time.addTimer(1.5, () => {
        gameState.level++;
        Levels.levelDynamic = Levels.level1.map(row => [...row]);
        gameState.dotsEaten = 0;
        gameState.fruitSpawned1 = false;
        gameState.fruitSpawned2 = false;
        gameState.fruitActive = null;
        // Revive all players who have lives (shared pool still > 0) for next level
        for (const p of gameState.players) { p.active = true; p.dying = false; }
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
    // Use native setTimeout so the transition is independent of the game-loop
    // timer system — any error in a pending Time.addTimer callback won't block it.
    setTimeout(() => {
        if (Stats.qualifiesForTopTen(Stats.currentScore)) {
            showInitialsEntry(() => { returningToMenu = true; });
        } else {
            setTimeout(() => { returningToMenu = true; }, 2000);
        }
    }, 1500);
}

function loseLife(player: PlayerState): void {
    if (player.dying || !player.active || gameState.gameOver) return;
    player.dying = true;
    player.deathProgress = 0;
    Sound.death();

    Time.addTimer(DEATH_ANIM_DURATION, () => {
        // levelClear() resets dying to false — if it already fired, skip this death entirely
        if (!player.dying) return;
        // Guard: another player's death may have already triggered game over in the same frame
        if (gameState.gameOver) return;
        player.dying = false;
        player.active = false;

        // Deduct a life, floored at 0
        if (gameState.sharedLives > 0) gameState.sharedLives--;

        const anyoneAlive = gameState.players.some(p => p.active);
        if (anyoneAlive) {
            // Other players still alive — dead player sits out until next level
        } else if (gameState.sharedLives === 0) {
            triggerGameOver();
        } else {
            // All players down but lives remain — revive everyone and play READY!
            for (const p of gameState.players) { p.active = true; p.dying = false; }
            resetPositions(true);
            gameState.showReady = true;
            gameState.frozen = true;
            Time.addTimer(1.5, () => {
                gameState.frozen = false;
                gameState.showReady = false;
                staggerLateStarters();
            });
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

function initializeLevel(slots: ConfirmedSlot[]): void {
    Levels.levelSetup   = Levels.level1;
    Levels.levelDynamic = Levels.level1.map(row => [...row]);

    // Pre-initialize personal counters so resetPositions can reference them
    gameState.personalDotCounters = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };
    gameState.modeChangesInHouse  = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };

    // Create all players from confirmed slots
    gameState.players = slots.map(s => createPlayer(s.id, START.player, s.input));

    gameState.blinky = new GameObject('red',     START.blinky.x, START.blinky.y, 0.667, Move.blinky, Draw.enemy,  enemyOnTileChanged, makeEnemyTileCentered(() => gameState.blinky));
    gameState.inky   = new GameObject('cyan',    START.inky.x,   START.inky.y,   0.667, Move.inky,   Draw.enemy,  enemyOnTileChanged, makeEnemyTileCentered(() => gameState.inky));
    gameState.pinky  = new GameObject('hotpink', START.pinky.x,  START.pinky.y,  0.667, Move.pinky,  Draw.enemy,  enemyOnTileChanged, makeEnemyTileCentered(() => gameState.pinky));
    gameState.clyde  = new GameObject('orange',  START.clyde.x,  START.clyde.y,  0.667, Move.clyde,  Draw.enemy,  enemyOnTileChanged, makeEnemyTileCentered(() => gameState.clyde));

    // Player actors drawn first (under enemies)
    gameState.gameObjects = [...gameState.players.map(p => p.actor), gameState.blinky, gameState.inky, gameState.pinky, gameState.clyde];
    gameState.enemies      = [gameState.blinky, gameState.inky, gameState.pinky, gameState.clyde];

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

function update(): void {
    try { Time.update(); } catch (e) { console.error('Time.update error:', e); }

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
            document.onkeydown = (e: KeyboardEvent) => { handleMenuInteraction(); };
            startScreenLoop();
        }
        return;
    }

    if (!gameState.frozen && !gameState.gameOver) {
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

    window.requestAnimationFrame(update);
}

function start(slots: ConfirmedSlot[]): void {
    // Inject debug phantom players (noop GamepadPlayerInput with nonexistent index)
    const maxId = slots.reduce((m, s) => Math.max(m, s.id), 0);
    for (let i = 0; i < debugExtraPlayers && slots.length < 4; i++) {
        slots = [...slots, { id: maxId + i + 1, input: new GamepadPlayerInput(99) as PlayerInput }];
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

    gameStarted = true;
    Time.setup();
    initializeLevel(slots);
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
let debugExtraPlayers = 0; // injected phantom players for testing multiplayer
let audioUnlocked = false;   // true after first user gesture (AudioContext created)
let menuMusicPlaying = false; // true while menu music is actively playing
let controllerActive = false; // true once any gamepad interaction is detected; never resets

let menuAnimTime = 0;
let menuAnimLastTs = 0;
let startScreenPrevA = false; // tracks gamepad A button state for rising-edge detection

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
    const y = unit * 28.5;
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
    // Audio already unlocked — go to player select if a controller was ever active,
    // otherwise start solo directly (keeps single-player flow intact).
    gameStarted = true;
    if (controllerActive) {
        playerSelectLoop();
    } else {
        start([{ id: 1, input: new CompositePlayerInput([new KeyboardPlayerInput(), new TouchPlayerInput()]) as PlayerInput }]);
    }
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
            const aPressed = p1gp.buttons[0]?.pressed  ?? false;
            const dLeft    = p1gp.buttons[14]?.pressed ?? false;
            const dRight   = p1gp.buttons[15]?.pressed ?? false;
            const dUp      = p1gp.buttons[12]?.pressed ?? false;
            const dDown    = p1gp.buttons[13]?.pressed ?? false;
            if (aPressed  && !prev0[0])  confirmAndStart();
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

function startScreenLoop(): void {
    if (gameStarted) return;

    // Poll only gamepad 0 (P1) for A button — other controllers don't advance the menu
    const p1Gamepad = (navigator.getGamepads ? navigator.getGamepads() : [])[0] ?? null;
    const aDown = p1Gamepad?.buttons[0]?.pressed ?? false;
    if (aDown && !startScreenPrevA) handleMenuInteraction(true);
    startScreenPrevA = aDown;

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
    ctx.fillText('PAC-MAN', w / 2, unit * 5);

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

    // Tap to start (two-phase on first load)
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.round(unit * 0.9)}px monospace`;
    ctx.fillText(audioUnlocked ? 'TAP TO START' : 'TAP TO PLAY MUSIC', w / 2, unit * 31);

    // Music credit
    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(unit * 0.6)}px monospace`;
    ctx.fillText('Music by HeatleyBros', w / 2, unit * 33.5);

    window.requestAnimationFrame(startScreenLoop);
}

function resizeCanvas(): void {
    const canvas = gameState.canvas;
    const scale = Math.min(window.innerWidth / 560, window.innerHeight / 720);
    canvas.style.width  = `${560 * scale}px`;
    canvas.style.height = `${720 * scale}px`;
}

window.onload = function () {
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    gameState.canvas = canvas;
    gameState.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    if (new URLSearchParams(window.location.search).get('dev') === 'true') {
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
                <label><input type="checkbox" id="dbg-ghostpaths"> Enemy paths</label>
                <label><input type="checkbox" id="dbg-tilepicker"> Tile picker</label>
                <label style="flex-direction:column;align-items:flex-start;gap:10px">
                    <span id="dbg-extra-players-label">Extra players: 0</span>
                    <input type="range" id="dbg-extra-players" min="0" max="3" value="0"
                        style="width:100%;accent-color:yellow;cursor:pointer">
                </label>
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
        (document.getElementById('dbg-ghostpaths') as HTMLInputElement).onchange = (e) => {
            gameState.debugShowEnemyPaths = (e.target as HTMLInputElement).checked;
        };
        (document.getElementById('dbg-tilepicker') as HTMLInputElement).onchange = (e) => {
            gameState.debugTilePicker = (e.target as HTMLInputElement).checked;
            if (!gameState.debugTilePicker) gameState.debugSelectedTile = null;
        };
        const extraPlayersSlider = document.getElementById('dbg-extra-players') as HTMLInputElement;
        const extraPlayersLabel  = document.getElementById('dbg-extra-players-label') as HTMLSpanElement;
        extraPlayersSlider.oninput = () => {
            debugExtraPlayers = parseInt(extraPlayersSlider.value);
            extraPlayersLabel.textContent = `Extra players: ${debugExtraPlayers}`;
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

    // Mark controllerActive as soon as any gamepad connects (covers mid-session plug-in)
    window.addEventListener('gamepadconnected', () => { controllerActive = true; });

    document.onkeydown = (e: KeyboardEvent) => { handleMenuInteraction(); };
    document.addEventListener('click', () => handleMenuInteraction());
    document.addEventListener('touchend', (e: Event) => { e.preventDefault(); handleMenuInteraction(); }, { passive: false } as EventListenerOptions);

    startScreenLoop();
};
