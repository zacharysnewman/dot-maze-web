# MAP-EDITOR.md — Level Editor

## Overview

A browser-based tile editor overlaid on the game canvas, accessible via `?editor=true`. Supports designing, saving, loading, and play-testing custom dot-maze levels. All changes are auto-saved and levels can be stored in a persistent in-browser library.

---

## Accessing the Editor

```
http://localhost:PORT/?editor=true
```

On load the editor restores the last auto-saved session. If no autosave exists it starts from the built-in Classic level.

---

## Features

### What a tile can hold

A level is three independent layers. Within a layer, one thing per tile — the
layers never mix.

| Layer | Contents | Rule |
|---|---|---|
| **Tiles** (`tiles[y][x]`) | Wall, Empty, Dot, Power, Ghost door | Exactly one value per tile. Painting replaces what was there. |
| **Zones** (coordinate lists) | Red zone, Slow tile | At most one zone per tile. Painting one displaces the other. |
| **Objects** (coordinates) | Player, 4 ghost starts, fruit, 4 scatter targets | One object per tile. A drop onto an occupied tile is refused. |

Zones and objects sit *on top of* a tile, so a dot can be a red zone, and a
ghost can start on a slow tile — the built-in level itself puts two of its four
red zones on dot tiles. What cannot happen is two of the same layer on one tile.

An object on a half-tile (`x.5`) straddles two columns and holds both, which is
how it is drawn and how collisions are judged.

Clicking an object always picks it up, even while holding another one — with one
object to a tile, a click there could never have been a placement, so the editor
says which object it grabbed instead.

### The tile set (budgets)

Every placeable thing has a budget, so a custom map can be held to the same
stock as the main map instead of drifting into something unplayable. Budgets
are an **editor-side constraint only** — the saved JSON, the level format and
the game logic are untouched.

| Tile set | Dots | Power | Ghost doors | Red zones | Slow tiles | Walls / Empty |
|---|---|---|---|---|---|---|
| **Classic** (default) | 240 | 4 | 2 | ∞ | ∞ | ∞ |
| **Extended** | 360 | 8 | 4 | ∞ | ∞ | ∞ |
| **Sandbox** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |

Zones and tunnel rows are a design choice rather than a stock of pieces, so
they are counted but never capped.

- Classic's numbers are read from the built-in map at startup, so they cannot
  drift out of sync with it.
- A budget of `-1` (`INFINITE`, shown as `∞`) means unlimited.
- The **Tile set** section shows a live `used / budget` bar per kind, and each
  palette entry shows how many are left.
- Painting past a budget is refused and explains itself in a toast; erasing
  hands the budget back. Flood fill places as many as the budget allows.
- The tile set is remembered per person (`editor_prefs`) and stored alongside
  library entries, so re-opening a map restores the set it was authored under.
- Validation reports anything over budget — e.g. after importing a level built
  under a roomier set.

### Objects — one of each

Spawns and scatter targets are single movable objects, not paintable tiles.
There is exactly one of each and it can never be duplicated or deleted:

| Object | What it is |
|---|---|
| **P Player** | Where the player starts each life |
| **R / C / H / O** | The four ghost starting points |
| **F Fruit** | Where bonus fruit appears |
| **✕ ×4** | Each ghost's scatter-mode corner target |

With the **✥ Move objects** tool you drag any of them straight on the maze.
Clicking an object in the **Objects** list arms it — the next tap on the maze
places it — and arrow keys nudge the armed object one tile at a time. The list
shows each object's live coordinates. **Drop on half-tile** places on `x.5`
(the Classic player and red ghost sit on half-tiles).

The ghost-house gate is a **tile** now (budget 2 in Classic), painted like any
other. The level's `enemyHouseDoor` coordinate is kept in sync automatically,
so the saved JSON is unchanged.

### Tile Painting

| Tool | How to use | Key |
|---|---|---|
| **Paint** | Click/drag the canvas to place the selected tile | `B` |
| **Erase** | Click/drag to set tiles to Empty | `E` |
| **Flood Fill** | Click any tile to BFS-fill all contiguous matching tiles | `F` |
| **Move objects** | Drag spawns and scatter targets | `M` |
| **Red zone** | Click/drag to toggle junctions where ghosts can't turn up | `R` |
| **Slow tiles** | Click/drag to toggle tiles where enemies crawl | `S` |

**Erase** clears whatever is on a tile — the tile itself *and* any zone on it.
Tapping a marked tile with its own zone tool also removes just that zone.

