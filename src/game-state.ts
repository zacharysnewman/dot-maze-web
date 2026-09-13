import type { IGameObject, LevelData, PlayerState } from './types';

export const gameState = {
    canvas: null as unknown as HTMLCanvasElement,
    currentLevel: null as unknown as LevelData,
    ctx: null as unknown as CanvasRenderingContext2D,
    players: [] as PlayerState[],
    sharedLives: 0,
    redEnemy:     null as unknown as IGameObject,
    cyanEnemy:    null as unknown as IGameObject,
    hotpinkEnemy: null as unknown as IGameObject,
    orangeEnemy:  null as unknown as IGameObject,
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
    elroySuspended: false,          // true after Player death; clears when Orange exits house
    // Ready state (Phase 10)
    showReady: false,
    /**
     * The lobby code, while an online game is running. Null offline. The lobby
     * screen is the only other place it appears, and a game cannot go back
     * there without ending — so without this, nobody can read the code out
     * mid-game.
     */
    onlineCode: null as string | null,
    /**
     * Which player is the one at this keyboard, during an online game. Null
     * offline, where every player on screen is local and marking them all
     * would say nothing.
     */
    onlinePlayerId: null as number | null,
    // Debug overlay (enabled via ?dev=true)
    debugEnabled: false,
    debugShowTargetTiles: false,
    debugShowTargetingViz: false,
    debugShowModes: false,
    debugEnemyTargets: {} as Record<string, { x: number; y: number } | null>,
    debugCyanPivot: null as { x: number; y: number } | null,
    debugHotpinkAhead: null as { x: number; y: number } | null,
    debugOrangeDistToPlayer: 0,
    debugShowRedZones: false,
    debugShowEnemyPaths: false,
    debugTilePicker: false,
    /** Draw the local player from snapshots like everyone else, to see whether
     *  a movement problem is the prediction's or the host's. */
    debugDisablePrediction: false,
    /**
     * How many times this client's prediction disagreed with the host badly
     * enough to be thrown away. Every one is a visible jerk, so it is the
     * number to watch when tuning how input and movement are sent. Snapping
     * onto the host while dying or frozen does not count — nothing is being
     * predicted then.
     */
    netCorrections: 0,
    debugSelectedTile: null as { x: number; y: number } | null,
};
