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
import type { IGameObject, Direction } from './types';
import { KeyboardPlayerInput } from './input/KeyboardPlayerInput';
import { TouchPlayerInput    } from './input/TouchPlayerInput';
import { GamepadPlayerInput  } from './input/GamepadPlayerInput';
import { CompositePlayerInput } from './input/CompositePlayerInput';

// Starting tile positions for each actor
const START = {
    pacman: { x: 13.5, y: 26 },
    blinky: { x: 13.5, y: 14 },
    inky:   { x: 12,   y: 17 },
    pinky:  { x: 13.5, y: 17 },
    clyde:  { x: 15,   y: 17 },
};

// Ghost eye-return speed (constant regardless of level)
const SPEED_EYES = 1.5;

// ── Fruit (Phase 7) ───────────────────────────────────────────────────────────

// Fruit spawns below the ghost house at tile (13, 20)
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
    if (Math.abs(gameState.pacman.x - fx) < unit && Math.abs(gameState.pacman.y - fy) < unit) {
        const score = getFruitPoints(gameState.level);
        Stats.addToScore(score);
        gameState.scorePopups.push({ x: fx, y: fy, score, endTime: Time.timeSinceStart + 2.0 });
        gameState.fruitActive = null;
    }
}

// ── Speed Table (Phase 6) ─────────────────────────────────────────────────────
// All values are fractions of max speed (1.0 = 100%)

function getPacmanNormalSpeed(level: number): number {
    if (level === 1) return 0.80;
    if (level <= 4)  return 0.90;
    if (level <= 20) return 1.00;
    return 0.90; // level 21+
}

function getPacmanFrightSpeed(level: number): number {
    if (level === 1) return 0.90;
    if (level <= 4)  return 0.95;
    if (level <= 20) return 1.00;
    return 0.90; // level 21+ — no boost (same as normal)
}

function getGhostNormalSpeed(level: number): number {
    if (level === 1) return 0.75;
    if (level <= 4)  return 0.85;
    return 0.95; // level 5+
}

function getGhostFrightSpeed(level: number): number {
    if (level === 1) return 0.50;
    if (level <= 4)  return 0.55;
    return 0.60; // level 5+
}