**Wrapping is not something you place.** A row wraps wherever both of its end
tiles are walkable — open an edge and the tunnel appears, wall one up and it is
gone. That is what the game always did: the teleport in `Move.moveObject` fires
when a walkable tile sits at the grid edge. A level used to *also* declare its
tunnel rows, which could disagree with the tiles; it does not any more, and old
levels drop the field on load.

The editor draws the wrap points it finds, and the Zones tab lists the rows that
wrap. Validation warns about a row open at one edge only, which is a dead end
rather than a tunnel.

**Slow tiles** are the warp-tunnel mouths, where enemies move at a crawl. They
are per-tile, like red zones: paint them anywhere, in any shape, not just on the
tunnel row. The built-in level marks the same twelve tiles the old
`tunnelSlowColMax` / `tunnelSlowColMin` column bounds described (row 17, columns
0–5 and 22–27), so the game plays exactly as before. Levels saved with the old
column fields are converted on load.

Tile types in the palette:

| Swatch | Value | Meaning | Key |
|---|---|---|---|
| Wall | `0` | Solid — players and enemies cannot pass | `1` |
| Empty | `5` | Open corridor, no collectible | `2` |
| Dot  | `3` | Small pellet — counts toward level clear | `3` |
| Power | `4` | Power pellet — triggers frightened mode | `4` |
| Ghost Door | `2` | Ghost-house gate — only entering/exiting ghosts pass | `5` |

**Brush size** paints 1×1, 2×2 or 3×3 at once (`[` and `]`).

### Mirror painting

Symmetric mazes take a quarter of the clicks. `X` cycles the modes; the mirrored
axes are drawn on the canvas as dashed guides, and the hover preview shows every
tile a stroke will touch.

| Mode | Also paints |
|---|---|
| **· Off** | nothing else |
| **⇔ L/R** | the matching column on the other side |
| **⇕ T/B** | the matching row on the other side |
| **⤢ Diag** | the tile opposite through the centre |
| **⊞ All 4** | all four quadrants at once |

The grid is 28 × 36 — not square — so a corner-to-corner diagonal reflection has
nowhere to land; **Diag** mirrors through the centre point (a 180° rotation),
which is the diagonal symmetry a rectangular maze can hold. Mirroring applies to
red-zone toggling too, and every mirrored tile draws from the same budget.

### Canvas overlay

- **Map bounds** — a white rectangle around the whole 28 × 36 grid, with a
  dashed line marking the paintable area inside it.
- **Reserved rows** — the rows the HUD covers are hatched, washed and labelled
  *NOT PAINTABLE*: rows 0–1 (`SCORE`) and row 35 (`LIVES`). Tiles and zones are
  refused there. Columns are never clipped — the tunnel has to wrap through
  columns 0 and 27. Movable objects are exempt, so scatter targets can still sit
  in those rows; the built-in level parks two of them on row 0.
- **Grid** — guide lines, toggled from the toolbar or with `G`.
- **Tunnel** — cyan boxes with outward arrows on the tiles that wrap, on every
  row that has walkable tiles at both ends, with a dashed centre line marking
  the row; amber tint on the slow tiles. Selecting the tunnel tool lights up the whole row, since that is what
  a click is about to change.
- Red-zone tint, ghost-door outlines, mirror guides.
- Object markers, with a dashed ring around the armed one.
- Hover preview of the exact cells the brush will paint.

Walls, dots and the ghost-house gate are drawn from the level being edited, so
the maze on screen is always the maze you are painting.

### Undo / Redo

Snapshot-based, up to 50 steps; `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`). One
stroke is one step, and a stroke that changes nothing does not push a step.

## Validation

Click **✔ Validate** to run all checks. Results appear inline in the panel.

| # | Rule |
|---|---|
| 1 | Grid must be exactly 36 rows × 28 columns |
| 2 | At least one dot or power pellet must exist |
| 3 | Player spawn must be on a walkable tile (value > 0) |
| 4 | All enemy spawns must be on walkable tiles |
| 5 | Fruit spawn should be on a walkable tile (warning only) |
| 6 | A row open at one edge only is a dead end, not a tunnel (warning only) |
| 7 | Slow tiles must not sit on walls, where no enemy can reach them (warning only) |
| 8 | BFS reachability — all dots must be reachable from player spawn (respects tunnel wrapping) |
| 9 | Level name should not be empty (warning only) |
| 10 | Nothing may exceed the current tile set's budget |
| 11 | Ghost door tiles and power pellets should exist (warnings only) |
| 12 | Pellets outside rows 2–34, hidden under the HUD (warning only) |
| 13 | A tile marked as both a red zone and a slow tile (warning only) |
| 14 | Two objects sharing a tile (warning only) |

