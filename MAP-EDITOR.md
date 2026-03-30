# MAP-EDITOR.md — Level Editor Implementation Plan

## Overview

A browser-based tile editor overlaid on the existing canvas (or in a separate editor mode) that allows designing, saving, and loading custom Pac-Man levels. The editor must handle all tile types, special objects (ghost house, spawn points, warp tunnels), and validate playability.

---

## 1. Tile System

### Current Tile Values (from `Levels.level1`)

The level array is `number[][]` with 36 rows × 28 columns. Based on codebase references:

| Value | Meaning |
|---|---|
| `0` | Solid wall (impassable) |
| `1` | Dot (pellet) |
| `2` | Power pellet |
| `> 2` | Open corridor (passable; ghost/pac movement checks `tileValue > 2`) |
| Special | Ghost house gate — special tile rendered differently (cage opening) |

### Required Changes

- **Document all tile values** in a new `src/tiles.ts` constants file:
  ```ts
  export const TILE_WALL       = 0;
  export const TILE_DOT        = 1;
  export const TILE_POWER      = 2;
  export const TILE_EMPTY      = 3;  // open corridor
  export const TILE_GHOST_DOOR = 4;  // ghost house gate (audit exact value from source)
  ```
- **Wall auto-connection**: `Draw.level()` uses neighbor-aware rendering for connected wall borders. The editor must ensure this recomputes when tiles change (should be free if `Draw.level()` reads `levelDynamic` each frame without caching geometry).

---

## 2. Hardcoded Constants to Parameterize

The following are currently hardcoded and must become `LevelData` fields:

| Constant | Location | Description |
|---|---|---|
| `START.pacman.x/y` | `src/Game.ts` | Pac-Man spawn tile |
| `START.blinky/inky/pinky/clyde .x/y` | `src/Game.ts` | Ghost spawn tiles |
| `TUNNEL_ROW` | `src/constants.ts` | Row for warp tunnels |
| `TUNNEL_SLOW_COL_MAX` | `src/constants.ts` | Slow-down columns (left side) |
| `TUNNEL_SLOW_COL_MIN` | `src/constants.ts` | Slow-down columns (right side) |
| `RED_ZONE_TILES` | `src/constants.ts` | Tiles where ghosts can't turn upward |
| Fruit spawn position | `src/Game.ts` | Where fruit appears |
| Ghost house entrance | implicit | Row/col of ghost house door tile |
| Ghost scatter targets | `src/Move.ts` | Corner tiles ghosts scatter to |

### `LevelData` Interface

All of the above should move into a `LevelData` interface stored alongside the tile array:

```ts
// src/types.ts (add to existing file)
export interface LevelData {
    version: number;
    name: string;
    tiles: number[][];                          // 36×28 tile grid
    pacmanStart: { x: number; y: number };
    ghostStarts: {
        blinky: { x: number; y: number };
        inky:   { x: number; y: number };
        pinky:  { x: number; y: number };
        clyde:  { x: number; y: number };
    };
    fruitSpawn:     { x: number; y: number };
    tunnelRow:      number;
    tunnelSlowColMax: number;
    tunnelSlowColMin: number;
    redZoneTiles:   { x: number; y: number }[];
    ghostHouseDoor: { x: number; y: number };
    scatterTargets: {
        blinky: { x: number; y: number };
        inky:   { x: number; y: number };
        pinky:  { x: number; y: number };
        clyde:  { x: number; y: number };
    };
}
```

---

## 3. Editor Architecture

### Entry Point

- Add `?editor=true` URL parameter (alongside existing `?dev=true`)
- In `window.onload`, detect this and call `startEditorMode()` instead of `startScreenLoop()`
- Editor runs its own `requestAnimationFrame` loop separate from the game loop

### Editor State

```ts
// src/editor/EditorState.ts
export interface EditorState {
    level: LevelData;
    selectedTool: EditorTool;
    selectedTileValue: number;
    hoveredCell: { x: number; y: number } | null;
    undoStack: LevelData[];
    redoStack: LevelData[];
    isDirty: boolean;
    showGrid: boolean;
}

export type EditorTool =
    | 'paint'
    | 'erase'
    | 'fill'
    | 'pacman_spawn'
    | 'ghost_blinky'
    | 'ghost_inky'
    | 'ghost_pinky'
    | 'ghost_clyde'
    | 'fruit_spawn'
    | 'tunnel_config'
    | 'red_zone';
```