function getGhostTunnelSpeed(level: number): number {
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

// Returns the speed Pac-Man should be moving at right now (used after a dot pause)
function getCurrentPacmanSpeed(): number {
    const anyFrightened = gameState.ghosts.some(g => g.ghostMode === 'frightened');
    return anyFrightened
        ? getPacmanFrightSpeed(gameState.level)
        : getPacmanNormalSpeed(gameState.level);
}

function isGhostInTunnel(ghost: IGameObject): boolean {
    if (ghost.roundedY() !== TUNNEL_ROW) return false;
    const col = ghost.roundedX();
    return col <= TUNNEL_SLOW_COL_MAX || col >= TUNNEL_SLOW_COL_MIN;
}

// Apply correct speed to all active ghosts based on their current mode and position
function updateGhostTunnelSpeeds(): void {
    if (gameState.frozen || gameState.gameOver) return;
    for (const ghost of gameState.ghosts) {
        // Modes managed outside this function
        if (ghost.ghostMode === 'eyes' || ghost.ghostMode === 'house' ||
            ghost.ghostMode === 'exiting') continue;

        if (isGhostInTunnel(ghost)) {
            ghost.moveSpeed = getGhostTunnelSpeed(gameState.level);
        } else if (ghost.ghostMode === 'frightened') {
            ghost.moveSpeed = getGhostFrightSpeed(gameState.level);
        } else if (ghost.color === 'red' && gameState.elroyLevel > 0) {
            // Cruise Elroy: Blinky gets a speed boost in chase/scatter mode
            ghost.moveSpeed = gameState.elroyLevel === 2
                ? getElroySpeed2(gameState.level)
                : getElroySpeed1(gameState.level);
        } else {
            ghost.moveSpeed = getGhostNormalSpeed(gameState.level);
        }
    }
}

// Personal dot-counter limits per ghost color and level group (Phase 3)
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

// Returns true if ghost can physically move in dir from its current rounded tile
function canGhostMoveDir(ghost: IGameObject, dir: Direction): boolean {
    const onTunnelRow = ghost.roundedY() === TUNNEL_ROW;
    switch (dir) {
        case 'left':  return (ghost.leftObject()   ?? 0) > 2 || (onTunnelRow && ghost.leftObject()  === undefined);
        case 'right': return (ghost.rightObject()  ?? 0) > 2 || (onTunnelRow && ghost.rightObject() === undefined);
        case 'up':    return (ghost.topObject()    ?? 0) > 2;
        case 'down':  return (ghost.bottomObject() ?? 0) > 2;
    }
}

// ── Scatter/Chase Timer ───────────────────────────────────────────────────────

function resetScatterChaseTimer(): void {
    gameState.scatterChaseIndex = 0;
    gameState.scatterChaseElapsed = 0;
    for (const ghost of gameState.ghosts) {
        if (ghost.ghostMode !== 'frightened' && ghost.ghostMode !== 'eyes' &&
            ghost.ghostMode !== 'house' && ghost.ghostMode !== 'exiting') {
            ghost.ghostMode = 'scatter';
        }
    }
}

function updateScatterChaseMode(dt: number): void {
    if (gameState.frozen || gameState.gameOver) return;
    // Pause timer while any ghost is frightened (Phase 4 requirement)
    if (gameState.ghosts.some(g => g.ghostMode === 'frightened')) return;

    const duration = AI.getCurrentPhaseDuration();
    if (duration < 0) return; // indefinite phase

    gameState.scatterChaseElapsed += dt;

    if (gameState.scatterChaseElapsed >= duration) {
        gameState.scatterChaseElapsed -= duration;
        if (gameState.scatterChaseIndex < AI.modePatterns.length - 1) {
            gameState.scatterChaseIndex++;
        }
        const newMode = AI.getCurrentGlobalMode();
        for (const ghost of gameState.ghosts) {
            if (ghost.ghostMode === 'house') {
                // Track mode change so exit direction flips to right
                gameState.modeChangesInHouse[ghost.color] =
                    (gameState.modeChangesInHouse[ghost.color] ?? 0) + 1;
            } else if (ghost.ghostMode !== 'frightened' && ghost.ghostMode !== 'eyes' &&
                       ghost.ghostMode !== 'exiting') {
                ghost.ghostMode = newMode;
                reverseGhost(ghost);
            }
        }
    }
}

// ── Frightened Mode ───────────────────────────────────────────────────────────

// Reverse a ghost's direction; if the reversed direction is into a wall, keep current
function reverseGhost(ghost: IGameObject): void {
    const rev = oppositeDir(ghost.moveDir);
    if (canGhostMoveDir(ghost, rev)) ghost.moveDir = rev;
}

function activateFrightened(): void {
    const duration = getFrightenedDuration(gameState.level);
    gameState.ghostEatenChain = 0;

    if (duration <= 0) {
        // Zero duration: reverse ghosts but don't turn them blue
        for (const ghost of gameState.ghosts) {
            if (ghost.ghostMode !== 'eyes' && ghost.ghostMode !== 'house' &&
                ghost.ghostMode !== 'exiting') {
                reverseGhost(ghost);
            }
        }
        return;
    }

    // Reset countdown (use game-time delta so pauses don't eat into it)
    gameState.frightenedRemaining = duration;
    for (const ghost of gameState.ghosts) {
        if (ghost.ghostMode !== 'eyes' && ghost.ghostMode !== 'house' &&
            ghost.ghostMode !== 'exiting') {
            ghost.ghostMode = 'frightened';
            reverseGhost(ghost);
            ghost.moveSpeed = getGhostFrightSpeed(gameState.level);
        }
    }
}

function updateFrightenedMode(dt: number): void {
    if (gameState.frightenedRemaining <= 0) return;
    // Pause the countdown during ghost-eating freeze so those pauses don't
    // consume vulnerability time (matches original arcade behavior)
    if (!gameState.pacmanFrozen) {
        gameState.frightenedRemaining -= dt;
    }
    if (gameState.frightenedRemaining > 0) return;

    gameState.frightenedRemaining = 0;
    const globalMode = AI.getCurrentGlobalMode();
    for (const ghost of gameState.ghosts) {
        if (ghost.ghostMode === 'frightened') {
            ghost.ghostMode = globalMode;
            // Speed will be corrected by updateGhostTunnelSpeeds() this same frame
        }
    }
    // Restore Pac-Man speed if not currently paused for a dot
    if (gameState.pacman.moveSpeed !== 0) {
        gameState.pacman.moveSpeed = getPacmanNormalSpeed(gameState.level);
    }
}

function eatGhost(ghost: IGameObject): void {
    const scores = [200, 400, 800, 1600];
    const score = scores[Math.min(gameState.ghostEatenChain, 3)];
    gameState.ghostEatenChain++;
    Stats.addToScore(score);

    // Show score popup at the capture location
    gameState.scorePopups.push({
        x: ghost.x,
        y: ghost.y,
        score,
        endTime: Time.timeSinceStart + 1.0,
    });

    // Freeze Pac-Man briefly while score is shown; popup stays visible for 1s
    // but the freeze is shorter so other frightened ghosts don't stop as long
    gameState.pacmanFrozen = true;
    Time.addTimer(0.5, () => { gameState.pacmanFrozen = false; });

    Sound.ghostEaten();

    // Ghost becomes eyes and speeds home
    ghost.ghostMode = 'eyes';
    ghost.moveSpeed = SPEED_EYES;
}

// ── Ghost House Release (Phase 3) ─────────────────────────────────────────────

function releaseGhost(ghost: IGameObject): void {
    ghost.ghostMode = 'exiting';
    ghost.moveSpeed = getGhostNormalSpeed(gameState.level);
    // Cruise Elroy resumes once Clyde begins exiting the ghost house
    if (ghost.color === 'orange' && gameState.elroySuspended) {
        gameState.elroySuspended = false;
    }
}

function getNextHouseGhost(): IGameObject | null {
    for (const ghost of [gameState.pinky, gameState.inky, gameState.clyde]) {
        if (ghost.ghostMode === 'house') return ghost;
    }
    return null;
}

// Release all house ghosts whose personal counter has reached their limit (cascading)
function checkAndReleaseHouseGhosts(): void {
    if (gameState.useGlobalDotCounter) return; // global counter handles its own releases
    for (const ghost of [gameState.pinky, gameState.inky, gameState.clyde]) {
        if (ghost.ghostMode !== 'house') continue;
        const limit = getPersonalLimit(ghost.color, gameState.level);
        if (gameState.personalDotCounters[ghost.color] >= limit) {
            releaseGhost(ghost);
            // Don't break — next iteration picks up the newly-active ghost
        } else {
            break; // This ghost's counter is active and not yet at limit
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
        if (gc >= GLOBAL_THRESHOLDS['hotpink'] && gameState.pinky.ghostMode === 'house') {
            releaseGhost(gameState.pinky);
        }
        if (gc >= GLOBAL_THRESHOLDS['cyan'] && gameState.inky.ghostMode === 'house') {
            releaseGhost(gameState.inky);
        }
        if (gc >= GLOBAL_THRESHOLDS['orange'] && gameState.clyde.ghostMode === 'house') {
            releaseGhost(gameState.clyde);
            gameState.useGlobalDotCounter = false; // deactivate (Clyde was inside at 32)
        }
        // If Clyde was already outside at 32, the counter keeps running (stuck-ghost exploit)
    } else {
        // Increment only the active ghost's personal counter (first one still in house)
        for (const ghost of [gameState.pinky, gameState.inky, gameState.clyde]) {
            if (ghost.ghostMode === 'house') {
                gameState.personalDotCounters[ghost.color]++;
                break;
            }
        }
        checkAndReleaseHouseGhosts();
    }
}

function updateIdleTimer(dt: number): void {
    const hasHouseGhost = [gameState.pinky, gameState.inky, gameState.clyde]
        .some(g => g.ghostMode === 'house');
    if (!hasHouseGhost) { gameState.idleTimer = 0; return; }

    gameState.idleTimer += dt;
    const limit = gameState.level >= 5 ? 3 : 4;
    if (gameState.idleTimer >= limit) {
        gameState.idleTimer = 0;
        const ghost = getNextHouseGhost();
        if (ghost) releaseGhost(ghost);
    }
}

// ── Game Object Callbacks ─────────────────────────────────────────────────────

function makeGhostTileCentered(getGhost: () => IGameObject): (_x: number, _y: number) => void {
    return (_x: number, _y: number) => {
        const ghost = getGhost();
        // Skip AI for ghosts managed by the house system
        if (ghost.ghostMode === 'house' || ghost.ghostMode === 'exiting') return;
        // Eyes arrive at ghost house entrance — snap inside and begin exiting
        if (ghost.ghostMode === 'eyes' && ghost.roundedX() === 13 && ghost.roundedY() === 14) {
            ghost.x = 13 * unit + unit / 2; // exit column
            ghost.y = 17 * unit + unit / 2; // center of house interior
            ghost.moveSpeed = getGhostNormalSpeed(gameState.level);
            ghost.ghostMode = 'exiting';
            return;
        }
        AI.ghostTileCenter(ghost);
    };
}

// ── Positions & Reset ─────────────────────────────────────────────────────────

function resetPositions(afterDeath = false): void {
    // Pac-Man
    const pm = gameState.pacman;
    const pmPos = tileToPixel(START.pacman.x, START.pacman.y);
    pm.x = pmPos.x; pm.y = pmPos.y;
    pm.moveDir = 'left'; pm.moveSpeed = getPacmanNormalSpeed(gameState.level);

    // Blinky always starts outside
    const bl = gameState.blinky;
    const blPos = tileToPixel(START.blinky.x, START.blinky.y);
    bl.x = blPos.x; bl.y = blPos.y;
    bl.moveDir = 'left'; bl.moveSpeed = getGhostNormalSpeed(gameState.level);
    bl.ghostMode = 'scatter';

    // House ghosts reset to their starting positions inside
    const houseActors: Array<{ ghost: IGameObject; start: { x: number; y: number }; dir: Direction }> = [
        { ghost: gameState.pinky, start: START.pinky, dir: 'down' }, // center starts down
        { ghost: gameState.inky,  start: START.inky,  dir: 'up'   }, // left starts up
        { ghost: gameState.clyde, start: START.clyde, dir: 'up'   }, // right starts up
    ];
    for (const { ghost, start, dir } of houseActors) {
        const pos = tileToPixel(start.x, start.y);
        ghost.x = pos.x; ghost.y = pos.y;
        ghost.moveDir = dir;
        ghost.moveSpeed = 1.0;  // bounce/exit uses fixed speed; maze speed applied on release
        ghost.ghostMode = 'house';
    }

    // Ghost house release state
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
    gameState.ghostEatenChain = 0;
    gameState.scorePopups = [];
    gameState.pacmanFrozen = false;
    gameState.fruitActive = null;
    // Cruise Elroy: suspend after death; clear for fresh level start
    gameState.elroyLevel = 0;
    gameState.elroySuspended = afterDeath;
    resetScatterChaseTimer();
    AI.resetPrng();

    // Immediately release any ghost whose counter is already at its limit (e.g. Pinky=0)
    checkAndReleaseHouseGhosts();
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
        resetPositions(false);
        gameState.showReady = true;
        Time.addTimer(1.5, () => {
            gameState.frozen = false;
            gameState.showReady = false;
        });
    });
}