**✔ Validate** puts its verdict where it can be seen: a headline in the Level
tab — green with the dot counts, or red with the number of problems — the detail
listed beneath it, and a toast naming the first problem for whoever is looking
at the maze rather than the panel.

**▶ Test level** runs the same checks first and refuses to launch on errors,
opening the Level tab and naming the first one rather than pointing vaguely at
the panel.

---

## Play-Testing

**▶ Test level** validates first, then launches a live game session with the
current editor level (1-player keyboard/gamepad/touch). A **✕ Exit test** button
sits in the corner throughout — the only way back on a phone, where there is no
Escape key. `Escape` does the same on a keyboard, and game-over returns to the
editor on its own.

The button sits in the letterboxing beside the maze rather than over it, and
keeps its taps away from the game's swipe handling, which listens on
`document`.

While a test owns the canvas the editor's own canvas input is inert, so a swipe
aimed at the game cannot paint tiles into the level being played.

---

## Level Library (Multi-Map)

All maps are stored persistently in `localStorage` under the key `editor_library`.

| Button | Effect |
|---|---|
| **💾 Save to library** | Saves/updates the current level, along with the tile set it was authored under. Re-saving overwrites the same entry (by ID). Requires a non-empty level name. |
| **📂 My maps (n)** | Opens the library browser modal showing all saved levels. |

### Library Modal

Each entry shows:
- **Level name** and last-saved timestamp
- **Dot and power-pellet counts**
- **📂 Load** — loads the level into the editor (pushes undo)
- **▶ Test** — validates and launches a test game directly from the library
- **🗑 Delete** — removes the entry (with confirmation)

---

## Save / Load Files

| Button | Effect |
|---|---|
| **⬇ Export** | Downloads the current level as a `.json` file |
| **⬆ Import** | Opens a file picker to load a `.json` level file into the editor |
| **↺ Reset** | Resets to the built-in Classic level (with confirmation) |

### JSON Format

```json
{
  "version": 1,
  "name": "My Level",
  "tiles": [[0, 0, ...], ...],
  "playerStart": { "x": 13.5, "y": 26 },
  "enemyStarts": {
    "redEnemy":     { "x": 13.5, "y": 14 },
    "cyanEnemy":    { "x": 12,   "y": 17 },
    "hotpinkEnemy": { "x": 13.5, "y": 17 },
    "orangeEnemy":  { "x": 15,   "y": 17 }
  },
  "fruitSpawn":       { "x": 13, "y": 20 },
  "tunnelSlowTiles": [
    { "x": 0, "y": 17 }, { "x": 1, "y": 17 }, { "x": 2, "y": 17 },
    { "x": 3, "y": 17 }, { "x": 4, "y": 17 }, { "x": 5, "y": 17 },
    { "x": 22, "y": 17 }, { "x": 23, "y": 17 }, { "x": 24, "y": 17 },
    { "x": 25, "y": 17 }, { "x": 26, "y": 17 }, { "x": 27, "y": 17 }
  ],
  "redZoneTiles": [
    { "x": 12, "y": 14 }, { "x": 15, "y": 14 },
    { "x": 12, "y": 26 }, { "x": 15, "y": 26 }
  ],
  "enemyHouseDoor": { "x": 14, "y": 15 },
  "scatterTargets": {
    "redEnemy":     { "x": 26, "y": 0  },
    "cyanEnemy":    { "x": 27, "y": 34 },
    "hotpinkEnemy": { "x": 2,  "y": 0  },
    "orangeEnemy":  { "x": 0,  "y": 34 }
  }
}
```

`enemyHouseDoor` is derived from the painted ghost-door tiles rather than placed
separately, but it is still written out exactly as before.

`tunnelSlowTiles` replaces the older `tunnelSlowColMax` / `tunnelSlowColMin`
pair. `tunnelRow`, and the `tunnelRows` list that briefly replaced it, are gone —
where a maze wraps is read from the tiles.
A level file carrying the old fields is converted on load
(`src/editor/LevelMigrate.ts`) into the tiles those bounds covered, so nothing
saved by an earlier version loses its slow zones.

---

## Auto-Save

The editor auto-saves to `localStorage` key `editor_autosave` within 500 ms of any change (debounced). This is separate from the library — it is a single scratch-pad slot that restores the last working state on page reload.

Editor settings (tile set, brush size, mirror mode, grid, half-tile drops) live
separately under `editor_prefs`; they follow the person, not the level.

---

## Panel Layout

The panel is a toolbar, not a long scrolling column. It has three fixed parts
and one that changes:

