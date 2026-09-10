import type { LevelData, TileValue } from '../types';
import { countUsage, getTileSet, type MarkerKindId, type TileSet, type Usage } from './TileSet';
import { defaultPrefs, type EditorPrefs } from './EditorPrefs';

export type EditorTool =
    | 'paint'
    | 'erase'
    | 'fill'
    | 'move'          // grab / place the single movable objects (spawns, targets)
    | 'red_zone'
    | 'slow_zone';

export interface EditorState {
    level: LevelData;
    /** Library entry id if this level was loaded from / saved to the library */
    libraryId: string | null;
    selectedTool: EditorTool;
    selectedTileValue: TileValue;
    /** Which movable object the move tool places on the next canvas click. */
    armedMarker: MarkerKindId | null;
    /** Object currently being dragged, if any. */
    draggingMarker: MarkerKindId | null;
    hoveredCell: { x: number; y: number } | null;
    undoStack: LevelData[];
    redoStack: LevelData[];
    isDirty: boolean;
    /** Live count of everything the tile set budgets. */
    usage: Usage;
    prefs: EditorPrefs;
    /** Set when a readout in the panel needs refreshing on the next frame. */
    uiDirty: boolean;
}

export function deepCopyLevel(level: LevelData): LevelData {
    return {
        ...level,
        tiles: level.tiles.map(row => [...row] as TileValue[]),
        playerStart:    { ...level.playerStart },
        enemyStarts: {
            redEnemy:     { ...level.enemyStarts.redEnemy },
            cyanEnemy:    { ...level.enemyStarts.cyanEnemy },
            hotpinkEnemy: { ...level.enemyStarts.hotpinkEnemy },
            orangeEnemy:  { ...level.enemyStarts.orangeEnemy },
        },
        fruitSpawn:     { ...level.fruitSpawn },
        enemyHouseDoor: { ...level.enemyHouseDoor },
        redZoneTiles:     level.redZoneTiles.map(t => ({ ...t })),
        tunnelSlowTiles:  level.tunnelSlowTiles.map(t => ({ ...t })),
        scatterTargets: {
            redEnemy:     { ...level.scatterTargets.redEnemy },
            cyanEnemy:    { ...level.scatterTargets.cyanEnemy },
            hotpinkEnemy: { ...level.scatterTargets.hotpinkEnemy },
            orangeEnemy:  { ...level.scatterTargets.orangeEnemy },
        },
    };
}

export function createEditorState(
    level: LevelData,
    libraryId: string | null = null,
    prefs: EditorPrefs = defaultPrefs(),
): EditorState {
    const copy = deepCopyLevel(level);
    return {
        level: copy,
        libraryId,
        selectedTool: 'paint',
        selectedTileValue: 5 as TileValue, // TILE_EMPTY
        armedMarker: null,
        draggingMarker: null,
        hoveredCell: null,
        undoStack: [],
        redoStack: [],
        isDirty: false,
        usage: countUsage(copy),
        prefs,
        uiDirty: true,
    };
}

export function activeTileSet(state: EditorState): TileSet {
    return getTileSet(state.prefs.tileSetId);
}

/** Recount from scratch — after undo/redo, import, load or reset. */
export function recountUsage(state: EditorState): void {
    state.usage = countUsage(state.level);
    state.uiDirty = true;
}

export function pushUndo(state: EditorState): void {
    state.undoStack.push(deepCopyLevel(state.level));
    state.redoStack = [];
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.isDirty = true;
}

export function undo(state: EditorState): boolean {
    if (state.undoStack.length === 0) return false;
    state.redoStack.push(deepCopyLevel(state.level));
    state.level = state.undoStack.pop()!;
    recountUsage(state);
    return true;
}

export function redo(state: EditorState): boolean {
    if (state.redoStack.length === 0) return false;
    state.undoStack.push(deepCopyLevel(state.level));
    state.level = state.redoStack.pop()!;
    recountUsage(state);
    return true;
}