function showInitialsEntry(onDone: () => void): void {
    Sound.stopSiren();
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:2000',
        'background:rgba(0,0,0,0.9)',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px',
        'font-family:monospace;color:white',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'ENTER INITIALS';
    title.style.cssText = 'font-size:28px;font-weight:bold;color:yellow;letter-spacing:4px';

    const scoreEl = document.createElement('div');
    scoreEl.textContent = `SCORE  ${Stats.currentScore}`;
    scoreEl.style.cssText = 'font-size:22px';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 3;
    (input as HTMLInputElement & { autocomplete: string }).autocomplete = 'off';
    input.style.cssText = [
        'font-family:monospace;font-size:48px;font-weight:bold',
        'text-align:center;text-transform:uppercase',
        'background:#111;color:yellow;border:3px solid #666',
        'border-radius:8px;padding:8px 16px;width:160px',
        'letter-spacing:12px;outline:none',
    ].join(';');

    const btn = document.createElement('button');
    btn.textContent = 'DONE';
    btn.style.cssText = [
        'font-family:monospace;font-size:24px;font-weight:bold',
        'background:#222;color:white;border:2px solid #888',
        'border-radius:8px;padding:12px 40px;cursor:pointer;letter-spacing:2px',
    ].join(';');

    function submit(): void {
        const raw = input.value.replace(/[^A-Za-z]/g, '');
        const initials = (raw || 'AAA').toUpperCase().padEnd(3, 'A').slice(0, 3);
        Stats.saveScore(initials, Stats.currentScore);
        document.body.removeChild(overlay);
        onDone();
    }

    input.oninput = () => { input.value = input.value.replace(/[^A-Za-z]/g, '').toUpperCase(); };
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.length > 0) submit(); };
    btn.onclick = submit;

    overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('click',      (e) => e.stopPropagation());

    overlay.append(title, scoreEl, input, btn);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 80);
}