| Part | Contents |
|---|---|
| **Action bar** (always visible) | Hide · Undo · Redo · Grid · a status line |
| **Tab strip** | Paint · Brush · Objects · Zones · Level · More |
| **Tab body** | Only the selected section — sized so it does not scroll |
| **Test level** | Pinned below the body, reachable from every tab |

Undo, redo and Test never move, so they work whichever section is open. The
bar's buttons carry words wherever they fit — across a wide sheet, or wrapped
onto a second row in a tall side panel — and fall back to icons with tooltips
only in a short side panel. **Hide** (`⌄` / `›`) points the way the panel goes;
**Grid** (`⊞`) toggles the tile grid.

The status line says what a click on the maze would do right now — "Paint Dot",
"Place Fruit", "Slow tiles" — and switches to the tile under the pointer while
hovering, naming each layer on it.
Choosing a tool from the keyboard brings its section forward: `S` opens Zones
with Slow tiles selected, `3` opens Paint with Dot selected.

Controls sit in grids that reflow to the available width — four columns on a
phone in portrait, two in the side panel — instead of one control per row.
Readouts (validation results, budget bars, the shortcut list) take whatever
space is left and scroll on their own if there is not enough; controls never do.

### Docking, and why the maze stays full size

The maze is sized first; the panel takes the space the maze cannot use.

| Screen | Dock | Maze |
|---|---|---|
| ≥ 880 px wide | Side panel, 268 px | Full height — the maze never reaches the panel |
| Landscape phone | Side panel — a bottom sheet would be two rows tall | Full height |
| Portrait phone | Bottom sheet, sized to the leftover band | Full width |

The maze is 28 × 36, far squarer than a phone screen, so fitting it to the
width of a portrait phone leaves a deep band at the bottom — which is exactly
where the sheet goes. On a 390 × 844 phone that is a 344 px sheet under a maze
at 100 % of the size it could reach with no panel at all. Desktop, laptop and
landscape phones are likewise 100 %.

The maze only gives way when the leftover band cannot hold a row of controls
(under 280 px): a 360 × 640 phone lands at 78 %, a 820 × 1180 tablet at 85 %.
Overlaying the panel would keep those at 100 % but hide half the maze behind
it, which is worse for editing than a slightly smaller maze.

Sizing measures the **visual viewport** — the area actually on screen — rather
than `window.innerWidth/innerHeight`, which describe the layout viewport and on
mobile can be larger than the screen while the URL bar slides or the page is
pinched; measuring those renders the maze wider than the screen, clipped at both
edges. The layout is re-checked each frame and on `visualViewport` resize and
scroll, since iOS reports URL-bar changes only through those. It is skipped
while a panel field has focus, so an on-screen keyboard does not resize the maze
mid-word. **Hide** (`✕`, or `H`) collapses the
panel to a floating ✏ button and gives the maze the whole screen.

## Accessibility

- Tap targets are at least 44 px (46 px on touch devices, 40 px only on short
  screens), and inputs are 16 px so iOS does not zoom on focus.
- The tab strip is a `tablist` of `tab` buttons controlling `tabpanel`s;
  controls carry `aria-pressed` / `aria-checked`; the palette and mirror modes
  are `radiogroup`s.
- Validation output and toasts are `aria-live` regions, and focus rings are
  visible throughout.
- Objects can be placed without a pointer: select one, then nudge it with the
  arrow keys.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `1`–`5` | Pick a tile (wall, empty, dot, power, ghost door) |
| `B` / `E` / `F` | Paint / Erase / Fill |
| `M` | Move objects |
| `R` / `S` / `T` | Red zone / Slow tiles / Tunnel row |
| `[` / `]` | Brush size down / up |
| `X` | Cycle mirror mode |
| `G` | Toggle grid (also a toolbar button) |
| `H` | Hide / show the panel |
| Arrow keys | Nudge the armed object one tile |
| `Esc` | Drop the armed object |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Escape` (during test) | Return to editor |

---

## Architecture

### Files

| File | Purpose |
|---|---|
| `src/editor/EditorState.ts` | State interface, undo/redo, live usage counts, deep-copy helpers |
| `src/editor/EditorLoop.ts` | rAF loop, canvas input, tool dispatch, panel UI, library modal |
| `src/editor/TileSet.ts` | Placeable kinds, movable objects, tile sets and budgets |
| `src/editor/Mirror.ts` | Mirror modes and the tiles each stroke echoes to |
| `src/editor/Bounds.ts` | Which tiles may be painted (rows the HUD covers are locked) |
| `src/editor/LevelMigrate.ts` | Brings level JSON from older versions up to date |
| `src/editor/EditorPrefs.ts` | Per-person settings (tile set, brush, mirror, grid) |
| `src/editor/Validate.ts` | BFS reachability, budgets and all validation rules |
| `src/editor/LevelLibrary.ts` | localStorage multi-map library (CRUD) |

### Data Flow

```
?editor=true
    ↓