### Canvas Interaction

- **Click/touch → tile coordinates**:
  ```ts
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const tx = Math.floor((clientX - rect.left) * scaleX / unit);
  const ty = Math.floor((clientY - rect.top)  * scaleY / unit);
  ```
- **Mouse drag**: paint/erase continuously while button held (`mousedown` → `mousemove` → `mouseup`)
- **Hover**: highlight current cell with a semi-transparent overlay
- **Touch**: `touchstart`/`touchmove`/`touchend` → same tile coords

---

## 4. Editor UI

### HTML Overlay Panel

A fixed-position panel (left or right side, similar to the existing debug panel) containing:

**Tile Palette**
- Visual tile swatches: Wall, Dot, Power Pellet, Empty, Ghost Door
- Selected tile highlighted with border
- Click to select

**Tools**
- Paint (pencil) — place selected tile on click/drag
- Erase — set tile to empty on click/drag
- Flood Fill — replace contiguous same-value tiles (BFS)
- Spawn placers — click canvas to move: Pac-Man start, Blinky/Inky/Pinky/Clyde, Fruit

**Actions**
- Undo (`Ctrl+Z`) / Redo (`Ctrl+Y` or `Ctrl+Shift+Z`)
- New Level (blank or from built-in template)
- Save — downloads `.json` file
- Load — `<input type="file">` to load JSON
- Test — launches game with current level (switches to game mode)
- Validate — runs playability checks, shows errors

**Info Display**
- Hovered tile coordinates (x, y)
- Total dot count / power pellet count
- Validation status (green checkmark or red errors with coords)

---

## 5. Rendering

### `Draw.editorOverlay(state: EditorState): void`

New static method in `src/static/Draw.ts`:

```ts
static editorOverlay(state: EditorState, ctx: CanvasRenderingContext2D): void {
    // Grid lines (optional, toggled by state.showGrid)
    if (state.showGrid) {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        for (let x = 0; x <= gridW; x++) {
            ctx.beginPath();
            ctx.moveTo(x * unit, 0);
            ctx.lineTo(x * unit, gridH * unit);
            ctx.stroke();
        }
        for (let y = 0; y <= gridH; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * unit);
            ctx.lineTo(gridW * unit, y * unit);
            ctx.stroke();
        }
    }

    // Hovered cell highlight
    if (state.hoveredCell) {
        const { x, y } = state.hoveredCell;
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x * unit, y * unit, unit, unit);
    }

    // Spawn point markers (colored circles with labels)
    drawSpawnMarker(ctx, state.level.pacmanStart,       'yellow',  'P');
    drawSpawnMarker(ctx, state.level.ghostStarts.blinky, '#FF0000', 'B');
    drawSpawnMarker(ctx, state.level.ghostStarts.inky,   '#00FFFF', 'I');
    drawSpawnMarker(ctx, state.level.ghostStarts.pinky,  '#FFB8FF', 'Pi');
    drawSpawnMarker(ctx, state.level.ghostStarts.clyde,  '#FFB852', 'C');
    drawSpawnMarker(ctx, state.level.fruitSpawn,         '#FF6600', 'F');

    // Tunnel row highlight
    ctx.fillStyle = 'rgba(0,200,255,0.12)';
    ctx.fillRect(0, state.level.tunnelRow * unit, gridW * unit, unit);

    // Red zone tile markers
    for (const t of state.level.redZoneTiles) {
        ctx.fillStyle = 'rgba(255,0,0,0.25)';
        ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
    }

    // Ghost house door highlight
    const d = state.level.ghostHouseDoor;
    ctx.strokeStyle = 'rgba(255,180,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(d.x * unit + 1, d.y * unit + 1, unit - 2, unit - 2);
}
```

---

## 6. Wall Auto-Connection

The current `Draw.level()` renders walls using tile neighbor checks. When the editor modifies a tile:

- All 8 neighbors of the changed tile may need visual update
- If `Draw.level()` is purely functional (reads `levelDynamic` each frame), no change needed — re-rendering happens automatically
- If wall geometry is cached, add an `invalidateWallCache()` call on tile change

