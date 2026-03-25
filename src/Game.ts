import { gameState } from './game-state';
import { Time }  from './static/Time';
import { Input } from './static/Input';
import { Draw }  from './static/Draw';
import { Move }  from './static/Move';
import { AI }    from './static/AI';
import { Levels } from './static/Levels';
import { Stats }  from './static/Stats';
import { GameObject } from './object/GameObject';

function pacmanOnTileChanged(x: number, y: number): void {
    const curTile = Levels.levelDynamic[y][x];

    // Small dot
    if (curTile === 3) {
        Levels.levelDynamic[y][x] = 5;
        Stats.addToScore(10);
        gameState.pacman.moveSpeed = 0.0;
        Time.addTimer(0.01666666667, () => { gameState.pacman.moveSpeed = 1.0; });
    }

    // Power pellet
    if (curTile === 4) {
        Levels.levelDynamic[y][x] = 5;
        Stats.addToScore(50);
        gameState.pacman.moveSpeed = 0.0;
        Time.addTimer(0.05, () => { gameState.pacman.moveSpeed = 1.0; });
    }
}

function pacmanOnTileCentered(_x: number, _y: number): void {}

function ghostOnTileChanged(_x: number, _y: number): void {}

function ghostOnTileCentered(_x: number, _y: number): void {
    console.log('turn!');
    AI.ghostTileCenter(gameState.blinky);
}

function initializeLevel(): void {
    Levels.levelSetup  = Levels.level1;
    Levels.levelDynamic = Levels.level1.map(row => [...row]);

    gameState.pacman = new GameObject('yellow',   13.5, 26, 0.667, Move.pacman, Draw.pacman, pacmanOnTileChanged, pacmanOnTileCentered);
    gameState.blinky = new GameObject('red',      13.5, 14, 0.667, Move.blinky, Draw.ghost,  ghostOnTileChanged,  ghostOnTileCentered);
    gameState.inky   = new GameObject('cyan',     12,   17, 0.667, Move.inky,   Draw.ghost,  ghostOnTileChanged,  ghostOnTileCentered);
    gameState.pinky  = new GameObject('hotpink',  13.5, 17, 0.667, Move.pinky,  Draw.ghost,  ghostOnTileChanged,  ghostOnTileCentered);
    gameState.sue    = new GameObject('orange',   15,   17, 0.667, Move.sue,    Draw.ghost,  ghostOnTileChanged,  ghostOnTileCentered);

    gameState.gameObjects = [gameState.pacman, gameState.blinky, gameState.inky, gameState.pinky, gameState.sue];
    gameState.ghosts      = [gameState.blinky, gameState.inky, gameState.pinky, gameState.sue];
}

function update(): void {
    Time.update();
    Input.update();
    Draw.level();

    for (const go of gameState.gameObjects) {
        go.update();
    }

    window.requestAnimationFrame(update);
}

function start(): void {
    console.log('start');
    Time.setup();
    initializeLevel();
    update();
}

window.onload = function () {
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    gameState.canvas = canvas;
    gameState.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    document.onkeydown = Input.checkKeyDown;
    document.onkeyup   = Input.checkKeyUp;

    start();
};
