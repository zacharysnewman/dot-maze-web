import { unit } from './constants';
import { gameState } from './game-state';
import { Time }  from './static/Time';
import { Input } from './static/Input';
import { Draw }  from './static/Draw';
import { Move }  from './static/Move';
import { AI }    from './static/AI';
import { Levels } from './static/Levels';
import { Stats }  from './static/Stats';
import { GameObject } from './object/GameObject';
import type { IGameObject, Direction } from './types';

// Starting tile positions for each actor
const START = {
    pacman: { x: 13.5, y: 26 },
    blinky: { x: 13.5, y: 14 },
    inky:   { x: 12,   y: 17 },
    pinky:  { x: 13.5, y: 17 },
    clyde:  { x: 15,   y: 17 },
};

// Ghost movement speeds — Phase 6 will replace these with a full speed table
const SPEED_NORMAL     = 1.0;
const SPEED_FRIGHTENED = 0.5;
const SPEED_EYES       = 1.5;

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
                ghost.moveDir = oppositeDir(ghost.moveDir);
            }
        }
    }
}

// ── Frightened Mode ───────────────────────────────────────────────────────────

function activateFrightened(): void {
    const duration = getFrightenedDuration(gameState.level);
    gameState.ghostEatenChain = 0;

    if (duration <= 0) {
        // Zero duration: reverse ghosts but don't turn them blue
        for (const ghost of gameState.ghosts) {
            if (ghost.ghostMode !== 'eyes' && ghost.ghostMode !== 'house' &&
                ghost.ghostMode !== 'exiting') {
                ghost.moveDir = oppositeDir(ghost.moveDir);
            }
        }
        return;
    }

    gameState.frightenedEnd = Time.timeSinceStart + duration;
    for (const ghost of gameState.ghosts) {
        if (ghost.ghostMode !== 'eyes' && ghost.ghostMode !== 'house' &&
            ghost.ghostMode !== 'exiting') {
            ghost.ghostMode = 'frightened';
            ghost.moveDir = oppositeDir(ghost.moveDir);
            ghost.moveSpeed = SPEED_FRIGHTENED;
        }
    }
}