**Action**: Audit `Draw.level()` in `src/static/Draw.ts` to confirm it is stateless. If it is, no changes needed for wall rendering in the editor.

---

## 7. Serialization

### JSON Format

```json
{
  "version": 1,
  "name": "Custom Level 1",
  "tiles": [[0, 0, 0, ...], [0, 1, 1, ...], ...],
  "pacmanStart":  { "x": 14, "y": 26 },
  "ghostStarts": {
    "blinky": { "x": 14, "y": 14 },
    "inky":   { "x": 12, "y": 17 },
    "pinky":  { "x": 14, "y": 17 },
    "clyde":  { "x": 16, "y": 17 }
  },
  "fruitSpawn":     { "x": 14, "y": 20 },
  "tunnelRow":      17,
  "tunnelSlowColMax": 5,
  "tunnelSlowColMin": 22,
  "redZoneTiles": [
    { "x": 12, "y": 14 }, { "x": 15, "y": 14 },
    { "x": 12, "y": 26 }, { "x": 15, "y": 26 }
  ],
  "ghostHouseDoor": { "x": 14, "y": 15 },
  "scatterTargets": {
    "blinky": { "x": 27, "y": 0  },
    "inky":   { "x": 27, "y": 35 },
    "pinky":  { "x": 0,  "y": 0  },
    "clyde":  { "x": 0,  "y": 35 }
  }
}
```

### Save (`src/editor/Serialize.ts`)

```ts
export function saveLevel(data: LevelData): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name.replace(/\s+/g, '_') || 'level'}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export function loadLevelFromFile(file: File): Promise<LevelData> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target!.result as string) as LevelData;
                validateSchema(data); // throws on bad schema
                resolve(data);
            } catch (err) {
                reject(err);
            }
        };
        reader.readAsText(file);
    });
}
```

### LocalStorage Autosave

- Key: `pacman_editor_autosave`
- Save on every tile change (debounced 500ms)
- On editor load: restore from autosave if present, else use built-in level

---

## 8. Validation Rules (`src/editor/Validate.ts`)

Before allowing "Test" or marking as valid:

| # | Rule | Description |
|---|---|---|
| 1 | **Dot reachability** | BFS from Pac-Man start — all dots/power pellets must be reachable |
| 2 | **No isolated regions** | All passable tiles reachable from Pac-Man start |
| 3 | **Minimum dots** | At least 1 dot must exist (otherwise level immediately clears) |
| 4 | **Ghost house** | Exactly one ghost door tile; ghost house interior enclosed |
| 5 | **Ghost escape path** | Passable path exists from ghost house interior to main maze |
| 6 | **Spawn points on open tiles** | All 5 spawns (4 ghosts + Pac-Man) must be on `tileValue > 2` tiles |
| 7 | **Tunnel symmetry** | If tunnel row set, col 0 and col 27 must be open (warp exits) |
| 8 | **Grid dimensions** | Tile array must be exactly 36 rows × 28 columns |

```ts
export interface ValidationResult {
    valid: boolean;
    errors: Array<{
        rule: string;
        message: string;
        tiles?: { x: number; y: number }[];  // for highlight on canvas
    }>;
}

export function validateLevel(data: LevelData): ValidationResult { ... }
```

Display errors in the panel with affected tiles highlighted in red on canvas.

---

## 9. Integration with Game Loop

### `start()` changes (`src/Game.ts`)

```ts
// Accept optional LevelData; fall back to built-in level
function start(slots: PlayerSlot[], levelData?: LevelData): void {
    const level = levelData ?? builtInLevel;   // builtInLevel = refactored Levels.level1
    currentLevel = level;
    Levels.levelDynamic = level.tiles.map(row => [...row]);
    // use currentLevel.pacmanStart, .ghostStarts, .tunnelRow, etc. everywhere
    // instead of hardcoded constants
    ...
}
```

### `src/constants.ts` changes

- `TUNNEL_ROW`, `TUNNEL_SLOW_COL_MAX/MIN`, `RED_ZONE_TILES` remain as fallback defaults
- When a custom `LevelData` is active, game code reads from `currentLevel.*` instead

### `src/Levels.ts` changes