const DEATH_ANIM_DURATION = 2.0;

function loseLife(): void {
    if (gameState.frozen || gameState.gameOver) return;
    gameState.frozen = true;
    gameState.pacmanDying = true;
    gameState.pacmanDeathProgress = 0;
    Sound.death();
    Stats.lives--;

    if (Stats.lives <= 0) {
        gameState.gameOver = true;
        Time.addTimer(DEATH_ANIM_DURATION, () => {
            gameState.pacmanDying = false;
            // After death anim, show game-over then enter initials / return to menu
            Time.addTimer(1.5, () => {
                if (Stats.qualifiesForTopTen(Stats.currentScore)) {
                    showInitialsEntry(() => {
                        Time.addTimer(1.5, () => { returningToMenu = true; });
                    });
                } else {
                    Time.addTimer(2.0, () => { returningToMenu = true; });
                }
            });
        });
        return;
    }

    Time.addTimer(DEATH_ANIM_DURATION, () => {
        gameState.pacmanDying = false;
        resetPositions(true);
        gameState.showReady = true;
        Time.addTimer(1.5, () => {
            gameState.frozen = false;
            gameState.showReady = false;
        });
    });
}

// ── Collision Detection ───────────────────────────────────────────────────────

function checkCollisions(): void {
    const px = gameState.pacman.roundedX();
    const py = gameState.pacman.roundedY();
    for (const ghost of gameState.ghosts) {
        if (ghost.roundedX() === px && ghost.roundedY() === py) {
            if (ghost.ghostMode === 'frightened') {
                eatGhost(ghost);
            } else if (ghost.ghostMode !== 'eyes' && ghost.ghostMode !== 'house' &&
                       ghost.ghostMode !== 'exiting') {
                loseLife();
                return;
            }
        }
    }
}

