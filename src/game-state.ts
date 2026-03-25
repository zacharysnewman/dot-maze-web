import type { IGameObject } from './types';

export const gameState = {
    canvas: null as unknown as HTMLCanvasElement,
    ctx: null as unknown as CanvasRenderingContext2D,
    pacman: null as unknown as IGameObject,
    blinky: null as unknown as IGameObject,
    inky: null as unknown as IGameObject,
    pinky: null as unknown as IGameObject,
    sue: null as unknown as IGameObject,
    gameObjects: [] as IGameObject[],
    ghosts: [] as IGameObject[],
    frozen: false,
    pacmanFrozen: false,
    gameOver: false,
    level: 1,
    // Scatter/chase mode state (Phase 2)
    scatterChaseIndex: 0,
    scatterChaseElapsed: 0,
    // Frightened mode state (Phase 4)
    frightenedEnd: 0,
    ghostEatenChain: 0,
    scorePopups: [] as Array<{ x: number; y: number; score: number; endTime: number }>,
};