- Built-in level becomes a `LevelData` object:
  ```ts
  export const level1: LevelData = {
      version: 1,
      name: "Classic",
      tiles: [...],    // existing level1 array
      pacmanStart: { x: 14, y: 26 },
      ghostStarts: { blinky: {...}, inky: {...}, pinky: {...}, clyde: {...} },
      // ... all other constants
  };
  ```
- `Levels.levelDynamic` initialized as a copy of `level1.tiles`

### `src/Move.ts` changes

- Ghost scatter targets read from `currentLevel.scatterTargets`
- Tunnel slow-down reads from `currentLevel.tunnelSlowColMax/Min` and `currentLevel.tunnelRow`
- Red zone checks read from `currentLevel.redZoneTiles`

---

## 10. Editor Mode Lifecycle

```
window.onload + ?editor=true
    ↓
loadEditorState()          — initialize with built-in level; restore autosave if present
    ↓
editorLoop() [rAF]
    → Draw.level()          — renders tile grid (uses levelDynamic working copy)
    → Draw.editorOverlay()  — grid lines, spawn markers, hover highlight, zone overlays
    → HTML panel            — tool palette, actions, info
    ↓
User edits tiles / places spawns / adjusts tunnels
    ↓
User clicks "Test"
    ↓
validateLevel(editorState.level) → show errors or proceed
    ↓
start(singlePlayerSlots, editorState.level) — game starts with custom level
    ↓
On game exit (returningToMenu flag) → back to editorLoop()
                                       (new flag: returningToEditor)
```

---

## 11. Files to Create / Modify

| File | Action | Description |
|---|---|---|
| `src/editor/EditorState.ts` | **Create** | Editor state interface and initializer |
| `src/editor/EditorLoop.ts` | **Create** | rAF loop, canvas input handling, tool dispatch |
| `src/editor/Validate.ts` | **Create** | Level validation rules (BFS, schema checks) |
| `src/editor/Serialize.ts` | **Create** | Save/load JSON, LocalStorage autosave |
| `src/tiles.ts` | **Create** | Named tile value constants |
| `src/types.ts` | **Modify** | Add `LevelData` interface |
| `src/constants.ts` | **Modify** | Keep as defaults; note they're overridden by `LevelData` |
| `src/Levels.ts` | **Modify** | Wrap `level1` array + all spawn/tunnel/zone constants into `LevelData` |
| `src/Game.ts` | **Modify** | `start()` accepts optional `LevelData`; `?editor=true` entry; `returningToEditor` flag |
| `src/Move.ts` | **Modify** | Read tunnel/redzone/scatter from active `LevelData` |
| `src/static/Draw.ts` | **Modify** | Add `Draw.editorOverlay()` |
| `index.html` | **Modify** | Editor panel HTML (or dynamically created like debug panel) |

---

## 12. Phased Implementation

### Phase 1 — Foundation
- Define `LevelData` interface in `src/types.ts`
- Refactor built-in level: merge `Levels.level1` + all hardcoded spawn/tunnel/zone constants into a `LevelData` object
- Update `Game.ts`, `Move.ts`, etc. to read from `LevelData` instead of constants
- Verify game runs identically with refactored data (regression test: play through, check ghost AI, tunnels, scoring)

### Phase 2 — Basic Editor
- `?editor=true` entry point in `window.onload`
- Editor rAF loop (`EditorLoop.ts`)
- Tile paint/erase with mouse and touch
- Grid overlay, hover highlight
- Undo/redo (snapshot-based)

### Phase 3 — Spawn & Special Tiles
- Spawn point placement tools (click to reposition)
- Ghost house door placement
- Tunnel row/column configuration
- Red zone tile toggle

### Phase 4 — Validation & Testing
- BFS reachability checks (`Validate.ts`)
- Validation panel with error list and canvas highlight
- "Test" button: validate → launch game with editor level
- `returningToEditor` flag routes game exit back to editor

### Phase 5 — Save/Load
- JSON export (file download)
- JSON import (`<input type="file">`)
- LocalStorage autosave (debounced)
- Level name field

### Phase 6 — Polish
- Flood fill tool
- Copy/paste rectangular regions
- Multiple saved levels (localStorage list)
- Keyboard shortcuts cheatsheet overlay