// ── Pac-Man Tile Callbacks ────────────────────────────────────────────────────

function pacmanOnTileChanged(x: number, y: number): void {
    const curTile = Levels.levelDynamic[y][x];

    // Small dot
    if (curTile === 3) {
        Levels.levelDynamic[y][x] = 5;
        Stats.addToScore(10);
        gameState.pacman.moveSpeed = 0.0;
        Time.addTimer(0.01666666667, () => { gameState.pacman.moveSpeed = getCurrentPacmanSpeed(); });
        incrementDotCounters();
        Sound.dot();
        if (countRemainingDots() === 0) levelClear();
    }

    // Power pellet — triggers frightened mode
    if (curTile === 4) {
        Levels.levelDynamic[y][x] = 5;
        Stats.addToScore(50);
        gameState.pacman.moveSpeed = 0.0;
        Time.addTimer(0.05, () => { gameState.pacman.moveSpeed = getCurrentPacmanSpeed(); });
        incrementDotCounters();
        Sound.energizer();
        activateFrightened();
        if (countRemainingDots() === 0) levelClear();
    }
}

function pacmanOnTileCentered(_x: number, _y: number): void {}

function ghostOnTileChanged(_x: number, _y: number): void {}

// ── Initialization ────────────────────────────────────────────────────────────

function initializeLevel(): void {
    Levels.levelSetup   = Levels.level1;
    Levels.levelDynamic = Levels.level1.map(row => [...row]);

    // Pre-initialize personal counters so resetPositions can reference them
    gameState.personalDotCounters = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };
    gameState.modeChangesInHouse  = { 'hotpink': 0, 'cyan': 0, 'orange': 0 };

    gameState.pacman = new GameObject('yellow',  START.pacman.x, START.pacman.y, 0.667, Move.pacman, Draw.pacman, pacmanOnTileChanged, pacmanOnTileCentered);
    gameState.blinky = new GameObject('red',     START.blinky.x, START.blinky.y, 0.667, Move.blinky, Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.blinky));
    gameState.inky   = new GameObject('cyan',    START.inky.x,   START.inky.y,   0.667, Move.inky,   Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.inky));
    gameState.pinky  = new GameObject('hotpink', START.pinky.x,  START.pinky.y,  0.667, Move.pinky,  Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.pinky));
    gameState.clyde  = new GameObject('orange',  START.clyde.x,  START.clyde.y,  0.667, Move.clyde,  Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.clyde));

    gameState.gameObjects = [gameState.pacman, gameState.blinky, gameState.inky, gameState.pinky, gameState.clyde];
    gameState.ghosts      = [gameState.blinky, gameState.inky, gameState.pinky, gameState.clyde];

    // resetPositions sets all positions, modes, and triggers initial house releases
    resetPositions(false);
}

