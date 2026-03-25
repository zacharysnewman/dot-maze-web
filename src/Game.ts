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
    sue:    { x: 15,   y: 17 },
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
        if (ghost.ghostMode !== 'frightened' && ghost.ghostMode !== 'eyes') {
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
        // Apply new mode and immediately reverse non-frightened, non-eyes ghosts
        for (const ghost of gameState.ghosts) {
            if (ghost.ghostMode !== 'frightened' && ghost.ghostMode !== 'eyes') {
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
            if (ghost.ghostMode !== 'eyes') {
                ghost.moveDir = oppositeDir(ghost.moveDir);
            }
        }
        return;
    }

    gameState.frightenedEnd = Time.timeSinceStart + duration;
    for (const ghost of gameState.ghosts) {
        if (ghost.ghostMode !== 'eyes') {
            ghost.ghostMode = 'frightened';
            ghost.moveDir = oppositeDir(ghost.moveDir);
            ghost.moveSpeed = 0.5;
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
            ghost.moveSpeed = 1.0;
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
    ghost.moveSpeed = 1.5;
}

// ── Game Object Callbacks ─────────────────────────────────────────────────────

function makeGhostTileCentered(getGhost: () => IGameObject): (_x: number, _y: number) => void {
    return (_x: number, _y: number) => {
        const ghost = getGhost();
        // Eyes arrive at ghost house entrance — revive
        if (ghost.ghostMode === 'eyes' && ghost.roundedX() === 13 && ghost.roundedY() === 14) {
            ghost.ghostMode = AI.getCurrentGlobalMode();
            ghost.moveSpeed = 1.0;
            return;
        }
        AI.ghostTileCenter(ghost);
    };
}

// ── Positions & Reset ─────────────────────────────────────────────────────────

function resetPositions(): void {
    const actors: Array<{ key: keyof typeof START; dir: Direction }> = [
        { key: 'pacman', dir: 'left' },
        { key: 'blinky', dir: 'left' },
        { key: 'inky',   dir: 'left' },
        { key: 'pinky',  dir: 'left' },
        { key: 'sue',    dir: 'left' },
    ];
    for (const { key, dir } of actors) {
        const obj = gameState[key];
        const pos = tileToPixel(START[key].x, START[key].y);
        obj.x = pos.x;
        obj.y = pos.y;
        obj.moveDir = dir;
        obj.moveSpeed = 1.0;
        if (key !== 'pacman') {
            obj.ghostMode = 'scatter';
        }
    }
    gameState.frightenedEnd = 0;
    gameState.ghostEatenChain = 0;
    gameState.scorePopups = [];
    gameState.pacmanFrozen = false;
    resetScatterChaseTimer();
    AI.resetPrng();
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
        resetPositions();
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
        resetPositions();
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
            } else if (ghost.ghostMode !== 'eyes') {
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
        if (countRemainingDots() === 0) levelClear();
    }

    // Power pellet — triggers frightened mode
    if (curTile === 4) {
        Levels.levelDynamic[y][x] = 5;
        Stats.addToScore(50);
        gameState.pacman.moveSpeed = 0.0;
        Time.addTimer(0.05, () => { gameState.pacman.moveSpeed = 1.0; });
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

    gameState.pacman = new GameObject('yellow',  START.pacman.x, START.pacman.y, 0.667, Move.pacman, Draw.pacman, pacmanOnTileChanged, pacmanOnTileCentered);
    gameState.blinky = new GameObject('red',     START.blinky.x, START.blinky.y, 0.667, Move.blinky, Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.blinky));
    gameState.inky   = new GameObject('cyan',    START.inky.x,   START.inky.y,   0.667, Move.inky,   Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.inky));
    gameState.pinky  = new GameObject('hotpink', START.pinky.x,  START.pinky.y,  0.667, Move.pinky,  Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.pinky));
    gameState.sue    = new GameObject('orange',  START.sue.x,    START.sue.y,    0.667, Move.sue,    Draw.ghost,  ghostOnTileChanged, makeGhostTileCentered(() => gameState.sue));

    gameState.gameObjects = [gameState.pacman, gameState.blinky, gameState.inky, gameState.pinky, gameState.sue];
    gameState.ghosts      = [gameState.blinky, gameState.inky, gameState.pinky, gameState.sue];

    // All ghosts start in scatter mode
    for (const ghost of gameState.ghosts) {
        ghost.ghostMode = 'scatter';
    }
}

// ── Main Update Loop ──────────────────────────────────────────────────────────

function update(): void {
    Time.update();

    if (!gameState.frozen && !gameState.gameOver) {
        Input.update();
        updateScatterChaseMode(Time.deltaTime);
        updateFrightenedMode();
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
    let swipeFired = false;
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
        swipeFired = false;
    }, { passive: false });

    document.addEventListener('touchmove', (e: TouchEvent) => {
        e.preventDefault();
        if (swipeFired) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < minSwipeDistance && Math.abs(dy) < minSwipeDistance) return;
        swipeFired = true;
        applySwipe(dx, dy);
    }, { passive: false });

    document.addEventListener('touchend', (e: TouchEvent) => {
        e.preventDefault();
        if (swipeFired) return;
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
