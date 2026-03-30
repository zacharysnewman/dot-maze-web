import type { IGameObject, PlayerState } from './types';

export const gameState = {
    canvas: null as unknown as HTMLCanvasElement,
    ctx: null as unknown as CanvasRenderingContext2D,
    players: [] as PlayerState[],
    sharedLives: 0,
    blinky: null as unknown as IGameObject,
    inky: null as unknown as IGameObject,
    pinky: null as unknown as IGameObject,
    clyde: null as unknown as IGameObject,
    gameObjects: [] as IGameObject[],
    enemies: [] as IGameObject[],
    frozen: false,
    gameOver: false,
    level: 1,
    // Scatter/chase mode state (Phase 2)
    scatterChaseIndex: 0,
    scatterChaseElapsed: 0,
    // Frightened mode state (Phase 4)
    frightenedRemaining: 0,
    enemyEatenChain: 0,
    scorePopups: [] as Array<{ x: number; y: number; score: number; endTime: number }>,
    // Enemy house state (Phase 3)
    useGlobalDotCounter: false,
    globalDotCounter: 0,
    personalDotCounters: {} as Record<string, number>,
    modeChangesInHouse: {} as Record<string, number>,
    idleTimer: 0,
    // Fruit state (Phase 7)
    dotsEaten: 0,
    fruitActive: null as null | { x: number; y: number; endTime: number },
    fruitSpawned1: false,
    fruitSpawned2: false,
    fruitHistory: [] as number[],
    // Cruise Elroy state (Phase 8)
    elroyLevel: 0 as 0 | 1 | 2,   // 0 = inactive, 1 = Elroy 1, 2 = Elroy 2
    elroySuspended: false,          // true after Player death; clears when Clyde exits house
    // Ready state (Phase 10)
    showReady: false,
    // Debug overlay (enabled via ?dev=true)
    debugEnabled: false,
    debugShowTargetTiles: false,
    debugShowTargetingViz: false,
    debugShowModes: false,
    debugEnemyTargets: {} as Record<string, { x: number; y: number } | null>,
    debugInkyPivot: null as { x: number; y: number } | null,
    debugPinkyAhead: null as { x: number; y: number } | null,
    debugClydeDistToPlayer: 0,
    debugShowRedZones: false,
    debugShowEnemyPaths: false,
    debugTilePicker: false,
    debugSelectedTile: null as { x: number; y: number } | null,
};