// ── Ambient Siren ─────────────────────────────────────────────────────────────

function updateAmbientSiren(): void {
    if (gameState.ghosts.some(g => g.ghostMode === 'eyes')) {
        Sound.startSiren('eyes');
    } else if (gameState.frightenedRemaining > 0) {
        Sound.startSiren('blue');
    } else {
        Sound.startSiren('normal');
    }
}

// ── Main Update Loop ──────────────────────────────────────────────────────────

function update(): void {
    Time.update();

    if (returningToMenu) {
        returningToMenu = false;
        gameStarted = false;
        Sound.stopSiren();
        menuMusicPlaying = false; // startScreenLoop will auto-play since audio is unlocked
        p1Input?.destroy();
        p1Input = null;
        startScreenLoop();
        return; // end this loop; startScreenLoop starts its own rAF
    }

    if (!gameState.frozen && !gameState.gameOver) {
        p1Input?.update(gameState.pacman);
        updateScatterChaseMode(Time.deltaTime);
        updateFrightenedMode(Time.deltaTime);
        updateElroy();
        updateGhostTunnelSpeeds();
        updateIdleTimer(Time.deltaTime);
        updateFruit();
        updateAmbientSiren();
    } else {
        Sound.stopSiren();
    }

    if (gameState.pacmanDying) {
        gameState.pacmanDeathProgress = Math.min(
            gameState.pacmanDeathProgress + Time.deltaTime / DEATH_ANIM_DURATION, 1.0,
        );
    }

    Draw.level();

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

function start(): void {
    // Full game state reset for a fresh play
    Stats.reset();
    gameState.level = 1;
    gameState.scatterChaseIndex = 0;
    gameState.scatterChaseElapsed = 0;
    gameState.frightenedRemaining = 0;
    gameState.ghostEatenChain = 0;
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

    p1Input?.destroy();
    p1Input = new CompositePlayerInput([
        new KeyboardPlayerInput(),
        new TouchPlayerInput(),
        new GamepadPlayerInput(0),
    ]);

    Sound.stopMenuMusic();
    menuMusicPlaying = false;

    Time.setup();
    initializeLevel();
    gameState.frozen = true;
    gameState.showReady = true;
    Sound.introChimes();
    Time.addTimer(2.0, () => {
        gameState.frozen = false;
        gameState.showReady = false;
    });
    update();
}

// ── Start Screen ──────────────────────────────────────────────────────────────

let p1Input: CompositePlayerInput | null = null;

let gameStarted = false;
let returningToMenu = false;
let audioUnlocked = false;   // true after first user gesture (AudioContext created)
let menuMusicPlaying = false; // true while menu music is actively playing

let menuAnimTime = 0;
let menuAnimLastTs = 0;

function drawMenuPacman(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dir: 'left' | 'right', mouthOpen: number): void {
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
    const ghostColors = ['red', '#ffb8ff', 'cyan', 'orange'];
    const PHASE_A = 4;
    const PAUSE   = 1;
    const PHASE_B = 4;
    const CYCLE   = PHASE_A + PAUSE + PHASE_B;
    const totalDist = w + 2 * unit + ghostColors.length * spacing;
    const totalDistB = w + 2 * unit + ghostColors.length * spacingB;
    const cycleT = t % CYCLE;

    const frames = [0.0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1];
    const mouthOpen = frames[Math.floor(t * 30) % frames.length];

    if (cycleT < PHASE_A) {
        // Phase A: Pac-Man fleeing right, ghosts chasing
        const progress = cycleT / PHASE_A;
        const pacX = -unit + totalDist * progress;
        for (let i = ghostColors.length - 1; i >= 0; i--) {
            const gx = pacX - (i + 1) * spacing;
            if (gx < -2 * unit || gx > w + 2 * unit) continue;
            Draw.drawGhostBody(ghostColors[i], gx, y, scale);
            Draw.drawGhostEyes(ghostColors[i], gx, y, scale, 'right');
        }
        if (pacX > -2 * unit && pacX < w + 2 * unit) {
            drawMenuPacman(ctx, pacX, y, size, 'right', mouthOpen);
        }
    } else if (cycleT >= PHASE_A + PAUSE) {
        // Phase B: frightened ghosts fleeing left, big Pac-Man chasing
        const progress = (cycleT - PHASE_A - PAUSE) / PHASE_B;
        const pacX = w + unit + ghostColors.length * spacingB - totalDistB * progress;
        const pacSize2 = scale * unit * 2;
        for (let i = 0; i < ghostColors.length; i++) {
            const gx = pacX - (i + 1) * spacingB;
            if (gx < -2 * unit || gx > w + 2 * unit) continue;
            Draw.drawGhostBody('#0000cc', gx, y, scale);
            Draw.drawFrightenedEyes(gx, y, scale, '#0000cc');
        }
        if (pacX > -3 * unit && pacX < w + 3 * unit) {
            drawMenuPacman(ctx, pacX, y, pacSize2, 'left', mouthOpen);
        }
    }
}

function startScreenLoop(): void {
    if (gameStarted) return;

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
                padding: 18px 24px; border: 2px solid #666;
                font-family: monospace; font-size: 22px;
                border-radius: 10px; z-index: 9999;
                user-select: none; min-width: 280px;
                touch-action: none;
            }
            #debug-panel h3 {
                margin: 0 0 14px; color: yellow;
                font-size: 22px; letter-spacing: 1px;
            }
            #debug-panel label {
                display: flex; align-items: center;
                gap: 12px; cursor: pointer; margin: 10px 0;
                min-height: 36px;
            }
            #debug-panel input[type=checkbox] {
                cursor: pointer; width: 22px; height: 22px;
                flex-shrink: 0;
            }
            #debug-panel button {
                margin-top: 14px; width: 100%;
                background: #333; color: #eee;
                border: 2px solid #666; border-radius: 6px;
                font-family: monospace; font-size: 22px;
                padding: 8px 0; cursor: pointer; min-height: 44px;
            }
            #debug-panel button:hover { background: #444; }
            </style>
            <h3>⚙ DEBUG</h3>
            <label><input type="checkbox" id="dbg-targets"> Target tiles</label>
            <label><input type="checkbox" id="dbg-viz"> Targeting viz</label>
            <label><input type="checkbox" id="dbg-modes"> Ghost modes</label>
            <label><input type="checkbox" id="dbg-redzones"> Red zones</label>
            <label><input type="checkbox" id="dbg-ghostpaths"> Ghost paths</label>
            <label><input type="checkbox" id="dbg-tilepicker"> Tile picker</label>
            <button id="dbg-pause">⏸ Pause</button>
        `;
        document.body.appendChild(panel);

        // Stop touch events from bubbling to the document touchstart handler
        // (which calls e.preventDefault(), blocking browser click synthesis)
        panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        panel.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });

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
            gameState.debugShowGhostPaths = (e.target as HTMLInputElement).checked;
        };
        (document.getElementById('dbg-tilepicker') as HTMLInputElement).onchange = (e) => {
            gameState.debugTilePicker = (e.target as HTMLInputElement).checked;
            if (!gameState.debugTilePicker) gameState.debugSelectedTile = null;
        };
        const pauseBtn = document.getElementById('dbg-pause') as HTMLButtonElement;
        pauseBtn.onclick = () => {
            gameState.frozen = !gameState.frozen;
            pauseBtn.textContent = gameState.frozen ? '▶ Resume' : '⏸ Pause';
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

    // Two-phase start:
    //   Phase 1 (first gesture): unlock AudioContext + play menu music
    //   Phase 2 (second gesture): stop music + start game
    // After the first play-session, returning to menu auto-plays music, so
    // subsequent sessions only need one tap/click to start the game.
    function handleMenuInteraction(): void {
        if (gameStarted) return;
        if (!audioUnlocked) {
            // First ever gesture — unlock audio and start menu music
            Sound.init();
            audioUnlocked = true;
            Sound.playMenuMusic();
            menuMusicPlaying = true;
            return;
        }
        // Audio already unlocked — start the game
        gameStarted = true;
        start();
    }

    document.onkeydown = (e: KeyboardEvent) => { handleMenuInteraction(); };
    document.addEventListener('click', handleMenuInteraction);
    document.addEventListener('touchstart', handleMenuInteraction as EventListener, { passive: false });

    startScreenLoop();
};