startEditorMode()          ← loads autosave or level1Data
    ↓
editorLoop() [rAF]
    → Draw.level()          ← reads Levels.levelDynamic each frame
    → drawEditorOverlay()   ← grid, spawn markers, tunnel highlight, scatter targets
    ↓
User edits → applyToolDown/Drag → Levels.levelDynamic updated live
    ↓
Save to Library → LevelLibrary.saveLevel()    (localStorage array)
Browse My Maps  → openLibraryModal()          (load / test / delete each entry)
Export          → JSON file download
Import          → JSON file picker → pushUndo → Object.assign(state.level, …)
    ↓
▶ Test Level → validateLevel → startTestGame(level, onReturn)
    → Game runs with custom level (1-player, full game loop)
    → ESC or game-over → onReturn() → editor panel rebuilt, rAF restarted
```

### LevelData Interface (`src/types.ts`)

```typescript
interface LevelData {
    version: number;
    name: string;
    tiles: TileValue[][];           // 36 rows × 28 cols; TileValue = 0|2|3|4|5
    playerStart: { x: number; y: number };
    enemyStarts: {
        redEnemy:     { x: number; y: number };
        cyanEnemy:    { x: number; y: number };
        hotpinkEnemy: { x: number; y: number };
        orangeEnemy:  { x: number; y: number };
    };
    fruitSpawn:       { x: number; y: number };
    tunnelSlowTiles:  { x: number; y: number }[];
    redZoneTiles:     { x: number; y: number }[];
    enemyHouseDoor:   { x: number; y: number };
    scatterTargets: {
        redEnemy:     { x: number; y: number };
        cyanEnemy:    { x: number; y: number };
        hotpinkEnemy: { x: number; y: number };
        orangeEnemy:  { x: number; y: number };
    };
}
```

---

## Implementation Status

| Feature | Status |
|---|---|
| Tile sets with per-tile budgets (`-1` = infinite) | ✅ Complete |
| Dots / power / doors / red zones capped to main-map counts | ✅ Complete |
| Spawns and scatter targets as single movable objects | ✅ Complete |
| Drag-to-move, arm-and-place, arrow-key nudging | ✅ Complete |
| Brush sizes and 4-way mirror painting | ✅ Complete |
| Map bounds rectangle, HUD rows locked, faint grid | ✅ Complete |
| Slow tunnel as paintable tiles (`tunnelSlowTiles`) | ✅ Complete |
| Wrapping derived from the tiles, on any number of rows | ✅ Complete |
| Erase clears zones as well as tiles | ✅ Complete |
| One zone per tile, one object per tile | ✅ Complete |
| Tabbed toolbar — every control reachable without scrolling | ✅ Complete |
| Maze at full size, panel in the space it cannot use | ✅ Complete |
| HUD rows blocked and marked, full-grid boundary | ✅ Complete |
| Maze rendered from the level being edited | ✅ Complete |
| Mobile bottom-sheet layout, 44 px+ targets, ARIA state | ✅ Complete |
| Tile paint / erase / flood fill | ✅ Complete |
| Undo / redo (50 steps) | ✅ Complete |
| Grid overlay + brush-footprint hover preview | ✅ Complete |
| Spawn placement (Player, 4 enemies, Fruit) | ✅ Complete |
| Ghost house door as a budgeted tile | ✅ Complete |
| Tunnel row configuration | ✅ Complete |
| Red zone tile toggle | ✅ Complete |
| Scatter target placement (per enemy) | ✅ Complete |
| Level name input | ✅ Complete |
| Validation (BFS + all rules) | ✅ Complete |
| Play-test with ESC-to-return | ✅ Complete |
| Auto-save (debounced 500 ms) | ✅ Complete |
| Auto-restore on page reload | ✅ Complete |
| JSON export (file download) | ✅ Complete |
| JSON import (file picker) | ✅ Complete |
| Reset to built-in level | ✅ Complete |
| Multi-map library (localStorage) | ✅ Complete |
| Library modal (Load / Test / Delete) | ✅ Complete |
| Touch / mobile input | ✅ Complete |
| Keyboard shortcuts (Ctrl+Z/Y) | ✅ Complete |
