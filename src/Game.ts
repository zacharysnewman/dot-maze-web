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

function resetPositions(): void {
    const actors: Array<{ key: keyof typeof START; dir: 'left' | 'right' | 'up' | 'down' }> = [
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
    }
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

function checkCollisions(): void {
    const px = gameState.pacman.roundedX();
    const py = gameState.pacman.roundedY();
    for (const ghost of gameState.ghosts) {
        if (ghost.roundedX() === px && ghost.roundedY() === py) {
            loseLife();
            return;
        }
    }
}

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

    // Power pellet
    if (curTile === 4) {
        Levels.levelDynamic[y][x] = 5;
        Stats.addToScore(50);
        gameState.pacman.moveSpeed = 0.0;
        Time.addTimer(0.05, () => { gameState.pacman.moveSpeed = 1.0; });
        if (countRemainingDots() === 0) levelClear();
    }
}

function pacmanOnTileCentered(_x: number, _y: number): void {}

function ghostOnTileChanged(_x: number, _y: number): void {}

function initializeLevel(): void {
    Levels.levelSetup   = Levels.level1;
    Levels.levelDynamic = Levels.level1.map(row => [...row]);

    gameState.pacman = new GameObject('yellow',  START.pacman.x, START.pacman.y, 0.667, Move.pacman, Draw.pacman, pacmanOnTileChanged, pacmanOnTileCentered);
    gameState.blinky = new GameObject('red',     START.blinky.x, START.blinky.y, 0.667, Move.blinky, Draw.ghost,  ghostOnTileChanged, (_x, _y) => AI.ghostTileCenter(gameState.blinky));
    gameState.inky   = new GameObject('cyan',    START.inky.x,   START.inky.y,   0.667, Move.inky,   Draw.ghost,  ghostOnTileChanged, (_x, _y) => AI.ghostTileCenter(gameState.inky));
    gameState.pinky  = new GameObject('hotpink', START.pinky.x,  START.pinky.y,  0.667, Move.pinky,  Draw.ghost,  ghostOnTileChanged, (_x, _y) => AI.ghostTileCenter(gameState.pinky));
    gameState.sue    = new GameObject('orange',  START.sue.x,    START.sue.y,    0.667, Move.sue,    Draw.ghost,  ghostOnTileChanged, (_x, _y) => AI.ghostTileCenter(gameState.sue));

    gameState.gameObjects = [gameState.pacman, gameState.blinky, gameState.inky, gameState.pinky, gameState.sue];
    gameState.ghosts      = [gameState.blinky, gameState.inky, gameState.pinky, gameState.sue];
}

function update(): void {
    Time.update();

    if (!gameState.frozen && !gameState.gameOver) {
        Input.update();
    }

    Draw.level();

    for (const go of gameState.gameObjects) {
        go.update();
    }

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