function updateFrightenedMode(): void {
    if (gameState.frightenedEnd <= 0) return;
    if (Time.timeSinceStart < gameState.frightenedEnd) return;

    gameState.frightenedEnd = 0;
    const globalMode = AI.getCurrentGlobalMode();
    for (const ghost of gameState.ghosts) {
        if (ghost.ghostMode === 'frightened') {
            ghost.ghostMode = globalMode;
            ghost.moveSpeed = SPEED_NORMAL;
        }
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

    // Freeze Pac-Man briefly while score is shown
    gameState.pacmanFrozen = true;
    Time.addTimer(1.0, () => { gameState.pacmanFrozen = false; });

    // Ghost becomes eyes and speeds home
    ghost.ghostMode = 'eyes';
    ghost.moveSpeed = SPEED_EYES;
}

// ── Ghost House Release (Phase 3) ─────────────────────────────────────────────

function releaseGhost(ghost: IGameObject): void {
    ghost.ghostMode = 'exiting';
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
            ghost.moveSpeed = SPEED_NORMAL;
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
    pm.moveDir = 'left'; pm.moveSpeed = SPEED_NORMAL;

    // Blinky always starts outside
    const bl = gameState.blinky;
    const blPos = tileToPixel(START.blinky.x, START.blinky.y);
    bl.x = blPos.x; bl.y = blPos.y;
    bl.moveDir = 'left'; bl.moveSpeed = SPEED_NORMAL;
    bl.ghostMode = 'scatter';

    // House ghosts reset to their starting positions inside
    const houseActors: Array<{ ghost: IGameObject; start: { x: number; y: number } }> = [
        { ghost: gameState.pinky, start: START.pinky },
        { ghost: gameState.inky,  start: START.inky  },
        { ghost: gameState.clyde, start: START.clyde  },
    ];
    for (const { ghost, start } of houseActors) {
        const pos = tileToPixel(start.x, start.y);
        ghost.x = pos.x; ghost.y = pos.y;
        ghost.moveDir = 'down'; // start bouncing downward
        ghost.moveSpeed = SPEED_NORMAL;
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

    gameState.frightenedEnd = 0;
    gameState.ghostEatenChain = 0;
    gameState.scorePopups = [];
    gameState.pacmanFrozen = false;
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
    Time.addTimer(1.5, () => {
        gameState.level++;
        Levels.levelDynamic = Levels.level1.map(row => [...row]);
        resetPositions(false);
        gameState.frozen = false;
    });
}

function loseLife(): void {
    if (gameState.frozen || gameState.gameOver) return;
    gameState.frozen = true;
    Stats.lives--;

    if (Stats.lives <= 0) {
        gameState.gameOver = true;
        return;
    }

    Time.addTimer(1.0, () => {
        resetPositions(true); // afterDeath=true → enable global dot counter
        gameState.frozen = false;
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
        Time.addTimer(0.01666666667, () => { gameState.pacman.moveSpeed = 1.0; });
        incrementDotCounters();
        if (countRemainingDots() === 0) levelClear();
    }

    // Power pellet — triggers frightened mode
    if (curTile === 4) {
        Levels.levelDynamic[y][x] = 5;
        Stats.addToScore(50);
        gameState.pacman.moveSpeed = 0.0;
        Time.addTimer(0.05, () => { gameState.pacman.moveSpeed = 1.0; });
        incrementDotCounters();
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

// ── Main Update Loop ──────────────────────────────────────────────────────────

function update(): void {
    Time.update();

    if (!gameState.frozen && !gameState.gameOver) {
        Input.update();
        updateScatterChaseMode(Time.deltaTime);
        updateFrightenedMode();
        updateIdleTimer(Time.deltaTime);
    }

    Draw.level();

    for (const go of gameState.gameObjects) {
        go.update();
    }

    Draw.scorePopups();

    if (!gameState.frozen && !gameState.gameOver) {
        checkCollisions();
    }

    Draw.hud();

    if (gameState.gameOver) {
        Draw.gameOverScreen();
    }

    window.requestAnimationFrame(update);
}

function start(): void {
    Time.setup();
    initializeLevel();
    update();
}

function setupTouchControls(): void {
    let touchStartX = 0;
    let touchStartY = 0;
    let swipeFiredThisTouch = false;
    const minSwipeDistance = 40;

    function applySwipe(dx: number, dy: number): void {
        if (Math.abs(dx) > Math.abs(dy)) {
            Input.bufferedDir = dx < 0 ? 'left' : 'right';
        } else {
            Input.bufferedDir = dy < 0 ? 'up' : 'down';
        }
        Input.bufferedDirFramesLeft = Input.BUFFER_FRAMES;
    }

    document.addEventListener('touchstart', (e: TouchEvent) => {
        e.preventDefault();
        touchStartX = e.changedTouches[0].clientX;
        touchStartY = e.changedTouches[0].clientY;
        swipeFiredThisTouch = false;
    }, { passive: false });

    document.addEventListener('touchmove', (e: TouchEvent) => {
        e.preventDefault();
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < minSwipeDistance && Math.abs(dy) < minSwipeDistance) return;
        // Reset origin so the next segment of finger movement registers as a new swipe
        touchStartX = e.changedTouches[0].clientX;
        touchStartY = e.changedTouches[0].clientY;
        swipeFiredThisTouch = true;
        applySwipe(dx, dy);
    }, { passive: false });

    document.addEventListener('touchend', (e: TouchEvent) => {
        e.preventDefault();
        if (swipeFiredThisTouch) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < minSwipeDistance && Math.abs(dy) < minSwipeDistance) return;
        applySwipe(dx, dy);
    }, { passive: false });
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

    document.onkeydown = Input.checkKeyDown;
    document.onkeyup   = Input.checkKeyUp;

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setupTouchControls();

    start();
};
