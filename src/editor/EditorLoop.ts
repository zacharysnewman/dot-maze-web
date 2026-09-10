import { unit, gridW, gridH } from '../constants';
import { gameState } from '../game-state';
import { Levels } from '../static/Levels';
import { Draw } from '../static/Draw';
import { exitTestGame, startTestGame, viewportSize } from '../Game';
import type { LevelData, TileValue } from '../types';
import { TILE_EMPTY, TILE_GHOST_DOOR } from '../tiles';
import { validateLevel, type ValidationResult } from './Validate';
import { saveLevel, listLevels, deleteLevel, formatDate } from './LevelLibrary';
import { loadPrefs, savePrefs } from './EditorPrefs';
import {
    EDIT_MAX_Y,
    EDIT_MIN_Y,
    RESERVED_ROWS_HINT,
    isEditableTile,
    isReservedRow,
} from './Bounds';
import { MIRROR_MODES, mirrorModeDef, mirrorPartners, nextMirrorMode, type MirrorMode } from './Mirror';
import {
    BUDGET_ROWS,
    MARKER_KINDS,
    TILE_KINDS,
    TILE_SETS,
    countUsage,
    formatBudget,
    isInfinite,
    markerAtTile,
    markerById,
    remainingOf,
    tileKindOfValue,
    ZONE_KINDS,
    zoneAtTile,
    zoneKindById,
    type BudgetKey,
    type MarkerKindId,
    type ZoneKindId,
} from './TileSet';
import { migrateLevel } from './LevelMigrate';
import {
    activeTileSet,
    createEditorState,
    deepCopyLevel,
    pushUndo,
    recountUsage,
    redo,
    undo,
    type EditorState,
    type EditorTool,
} from './EditorState';

// ── Autosave ──────────────────────────────────────────────────────────────────

const AUTOSAVE_KEY = 'editor_autosave';
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(level: LevelData): void {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(level));
        } catch {
            // ignore quota errors
        }
    }, 500);
}

function loadAutosave(): LevelData | null {
    try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        if (!raw) return null;
        return migrateLevel(JSON.parse(raw) as LevelData);
    } catch {
        return null;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tileFromCanvas(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = gameState.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const tx = Math.floor((clientX - rect.left) * scaleX / unit);
    const ty = Math.floor((clientY - rect.top)  * scaleY / unit);
    if (tx < 0 || tx >= gridW || ty < 0 || ty >= gridH) return null;
    return { x: tx, y: ty };
}

/** Point the renderer at the level being edited (walls read levelSetup). */
function syncToRenderer(state: EditorState): void {
    gameState.currentLevel = state.level;
    Levels.levelSetup   = state.level.tiles;
    Levels.levelDynamic = state.level.tiles.map(row => [...row] as TileValue[]);
}

/**
 * Keep the level's `enemyHouseDoor` coordinate pointing at the painted gate.
 * The gate is a tile now, so the coordinate is bookkeeping rather than a
 * separate thing to place.
 */
function syncDoorMarker(level: LevelData): void {
    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            if (level.tiles[y][x] === TILE_GHOST_DOOR) {
                level.enemyHouseDoor = { x, y };
                return;
            }
        }
    }
}

// ── Toast / status ────────────────────────────────────────────────────────────

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'ed-toast';
        toastEl.setAttribute('role', 'status');
        toastEl.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('ed-toast-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl?.classList.remove('ed-toast-show'), 2200);
}

// ── Budget-aware tile writing ─────────────────────────────────────────────────

type WriteResult = 'ok' | 'nochange' | 'blocked';

function writeTile(state: EditorState, x: number, y: number, value: TileValue): WriteResult {
    const previous = state.level.tiles[y][x];
    if (previous === value) return 'nochange';

    const kind = tileKindOfValue(value);
    if (remainingOf(activeTileSet(state), state.usage, kind.id) <= 0) return 'blocked';

    state.level.tiles[y][x] = value;
    Levels.levelDynamic[y][x] = value;
    state.usage[tileKindOfValue(previous).id]--;
    state.usage[kind.id]++;
    return 'ok';
}

function budgetToast(state: EditorState, key: BudgetKey): void {
    const tileSet = activeTileSet(state);
    const label = BUDGET_ROWS.find(row => row.key === key)?.label ?? key;
    showToast(
        `No ${label.toLowerCase()} left (${formatBudget(state.usage[key], tileSet.budgets[key])}) ` +
        `— erase some, or pick a roomier tile set`,
    );
}

/** Paint a set of cells, stopping at the tile set's budget. */
function paintCells(state: EditorState, cells: Array<{ x: number; y: number }>, value: TileValue): boolean {
    const kind = tileKindOfValue(value);
    let placed = 0;
    let blocked = 0;
    for (const { x, y } of cells) {
        const result = writeTile(state, x, y, value);
        if (result === 'ok')      placed++;
        if (result === 'blocked') blocked++;
    }
    if (blocked > 0) budgetToast(state, kind.id);
    if (placed > 0) syncDoorMarker(state.level);
    return placed > 0;
}

/** Cells the brush covers, including the mirrored side when mirroring is on. */
function brushCells(state: EditorState, cell: { x: number; y: number }): Array<{ x: number; y: number }> {
    const size = state.prefs.brushSize;
    const start = -Math.floor((size - 1) / 2);
    const cells: Array<{ x: number; y: number }> = [];
    const seen = new Set<string>();

    const add = (x: number, y: number): void => {
        if (!isEditableTile(x, y)) return;
        const key = `${x},${y}`;
        if (seen.has(key)) return;
        seen.add(key);
        cells.push({ x, y });
    };

    for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
            const x = cell.x + start + dx;
            const y = cell.y + start + dy;
            add(x, y);
            for (const partner of mirrorPartners(state.prefs.mirrorMode, x, y)) {
                add(partner.x, partner.y);
            }
        }
    }
    return cells;
}

// ── Flood Fill (BFS) ──────────────────────────────────────────────────────────

function floodFill(state: EditorState, startX: number, startY: number): boolean {
    const targetValue = state.level.tiles[startY][startX];
    const fillValue: TileValue = state.selectedTool === 'erase'
        ? TILE_EMPTY as TileValue
        : state.selectedTileValue;
    if (targetValue === fillValue) return false;

    const region: Array<{ x: number; y: number }> = [];
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const { x, y } = queue.shift()!;
        const key = `${x},${y}`;
        if (visited.has(key)) continue;
        if (!isEditableTile(x, y)) continue;
        if (state.level.tiles[y][x] !== targetValue) continue;
        visited.add(key);
        region.push({ x, y });
        queue.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 });
    }

    return paintCells(state, region, fillValue);
}

// ── Tool Application ──────────────────────────────────────────────────────────

let isPainting = false;
let zoneDragMode: 'add' | 'remove' | null = null;
const zoneDragSeen = new Set<string>();

/** Snapshot taken at pointer-down, pushed onto the undo stack only if the stroke changes something. */
let pendingUndo: LevelData | null = null;

function beginStroke(state: EditorState): void {
    pendingUndo = deepCopyLevel(state.level);
}

function noteChange(state: EditorState): void {
    if (pendingUndo) {
        state.undoStack.push(pendingUndo);
        state.redoStack = [];
        if (state.undoStack.length > 50) state.undoStack.shift();
        state.isDirty = true;
        pendingUndo = null;
    }
    state.uiDirty = true;
    scheduleAutosave(state.level);
}

/** Where a movable object lands when dropped on a cell. */
function markerDropPos(state: EditorState, cell: { x: number; y: number }): { x: number; y: number } {
    return { x: cell.x + (state.prefs.halfTileX ? 0.5 : 0), y: cell.y };
}

function moveMarker(
    state: EditorState,
    id: MarkerKindId,
    cell: { x: number; y: number },
    notify = true,
): boolean {
    const marker = markerById(id);
    const next = markerDropPos(state, cell);
    const current = marker.get(state.level);
    if (current.x === next.x && current.y === next.y) return false;

    // One object per tile. Silent while dragging, so sweeping across an
    // occupied tile does not spam the toast.
    const occupant = markerAtTile(state.level, cell.x, cell.y, id);
    if (occupant) {
        if (notify) showToast(`${occupant.label} is already on that tile`);
        return false;
    }

    marker.set(state.level, next);
    return true;
}

function toggleZone(
    state: EditorState,
    zone: ZoneKindId,
    cells: Array<{ x: number; y: number }>,
    mode: 'add' | 'remove',
): boolean {
    const tileSet = activeTileSet(state);
    const list = zoneKindById(zone).tiles(state.level);
    let changed = false;
    let blocked = false;
    for (const { x, y } of cells) {
        const idx = list.findIndex(t => t.x === x && t.y === y);
        if (mode === 'remove') {
            if (idx < 0) continue;
            list.splice(idx, 1);
            state.usage[zone]--;
            changed = true;
        } else {
            if (idx >= 0) continue;
            if (remainingOf(tileSet, state.usage, zone) <= 0) { blocked = true; continue; }
            // A tile carries at most one zone, so the new one displaces any other.
            clearZonesAt(state, x, y, zone);
            list.push({ x, y });
            state.usage[zone]++;
            changed = true;
        }
    }
    if (blocked) budgetToast(state, zone);
    return changed;
}

/**
 * Drop the zones on a tile, optionally sparing one. Used both to keep a tile to
 * a single zone and to let the erase brush clear zones along with tiles.
 */
function clearZonesAt(state: EditorState, x: number, y: number, keep?: ZoneKindId): boolean {
    let changed = false;
    for (const zone of ZONE_KINDS) {
        if (zone.id === keep) continue;
        const list = zone.tiles(state.level);
        const idx = list.findIndex(t => t.x === x && t.y === y);
        if (idx >= 0) {
            list.splice(idx, 1);
            state.usage[zone.id]--;
            changed = true;
        }
    }
    return changed;
}

/** Erase clears whatever is on a tile, zones included. */
function eraseCells(state: EditorState, cells: Array<{ x: number; y: number }>): boolean {
    const painted = paintCells(state, cells, TILE_EMPTY as TileValue);
    let zonesCleared = false;
    for (const { x, y } of cells) {
        if (clearZonesAt(state, x, y)) zonesCleared = true;
    }
    return painted || zonesCleared;
}

/** The zone a zone-painting tool edits. */
function zoneForTool(tool: EditorTool): ZoneKindId | null {
    if (tool === 'red_zone')  return 'red_zone';
    if (tool === 'slow_zone') return 'slow_zone';
    return null;
}

/** Tools that write into the grid; the move tool is exempt. */
function toolWritesTiles(tool: EditorTool): boolean {
    return tool === 'paint' || tool === 'erase' || tool === 'fill'
        || tool === 'red_zone' || tool === 'slow_zone';
}

function applyToolDown(state: EditorState, cell: { x: number; y: number }): boolean {
    const { x, y } = cell;
    if (toolWritesTiles(state.selectedTool) && isReservedRow(y)) {
        showToast(RESERVED_ROWS_HINT);
        return false;
    }
    switch (state.selectedTool) {
        case 'paint':
            return paintCells(state, brushCells(state, cell), state.selectedTileValue);
        case 'erase':
            return eraseCells(state, brushCells(state, cell));
        case 'fill':
            return floodFill(state, x, y);
        case 'move': {
            const grabbed = markerAtTile(state.level, x, y);
            if (grabbed) {
                // Pick it up where it stands — dragging moves it from here.
                // With one object to a tile, holding something else and
                // clicking here cannot be a placement, so say what happened.
                if (state.armedMarker && state.armedMarker !== grabbed.id) {
                    showToast(`${grabbed.label} is on that tile — picked it up instead`);
                }
                state.draggingMarker = grabbed.id;
                state.armedMarker = grabbed.id;
                state.uiDirty = true;
                return false;
            }
            if (state.armedMarker) {
                state.draggingMarker = state.armedMarker;
                return moveMarker(state, state.armedMarker, cell);
            }
            showToast('Pick an object in the Objects list, then tap the maze to place it');
            return false;
        }
        case 'red_zone':
        case 'slow_zone': {
            const zone = zoneForTool(state.selectedTool)!;
            const exists = zoneKindById(zone).tiles(state.level).some(t => t.x === x && t.y === y);
            zoneDragMode = exists ? 'remove' : 'add';
            const cells = [cell, ...mirrorPartners(state.prefs.mirrorMode, x, y)];
            for (const c of cells) zoneDragSeen.add(`${c.x},${c.y}`);
            return toggleZone(state, zone, cells, zoneDragMode);
        }
    }
}

function applyToolDrag(state: EditorState, cell: { x: number; y: number }): boolean {
    const { x, y } = cell;
    if (toolWritesTiles(state.selectedTool) && isReservedRow(y)) return false;
    switch (state.selectedTool) {
        case 'paint':
            return paintCells(state, brushCells(state, cell), state.selectedTileValue);
        case 'erase':
            return eraseCells(state, brushCells(state, cell));
        case 'move':
            return state.draggingMarker
                ? moveMarker(state, state.draggingMarker, cell, false)
                : false;
        case 'red_zone':
        case 'slow_zone': {
            if (!zoneDragMode) return false;
            const zone = zoneForTool(state.selectedTool)!;
            const cells = [cell, ...mirrorPartners(state.prefs.mirrorMode, x, y)]
                .filter(c => !zoneDragSeen.has(`${c.x},${c.y}`));
            if (cells.length === 0) return false;
            for (const c of cells) zoneDragSeen.add(`${c.x},${c.y}`);
            return toggleZone(state, zone, cells, zoneDragMode);
        }
        case 'fill':
            return false;
    }
}

// ── Overlay Rendering ─────────────────────────────────────────────────────────

function drawSpawnMarker(
    ctx: CanvasRenderingContext2D,
    pos: { x: number; y: number },
    color: string,
    label: string,
    highlight: boolean,
): void {
    const px = (pos.x + 0.5) * unit;
    const py = (pos.y + 0.5) * unit;
    const r  = unit * 0.38;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = color + '55';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (highlight) {
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(unit * 0.38)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px, py);
    ctx.restore();
}

function drawCrossMarker(
    ctx: CanvasRenderingContext2D,
    pos: { x: number; y: number },
    color: string,
    highlight: boolean,
): void {
    const px = (pos.x + 0.5) * unit;
    const py = (pos.y + 0.5) * unit;
    const r = unit * 0.35;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r);
    ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r);
    ctx.stroke();
    if (highlight) {
        ctx.strokeStyle = 'white';
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(px - r - 3, py - r - 3, (r + 3) * 2, (r + 3) * 2);
        ctx.setLineDash([]);
    }
    ctx.restore();
}

/** Small triangle pointing off the edge of the maze. */
function drawWrapArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: -1 | 1): void {
    const r = unit * 0.26;
    ctx.beginPath();
    ctx.moveTo(cx + dir * r, cy);
    ctx.lineTo(cx - dir * r * 0.7, cy - r * 0.8);
    ctx.lineTo(cx - dir * r * 0.7, cy + r * 0.8);
    ctx.closePath();
    ctx.fill();
}

/**
 * A tunnel row only does one thing: walking off either end wraps you to the
 * other side. Draw that, rather than tinting the whole row as though every
 * tile in it were special.
 */
function drawTunnelOverlay(ctx: CanvasRenderingContext2D, state: EditorState): void {
    for (let row = 0; row < gridH; row++) {
        if (Levels.wrapsAt(state.level, row)) drawTunnelRow(ctx, row);
    }
}

function drawTunnelRow(ctx: CanvasRenderingContext2D, row: number): void {
    const top = row * unit;
    const width = gridW * unit;
    const midY = top + unit / 2;

    ctx.save();

    // The row itself, as a dashed centre line
    ctx.strokeStyle = 'rgba(0,216,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // The wrap points: the only two tiles that teleport
    ctx.strokeStyle = '#00d8ff';
    ctx.fillStyle   = '#00d8ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, top + 1, unit - 2, unit - 2);
    ctx.strokeRect((gridW - 1) * unit + 1, top + 1, unit - 2, unit - 2);
    drawWrapArrow(ctx, unit * 0.5, midY, -1);
    drawWrapArrow(ctx, width - unit * 0.5, midY, 1);

    ctx.restore();
}

/**
 * A row band the HUD covers. Darkening does nothing on an already-black maze,
 * so these read as blocked the way a no-go area usually does: a light wash,
 * diagonal hatching and a label naming what covers them.
 */
function drawReservedBand(
    ctx: CanvasRenderingContext2D,
    rowStart: number,
    rowCount: number,
    label: string,
): void {
    if (rowCount <= 0) return;
    const top = rowStart * unit;
    const height = rowCount * unit;
    const width = gridW * unit;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, width, height);
    ctx.clip();

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, top, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -height; x < width; x += 9) {
        ctx.moveTo(x, top + height);
        ctx.lineTo(x + height, top);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `bold ${Math.round(unit * 0.5)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = `${label} — NOT PAINTABLE`;
    const metrics = ctx.measureText(text);
    const cx = width / 2;
    const cy = top + height / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - metrics.width / 2 - 4, cy - unit * 0.34, metrics.width + 8, unit * 0.68);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, cx, cy);
    ctx.restore();
}

function drawEditorOverlay(state: EditorState, ctx: CanvasRenderingContext2D): void {
    const lv = state.level;

    drawTunnelOverlay(ctx, state);

    // Slow tiles — wherever they are, not just on the tunnel row
    ctx.save();
    ctx.fillStyle = 'rgba(255,176,64,0.22)';
    for (const t of lv.tunnelSlowTiles) {
        ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
    }
    ctx.restore();

    // Red zone tile markers
    ctx.save();
    ctx.fillStyle = 'rgba(255,0,0,0.28)';
    for (const t of lv.redZoneTiles) {
        ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
    }
    ctx.restore();

    // Ghost door tiles
    ctx.save();
    ctx.strokeStyle = 'rgba(255,180,255,0.9)';
    ctx.lineWidth = 2;
    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            if (lv.tiles[y][x] === TILE_GHOST_DOOR) {
                ctx.strokeRect(x * unit + 1, y * unit + 1, unit - 2, unit - 2);
            }
        }
    }
    ctx.restore();

    // Mirror guides
    if (state.prefs.mirrorMode !== 'off') {
        const w = gridW * unit;
        const h = gridH * unit;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,0,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        const mode = state.prefs.mirrorMode;
        if (mode === 'horizontal' || mode === 'quad') {
            ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
        }
        if (mode === 'vertical' || mode === 'quad') {
            ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        }
        if (mode === 'diagonal') {
            ctx.moveTo(0, 0); ctx.lineTo(w, h);
            ctx.moveTo(w, 0); ctx.lineTo(0, h);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Grid lines — kept faint so they read as guides, not maze content
    if (state.prefs.showGrid) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let x = 1; x < gridW; x++) {
            ctx.moveTo(x * unit, 0);
            ctx.lineTo(x * unit, gridH * unit);
        }
        for (let y = 1; y < gridH; y++) {
            ctx.moveTo(0, y * unit);
            ctx.lineTo(gridW * unit, y * unit);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Reserved rows: the HUD covers these in play, so they cannot be painted
    drawReservedBand(ctx, 0, EDIT_MIN_Y, 'SCORE');
    drawReservedBand(ctx, EDIT_MAX_Y + 1, gridH - 1 - EDIT_MAX_Y, 'LIVES');

    // Map bounds — the full grid, including the rows the HUD covers, which
    // objects can still use even though tiles cannot.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, gridW * unit - 2, gridH * unit - 2);
    // The paintable area inside it
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(
        0.5,
        EDIT_MIN_Y * unit + 0.5,
        gridW * unit - 1,
        (EDIT_MAX_Y - EDIT_MIN_Y + 1) * unit - 1,
    );
    ctx.setLineDash([]);
    ctx.restore();

    // Movable objects — scatter targets first so spawns draw on top
    for (const marker of MARKER_KINDS) {
        const highlight = state.armedMarker === marker.id;
        const pos = marker.get(lv);
        if (marker.group === 'scatter') drawCrossMarker(ctx, pos, marker.color, highlight);
    }
    for (const marker of MARKER_KINDS) {
        const highlight = state.armedMarker === marker.id;
        const pos = marker.get(lv);
        if (marker.group === 'spawn') drawSpawnMarker(ctx, pos, marker.color, marker.badge, highlight);
    }

    // Hover preview — the brush footprint, or the tile under the cursor
    if (state.hoveredCell
        && !(toolWritesTiles(state.selectedTool) && isReservedRow(state.hoveredCell.y))) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        const cells = (state.selectedTool === 'paint' || state.selectedTool === 'erase')
            ? brushCells(state, state.hoveredCell)
            : [state.hoveredCell];
        for (const { x, y } of cells) {
            ctx.fillRect(x * unit, y * unit, unit, unit);
        }
        ctx.restore();
    }
}

// ── rAF Loop ──────────────────────────────────────────────────────────────────

/**
 * Generation token for the render loop. Starting a loop supersedes any earlier
 * one, and stopping bumps the token so the running loop retires on its next
 * frame — otherwise every play-test would leave another editor loop drawing
 * over the game, one more with each round.
 */
let editorLoopId = 0;

function startEditorLoop(state: EditorState): void {
    const id = ++editorLoopId;
    const frame = (): void => {
        if (id !== editorLoopId) return;
        layoutCanvasIfNeeded();
        Draw.level();
        drawEditorOverlay(state, gameState.ctx);

        if (state.uiDirty) {
            refreshReadouts(state);
            state.uiDirty = false;
        }
        updateHoverInfo(state);

        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

function stopEditorLoop(): void {
    editorLoopId++;
}

/**
 * True while a play-test owns the canvas. The editor's canvas listeners are
 * attached once and never removed, so without this a swipe during a test would
 * run editor tools — painting tiles into the level being played.
 */
let testRunning = false;

// ── Save / Load ───────────────────────────────────────────────────────────────

function exportLevelJSON(level: LevelData): void {
    const name = level.name.trim() || 'level';
    const json = JSON.stringify(level, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9_\-]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importLevelJSON(onLoad: (level: LevelData) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = migrateLevel(JSON.parse(reader.result as string) as LevelData);
                onLoad(data);
            } catch {
                alert('Invalid level JSON file.');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ── Layout: keep the maze clear of the panel ──────────────────────────────────

const PANEL_WIDTH = 268;
const PANEL_GAP = 16;
/** Below this the sheet cannot hold a row of controls, so the maze gives way. */
const BOTTOM_DOCK_MIN = 280;
/** A panel shorter than this switches to the compact control sizes. */
const COMPACT_PANEL_HEIGHT = 400;
let panelOpen = true;

type PanelDock = 'side' | 'bottom';

/**
 * Where the panel lives. A wide screen gets a side panel; so does a landscape
 * phone, where a bottom sheet would be only a couple of rows tall. Portrait
 * phones get the bottom sheet.
 */
function currentDock(): PanelDock {
    if (window.innerWidth >= 880) return 'side';
    return window.innerWidth > window.innerHeight ? 'side' : 'bottom';
}

let lastLayoutKey = '';

/**
 * Size the maze as large as the viewport allows, and give the panel the space
 * the maze cannot use.
 *
 * The maze is 28 × 36, far squarer than a phone screen: fitted to the width of
 * a portrait phone it leaves a deep band at the bottom, which is exactly where
 * the sheet goes — so the panel costs the maze nothing. A side panel likewise
 * only shrinks the maze once the maze is wide enough to reach it, which on a
 * desktop or a landscape phone it never is.
 */
function layoutCanvas(): void {
    const canvas = gameState.canvas;
    if (!canvas || isTypingInPanel()) return;
    const panel = document.getElementById('editor-panel');
    lastLayoutKey = layoutKey();

    const dock = currentDock();
    panel?.classList.toggle('ed-dock-side',   dock === 'side');
    panel?.classList.toggle('ed-dock-bottom', dock === 'bottom');

    const { width: viewW, height: viewH } = viewportSize();
    let scale: number;
    let reserveX = 0;
    let reserveY = 0;
    let panelHeight = 0;

    if (!panelOpen) {
        scale = Math.min(viewW / 560, viewH / 720);
    } else if (dock === 'side') {
        reserveX = PANEL_WIDTH + PANEL_GAP;
        scale = Math.min((viewW - reserveX) / 560, viewH / 720);
        panelHeight = viewH - PANEL_GAP;
    } else {
        // Fit the maze to the full width first; the sheet takes what is left.
        const fitWidth = viewW / 560;
        const leftover = viewH - 720 * fitWidth;
        if (leftover >= BOTTOM_DOCK_MIN) {
            scale = fitWidth;
            panelHeight = leftover;
        } else {
            panelHeight = BOTTOM_DOCK_MIN;
            scale = Math.min(fitWidth, (viewH - panelHeight) / 720);
        }
        reserveY = panelHeight;
    }

    canvas.style.width        = `${Math.floor(560 * scale)}px`;
    canvas.style.height       = `${Math.floor(720 * scale)}px`;
    canvas.style.marginRight  = `${reserveX}px`;
    canvas.style.marginBottom = `${reserveY}px`;

    if (panel) {
        panel.style.height = dock === 'bottom' && panelOpen ? `${panelHeight}px` : '';
        panel.classList.toggle('ed-compact', panelHeight > 0 && panelHeight < COMPACT_PANEL_HEIGHT);
        // Words wherever they fit: across a wide sheet, or wrapped onto a second
        // row in a side panel tall enough to spare it.
        const panelWidth = dock === 'bottom' ? viewW : PANEL_WIDTH;
        panel.classList.toggle(
            'ed-labels',
            panelWidth >= 340 || panelHeight >= COMPACT_PANEL_HEIGHT,
        );
        const hideGlyph = panel.querySelector('#ed-hide .ed-glyph');
        if (hideGlyph) hideGlyph.textContent = dock === 'bottom' ? '⌄' : '›';
    }
}

/**
 * Re-run the layout when the viewport changed. Called every frame because
 * mobile browsers do not reliably fire `resize` when the URL bar slides away
 * or the viewport settles after load.
 */
/**
 * True while a panel field has focus. An on-screen keyboard shrinks the visual
 * viewport, and relaying out on that would resize the maze under the person
 * typing a level name. The next layout check after blur puts it right.
 */
function isTypingInPanel(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement)) return false;
    return active.closest('#editor-panel') !== null;
}

function layoutKey(): string {
    const { width, height } = viewportSize();
    return `${width}x${height}:${panelOpen}`;
}

function layoutCanvasIfNeeded(): void {
    if (layoutKey() === lastLayoutKey) return;
    layoutCanvas();
}

function setPanelOpen(open: boolean): void {
    panelOpen = open;
    document.getElementById('editor-panel')?.classList.toggle('ed-collapsed', !open);
    const toggle = document.getElementById('ed-toggle');
    if (toggle) {
        // Only floats over the maze while the panel is away; the panel has its
        // own close button when it is open.
        toggle.hidden = open;
        toggle.setAttribute('aria-expanded', String(open));
    }
    layoutCanvas();
}

// ── Library Modal ─────────────────────────────────────────────────────────────

function openLibraryModal(
    state: EditorState,
    nameInput: HTMLInputElement,
    onLoaded: (id: string) => void,
): void {
    document.getElementById('ed-library-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ed-library-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'My maps');
    overlay.innerHTML = `
    <style>
    #ed-library-modal {
        position: fixed; inset: 0; background: rgba(0,0,0,0.85);
        z-index: 200; display: flex; align-items: center; justify-content: center;
        font-family: monospace; padding: 12px;
    }
    #ed-lib-box {
        background: #111; border: 2px solid #666; border-radius: 12px;
        padding: 18px; width: 100%; max-width: 460px;
        max-height: 86vh; display: flex; flex-direction: column; gap: 12px;
        color: #eee;
    }
    #ed-lib-box h3 { color: #ff0; margin: 0; font-size: 20px; }
    #ed-lib-list {
        overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px;
        touch-action: pan-y; overscroll-behavior: contain;
    }
    .ed-lib-entry {
        background: #1a1a1a; border: 1px solid #333; border-radius: 8px;
        padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .ed-lib-entry-name { font-size: 16px; color: #ff0; font-weight: bold; }
    .ed-lib-entry-meta { font-size: 12px; color: #999; }
    .ed-lib-entry-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .ed-lib-entry-actions button {
        flex: 1 1 90px; min-height: 44px; background: #222; color: #eee;
        border: 1px solid #555; border-radius: 6px; padding: 6px 8px; cursor: pointer;
        font-family: monospace; font-size: 14px;
    }
    #ed-library-modal button:focus-visible, #ed-library-modal :focus-visible {
        outline: 3px solid #ff0; outline-offset: 2px;
    }
    .ed-lib-btn-load  { color: #9f9 !important; border-color: #4a4 !important; }
    .ed-lib-btn-test  { color: #9bf !important; border-color: #46a !important; }
    .ed-lib-btn-del   { color: #f88 !important; border-color: #a33 !important; }
    #ed-lib-empty { color: #888; font-size: 14px; text-align: center; padding: 20px 0; }
    #ed-lib-close {
        background: #222; color: #eee; border: 1px solid #666;
        border-radius: 6px; padding: 10px 16px; cursor: pointer; min-height: 48px;
        font-family: monospace; font-size: 16px; align-self: stretch;
    }
    </style>
    <div id="ed-lib-box">
        <h3>📂 My Maps</h3>
        <div id="ed-lib-list"></div>
        <button id="ed-lib-close">✕ Close</button>
    </div>`;
    document.body.appendChild(overlay);

    // Prevent canvas events
    overlay.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend',   e => e.stopPropagation(), { passive: true });
    overlay.addEventListener('click',      e => e.stopPropagation());
    overlay.addEventListener('mousedown',  e => e.stopPropagation());

    function closeModal(): void { overlay.remove(); }
    const closeBtn = document.getElementById('ed-lib-close')!;
    closeBtn.onclick = closeModal;
    closeBtn.focus();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    function refreshList(): void {
        const listEl = document.getElementById('ed-lib-list')!;
        const entries = listLevels();
        if (entries.length === 0) {
            listEl.innerHTML = '<div id="ed-lib-empty">No saved maps yet.<br>Use "Save to Library" to add one.</div>';
            return;
        }
        listEl.innerHTML = '';
        for (const entry of [...entries].reverse()) {
            const counts = countUsage(entry.level);
            const div = document.createElement('div');
            div.className = 'ed-lib-entry';
            div.innerHTML = `
                <div class="ed-lib-entry-name"></div>
                <div class="ed-lib-entry-meta"></div>
                <div class="ed-lib-entry-actions">
                    <button class="ed-lib-btn-load">📂 Load</button>
                    <button class="ed-lib-btn-test">▶ Test</button>
                    <button class="ed-lib-btn-del">🗑 Delete</button>
                </div>`;
            div.querySelector('.ed-lib-entry-name')!.textContent = entry.level.name || '(Untitled)';
            div.querySelector('.ed-lib-entry-meta')!.textContent =
                `${formatDate(entry.savedAt)} · ${counts.dot} dots · ${counts.power} power`;

            const btns = div.querySelectorAll('button');
            const loadBtn = btns[0] as HTMLButtonElement;
            const testBtn = btns[1] as HTMLButtonElement;
            const delBtn  = btns[2] as HTMLButtonElement;

            loadBtn.addEventListener('click', () => {
                pushUndo(state);
                const loaded = deepCopyLevel(entry.level);
                Object.assign(state.level, loaded);
                state.libraryId = entry.id;
                if (entry.tileSetId) state.prefs.tileSetId = entry.tileSetId;
                nameInput.value = state.level.name;
                recountUsage(state);
                syncToRenderer(state);
                scheduleAutosave(state.level);
                savePrefs(state.prefs);
                onLoaded(entry.id);
                closeModal();
            });

            testBtn.addEventListener('click', () => {
                const result = validateLevel(entry.level, activeTileSet(state));
                if (!result.valid) {
                    alert('Level has errors:\n' + result.errors.map(e => `• ${e}`).join('\n'));
                    return;
                }
                closeModal();
                runTestGame(state, deepCopyLevel(entry.level));
            });

            delBtn.addEventListener('click', () => {
                if (!confirm(`Delete "${entry.level.name || 'Untitled'}"?`)) return;
                deleteLevel(entry.id);
                if (state.libraryId === entry.id) state.libraryId = null;
                refreshList();
            });

            listEl.appendChild(div);
        }
    }
    refreshList();
}

// ── Play-test ─────────────────────────────────────────────────────────────────

/**
 * A way out of a play-test that does not need a keyboard. Escape works too, but
 * on a phone there is none — without this the only exit was to lose every life.
 */
function showExitTestButton(): void {
    document.getElementById('ed-exit-test')?.remove();

    const button = document.createElement('button');
    button.id = 'ed-exit-test';
    button.type = 'button';
    button.textContent = '✕ Exit test';
    button.title = 'Return to the editor (Esc)';
    button.setAttribute('aria-label', 'Exit the play-test and return to the editor');
    button.style.cssText = [
        'position: fixed', 'top: 8px', 'left: 8px', 'z-index: 150',
        'background: rgba(0,0,0,0.85)', 'color: #ff0', 'border: 2px solid #666',
        'border-radius: 8px', 'padding: 8px 12px', 'min-height: 44px',
        'font-family: monospace', 'font-size: 14px', 'cursor: pointer',
        'touch-action: manipulation',
    ].join(';');

    const leave = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        exitTestGame();
    };
    button.addEventListener('click', leave);
    button.addEventListener('touchend', leave, { passive: false });
    // The game reads swipes from `document`, so keep taps on the button out of
    // it — and preventDefault too, since stopping propagation alone would leave
    // nobody to stop the browser panning the page.
    for (const type of ['touchstart', 'touchmove', 'mousedown', 'mouseup'] as const) {
        button.addEventListener(type, (event) => {
            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });
    }

    document.body.appendChild(button);
}

function runTestGame(state: EditorState, level: LevelData): void {
    stopEditorLoop();
    testRunning = true;
    const panel = document.getElementById('editor-panel');
    const toggle = document.getElementById('ed-toggle');
    panel?.remove();
    toggle?.remove();
    const wasOpen = panelOpen;
    panelOpen = false;
    layoutCanvas();

    showExitTestButton();

    startTestGame(level, () => {
        testRunning = false;
        document.getElementById('ed-exit-test')?.remove();
        if (panel) {
            document.body.appendChild(panel);
            buildPanel(state, panel);
        }
        if (toggle) document.body.appendChild(toggle);
        setPanelOpen(wasOpen);
        syncToRenderer(state);
        startEditorLoop(state);
    });
}

// ── Panel UI ──────────────────────────────────────────────────────────────────

/** Sections of the panel. One is visible at a time, so nothing has to scroll. */
const TABS: Array<{ id: string; icon: string; label: string; title: string }> = [
    { id: 'paint',   icon: '▦',  label: 'Paint',   title: 'Tile palette and paint tools' },
    { id: 'brush',   icon: '⌗',  label: 'Brush',   title: 'Brush size and mirroring' },
    { id: 'objects', icon: '✥',  label: 'Objects', title: 'Spawns and scatter targets' },
    { id: 'zones',   icon: '⊕',  label: 'Zones',   title: 'Red zones, slow tiles, tunnel row' },
    { id: 'level',   icon: '✔',  label: 'Level',   title: 'Name, tile set, budgets, validation' },
    { id: 'more',    icon: '☰',  label: 'More',    title: 'Library, files and shortcuts' },
];

/** The tab a tool lives in, so selecting it elsewhere brings it into view. */
const TOOL_TAB: Record<EditorTool, string> = {
    paint: 'paint', erase: 'paint', fill: 'paint',
    move: 'objects',
    red_zone: 'zones', slow_zone: 'zones',
};

const TOOL_BUTTONS: Array<{ tool: EditorTool; id: string }> = [
    { tool: 'paint',         id: 'ed-tool-paint'   },
    { tool: 'erase',         id: 'ed-tool-erase'   },
    { tool: 'fill',          id: 'ed-tool-fill'    },
    { tool: 'move',          id: 'ed-tool-move'    },
    { tool: 'red_zone',      id: 'ed-tool-redzone'  },
    { tool: 'slow_zone',     id: 'ed-tool-slowzone' },
];

const PANEL_CSS = `
#editor-panel, #ed-toggle, #ed-toast { font-family: monospace; }

/* ── Shell ─────────────────────────────────────────────────────────────── */
#editor-panel {
    position: fixed; background: rgba(0,0,0,0.94); color: #eee;
    border: 2px solid #666; z-index: 100; font-size: 15px;
    display: flex; flex-direction: column; gap: 8px;
    padding: 8px; touch-action: pan-y; overscroll-behavior: contain;
}
#editor-panel.ed-collapsed { display: none; }
/* Docked to the right on a wide or landscape screen … */
#editor-panel.ed-dock-side {
    top: ${PANEL_GAP / 2}px; right: ${PANEL_GAP / 2}px; bottom: ${PANEL_GAP / 2}px;
    width: ${PANEL_WIDTH}px;
    border-radius: 10px;
}
/* … and to the bottom edge on a portrait phone. */
#editor-panel.ed-dock-bottom {
    left: 0; right: 0; bottom: 0; height: ${BOTTOM_DOCK_MIN}px;
    border-radius: 12px 12px 0 0; border-width: 2px 0 0;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
}

/* ── Always-visible action bar ─────────────────────────────────────────── */
#editor-panel .ed-bar { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
#editor-panel .ed-bar #ed-info {
    flex: 1; min-width: 0; font-size: 12px; color: #999;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
#editor-panel .ed-icon-btn {
    min-width: 44px; width: 44px; justify-content: center;
    padding: 4px; font-size: 17px; gap: 5px;
}
#editor-panel .ed-btn-label { display: none; font-size: 12px; }
/* Wide enough for words: the bar labels itself rather than leaving bare icons. */
#editor-panel.ed-labels .ed-icon-btn { width: auto; padding: 4px 10px; }
#editor-panel.ed-labels .ed-btn-label { display: inline; }

/* ── Tabs ──────────────────────────────────────────────────────────────── */
#ed-tabs { display: flex; gap: 4px; flex-shrink: 0; }
#ed-tabs button {
    flex: 1 1 0; min-width: 0; flex-direction: column; gap: 1px;
    justify-content: center; align-items: center; text-align: center;
    padding: 4px 2px; min-height: 46px; font-size: 10px; letter-spacing: 0;
    color: #bbb; background: #191919;
}
#ed-tabs button .ed-tab-icon { font-size: 16px; line-height: 1.1; }
#ed-tabs button[aria-selected="true"] {
    background: #3a3a12; border-color: #ff0; color: #ff0;
}

/* ── Tab bodies ────────────────────────────────────────────────────────── */
#editor-panel .ed-body { flex: 1; min-height: 0; display: flex; }
#editor-panel > #ed-test-btn { flex-shrink: 0; justify-content: center; }
#editor-panel .ed-tab-panel {
    flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px;
    overflow-y: auto; overscroll-behavior: contain;
}
#editor-panel .ed-tab-panel[hidden] { display: none; }

/* Controls pack across the width instead of stacking one per row. */
#editor-panel .ed-grid {
    display: grid; gap: 5px;
    grid-template-columns: repeat(auto-fit, minmax(var(--col, 92px), 1fr));
}
#editor-panel .ed-stack { display: flex; flex-direction: column; gap: 6px; }
#editor-panel .ed-label-sm {
    font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px;
}

/* ── Controls ──────────────────────────────────────────────────────────── */
#editor-panel button {
    background: #222; color: #eee; border: 1px solid #666;
    border-radius: 6px; padding: 6px 8px; cursor: pointer; min-height: 44px;
    font-family: monospace; font-size: 13px; text-align: left;
    touch-action: manipulation; display: flex; align-items: center; gap: 6px;
}
#editor-panel .ed-grid button { justify-content: flex-start; }
#editor-panel .ed-grid.ed-centred button { justify-content: center; text-align: center; }
#editor-panel button[aria-pressed="true"], #editor-panel [role="radio"][aria-checked="true"] {
    background: #3a3a12; border-color: #ff0; color: #ff0;
}
#editor-panel button:hover { border-color: #999; }
#editor-panel button:disabled { opacity: 0.45; cursor: default; }
#editor-panel :focus-visible { outline: 3px solid #ff0; outline-offset: 2px; }
#editor-panel .ed-count { margin-left: auto; font-size: 11px; color: #9a9a9a; }
#editor-panel button[aria-pressed="true"] .ed-count,
#editor-panel [aria-checked="true"] .ed-count { color: #ffd; }
#editor-panel .ed-count.ed-full { color: #ffcc44; }
#editor-panel .ed-count.ed-over { color: #ff6666; }
#editor-panel .ed-swatch-box {
    width: 18px; height: 18px; border-radius: 3px; border: 1px solid #777; flex-shrink: 0;
}
#editor-panel .ed-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
#editor-panel .ed-objects button {
    flex-direction: column; align-items: center; justify-content: center;
    gap: 0; padding: 2px; text-align: center;
}
#editor-panel .ed-badge {
    font-size: 15px; font-weight: bold; line-height: 1.1;
    border: 1px solid; border-radius: 50%; width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
}
#editor-panel .ed-objects .ed-count { margin: 0; font-size: 10px; }
/* A short panel — a landscape phone, or a sheet under a tall maze. */
#editor-panel.ed-compact button, #editor-panel.ed-compact label,
#editor-panel.ed-compact input, #editor-panel.ed-compact select { min-height: 40px; }
#editor-panel.ed-compact #ed-tabs button { min-height: 36px; font-size: 9px; padding: 2px; }
#editor-panel.ed-compact #ed-tabs button .ed-tab-icon { font-size: 13px; }
#editor-panel.ed-compact { gap: 5px; padding: 6px; }
#editor-panel.ed-compact .ed-grid { gap: 4px; }
#editor-panel.ed-compact .ed-tab-panel { gap: 4px; }
#editor-panel label {
    display: flex; align-items: center; gap: 8px; cursor: pointer;
    font-size: 13px; min-height: 44px;
}
#editor-panel input[type=checkbox] { width: 20px; height: 20px; cursor: pointer; accent-color: #ff0; flex-shrink: 0; }
#editor-panel input[type=text], #editor-panel select {
    background: #111; color: #ff0; border: 1px solid #666;
    border-radius: 6px; padding: 8px; font-family: monospace;
    font-size: 16px; width: 100%; box-sizing: border-box; min-height: 44px;
}
#editor-panel .ed-desc { font-size: 11px; color: #999; margin: 0; line-height: 1.4; }

/* ── Budgets ───────────────────────────────────────────────────────────── */
#editor-panel .ed-budgets {
    list-style: none; margin: 0; padding: 0;
    flex: 1 1 0; min-height: 18px; overflow-y: auto;
    display: grid; gap: 4px 10px;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}
#editor-panel .ed-budget { font-size: 11px; color: #ccc; }
#editor-panel .ed-budget-top { line-height: 1.5; }
#editor-panel .ed-budget-top { display: flex; justify-content: space-between; gap: 6px; }
#editor-panel .ed-budget-bar { height: 3px; background: #222; border-radius: 2px; margin-top: 2px; overflow: hidden; }
#editor-panel .ed-budget-bar > span { display: block; height: 100%; background: #4a8; width: 0; }
#editor-panel .ed-budget.ed-full .ed-budget-bar > span { background: #ffcc44; }
#editor-panel .ed-budget.ed-over .ed-budget-bar > span { background: #ff6666; }

/* ── Output areas — these may scroll; every control stays reachable ────── */
#ed-validate-result {
    font-size: 11px; line-height: 1.45;
    flex: 0 1 auto; max-height: 84px; overflow-y: auto;
}
#ed-validate-result .ed-headline {
    font-size: 13px; font-weight: bold; padding: 5px 6px; border-radius: 5px;
    margin-bottom: 4px; position: sticky; top: 0;
}
#ed-validate-result .ed-headline.ed-ok    { background: #0c2c14; }
#ed-validate-result .ed-headline.ed-error { background: #2e0f0f; }
#ed-validate-result .ed-error   { color: #ff8080; }
#ed-validate-result .ed-warning { color: #ffcc44; }
#ed-validate-result .ed-ok      { color: #7f7; }
#ed-test-btn { background: #063; color: #cfc; border-color: #4a4; font-weight: bold; }
#editor-panel .ed-keys {
    font-size: 11px; color: #aaa; line-height: 1.8; margin: 0; padding: 0; list-style: none;
    flex: 1 1 0; min-height: 20px; overflow-y: auto;
}
#editor-panel .ed-keys kbd {
    background: #222; border: 1px solid #555; border-radius: 3px;
    padding: 1px 5px; color: #ff0; font-family: monospace;
}

/* ── Floating opener + toast ───────────────────────────────────────────── */
#ed-toggle {
    position: fixed; right: 12px; bottom: 12px; z-index: 101;
    width: 52px; height: 52px; border-radius: 10px;
    background: rgba(0,0,0,0.9); color: #ff0; border: 2px solid #666;
    font-size: 22px; cursor: pointer; touch-action: manipulation;
}
#ed-toggle:focus-visible { outline: 3px solid #ff0; outline-offset: 2px; }
#ed-toast {
    position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
    background: rgba(20,20,20,0.96); color: #ffd; border: 1px solid #888;
    border-radius: 8px; padding: 10px 14px; font-size: 13px; max-width: 90vw;
    text-align: center; z-index: 300; opacity: 0; pointer-events: none;
    transition: opacity 0.18s ease;
}
#ed-toast.ed-toast-show { opacity: 1; }
@media (pointer: coarse) {
    #editor-panel button, #editor-panel label,
    #editor-panel input[type=text], #editor-panel select { min-height: 46px; }
}
@media (prefers-reduced-motion: reduce) {
    #ed-toast { transition: none; }
}
`;

interface PanelRefs {
    name: HTMLInputElement;
    tileSetSelect: HTMLSelectElement;
    tileSetDesc: HTMLElement;
    budgets: HTMLElement;
    palette: HTMLElement;
    markers: HTMLElement;
    info: HTMLElement;
    validateResult: HTMLElement;
    libCount: HTMLButtonElement;
    undo: HTMLButtonElement;
    redo: HTMLButtonElement;
}

let ui: PanelRefs | null = null;

function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

function buildPanel(state: EditorState, panelEl?: HTMLElement): HTMLElement {
    const panel = panelEl ?? document.createElement('div');
    panel.id = 'editor-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Level editor tools');
    panel.innerHTML = `
        <style>${PANEL_CSS}</style>

        <div class="ed-bar">
            <button id="ed-hide" class="ed-icon-btn" aria-label="Hide the tools panel" title="Hide the tools panel (H)">
                <span class="ed-glyph" aria-hidden="true">⌄</span><span class="ed-btn-label">Hide</span>
            </button>
            <button id="ed-undo" class="ed-icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)">
                <span class="ed-glyph" aria-hidden="true">↩</span><span class="ed-btn-label">Undo</span>
            </button>
            <button id="ed-redo" class="ed-icon-btn" aria-label="Redo" title="Redo (Ctrl+Y)">
                <span class="ed-glyph" aria-hidden="true">↪</span><span class="ed-btn-label">Redo</span>
            </button>
            <button id="ed-grid" class="ed-icon-btn" aria-pressed="true" aria-label="Show the tile grid" title="Show the tile grid (G)">
                <span class="ed-glyph" aria-hidden="true">⊞</span><span class="ed-btn-label">Grid</span>
            </button>
            <div id="ed-info" role="status" aria-live="off"></div>
        </div>

        <div id="ed-tabs" role="tablist" aria-label="Editor sections"></div>

        <div class="ed-body">
            <section id="ed-panel-paint" class="ed-tab-panel" role="tabpanel" aria-labelledby="ed-tab-paint">
                <div class="ed-grid ed-centred" role="group" aria-label="Tool" style="--col: 74px">
                    <button id="ed-tool-paint" aria-pressed="false" title="Paint the selected tile (B)">✏ Paint</button>
                    <button id="ed-tool-erase" aria-pressed="false" title="Set tiles back to empty (E)">◻ Erase</button>
                    <button id="ed-tool-fill"  aria-pressed="false" title="Flood-fill matching tiles (F)">⬛ Fill</button>
                </div>
                <div class="ed-grid" id="ed-palette" role="radiogroup" aria-label="Tile type" style="--col: 98px"></div>
            </section>

            <section id="ed-panel-brush" class="ed-tab-panel" role="tabpanel" aria-labelledby="ed-tab-brush" hidden>
                <div class="ed-label-sm">Brush size</div>
                <div class="ed-grid ed-centred" id="ed-brush-sizes" role="group" aria-label="Brush size" style="--col: 56px"></div>
                <div class="ed-label-sm" id="ed-mirror-label">Mirror painting</div>
                <div class="ed-grid ed-centred" id="ed-mirror-modes" role="radiogroup" aria-labelledby="ed-mirror-label" style="--col: 56px"></div>
            </section>

            <section id="ed-panel-objects" class="ed-tab-panel" role="tabpanel" aria-labelledby="ed-tab-objects" hidden>
                <div class="ed-grid" style="--col: 120px">
                    <button id="ed-tool-move" aria-pressed="false" title="Drag any object on the maze (M)">✥ Move</button>
                    <label><input type="checkbox" id="ed-half"> Half-tile</label>
                </div>
                <div class="ed-grid ed-objects" id="ed-markers" role="group" aria-label="Movable objects" style="--col: 58px"></div>
            </section>

            <section id="ed-panel-zones" class="ed-tab-panel" role="tabpanel" aria-labelledby="ed-tab-zones" hidden>
                <div class="ed-grid" style="--col: 116px">
                    <button id="ed-tool-redzone" aria-pressed="false" title="Paint junctions where enemies may not turn up — Erase clears them (R)">
                        ⊕ Red zone<span class="ed-count" id="ed-rz-count"></span>
                    </button>
                    <button id="ed-tool-slowzone" aria-pressed="false" title="Paint tiles where enemies crawl — Erase clears them (S)">
                        ⌁ Slow tiles<span class="ed-count" id="ed-slow-count"></span>
                    </button>
                </div>
                <p class="ed-desc" id="ed-tunnel-desc"></p>
            </section>

            <section id="ed-panel-level" class="ed-tab-panel" role="tabpanel" aria-labelledby="ed-tab-level" hidden>
                <div class="ed-grid" style="--col: 116px">
                    <input type="text" id="ed-name" maxlength="32" placeholder="Level name…" aria-label="Level name">
                    <select id="ed-tileset" aria-label="Tile set"></select>
                </div>
                <button id="ed-validate" style="justify-content:center">✔ Validate</button>
                <div id="ed-validate-result" role="status" aria-live="polite"></div>
                <p class="ed-desc" id="ed-tileset-desc"></p>
                <ul class="ed-budgets" id="ed-budgets" aria-label="Tile budgets"></ul>
            </section>

            <section id="ed-panel-more" class="ed-tab-panel" role="tabpanel" aria-labelledby="ed-tab-more" hidden>
                <div class="ed-grid" style="--col: 116px">
                    <button id="ed-save-lib">💾 Save to library</button>
                    <button id="ed-open-lib">📂 My maps</button>
                    <button id="ed-export">⬇ Export</button>
                    <button id="ed-import">⬆ Import</button>
                    <button id="ed-reset">↺ Reset to Classic</button>
                </div>
                <ul class="ed-keys">
                    <li><kbd>1</kbd>–<kbd>5</kbd> pick a tile</li>
                    <li><kbd>B</kbd> paint · <kbd>E</kbd> erase · <kbd>F</kbd> fill</li>
                    <li><kbd>M</kbd> move objects · arrows nudge</li>
                    <li><kbd>R</kbd> red zone · <kbd>S</kbd> slow tiles</li>
                    <li><kbd>[</kbd> <kbd>]</kbd> brush size · <kbd>X</kbd> cycle mirror</li>
                    <li><kbd>G</kbd> grid · <kbd>H</kbd> hide panel</li>
                    <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Y</kbd> redo</li>
                    <li><kbd>Esc</kbd> drop the held object</li>
                </ul>
            </section>
        </div>

        <button id="ed-test-btn">▶ Test level</button>
    `;
    if (!panelEl) document.body.appendChild(panel);

    // Stop panel input from reaching the canvas handlers
    panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('click',      (e) => e.stopPropagation());
    panel.addEventListener('mousedown',  (e) => e.stopPropagation());
    panel.addEventListener('mouseup',    (e) => e.stopPropagation());

    ui = {
        name:           el<HTMLInputElement>('ed-name'),
        tileSetSelect:  el<HTMLSelectElement>('ed-tileset'),
        tileSetDesc:    el('ed-tileset-desc'),
        budgets:        el('ed-budgets'),
        palette:        el('ed-palette'),
        markers:        el('ed-markers'),
        info:           el('ed-info'),
        validateResult: el('ed-validate-result'),
        libCount:       el<HTMLButtonElement>('ed-open-lib'),
        undo:           el<HTMLButtonElement>('ed-undo'),
        redo:           el<HTMLButtonElement>('ed-redo'),
    };

    // Tab strip
    const tabStrip = el('ed-tabs');
    for (const tab of TABS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `ed-tab-${tab.id}`;
        button.dataset.tab = tab.id;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', 'false');
        button.setAttribute('aria-controls', `ed-panel-${tab.id}`);
        button.title = tab.title;
        button.innerHTML = `<span class="ed-tab-icon" aria-hidden="true">${tab.icon}</span><span>${tab.label}</span>`;
        button.onclick = () => setTab(state, tab.id);
        tabStrip.appendChild(button);
    }

    // Level name
    ui.name.value = state.level.name;
    ui.name.oninput = () => {
        state.level.name = ui!.name.value;
        scheduleAutosave(state.level);
    };

    // Tile set selector
    for (const set of TILE_SETS) {
        const option = document.createElement('option');
        option.value = set.id;
        option.textContent = set.name;
        ui.tileSetSelect.appendChild(option);
    }
    ui.tileSetSelect.value = activeTileSet(state).id;
    ui.tileSetSelect.onchange = () => {
        state.prefs.tileSetId = ui!.tileSetSelect.value;
        savePrefs(state.prefs);
        state.uiDirty = true;
    };

    // Budget readout rows
    for (const row of BUDGET_ROWS) {
        const li = document.createElement('li');
        li.className = 'ed-budget';
        li.dataset.key = row.key;
        li.innerHTML = `
            <div class="ed-budget-top"><span>${row.label}</span><span class="ed-budget-val"></span></div>
            <div class="ed-budget-bar" aria-hidden="true"><span></span></div>`;
        ui.budgets.appendChild(li);
    }

    // Tile palette
    for (const kind of TILE_KINDS) {
        const button = document.createElement('button');
        button.id = `ed-tile-${kind.id}`;
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', 'false');
        button.title = `${kind.hint} (${kind.key})`;
        button.innerHTML = `
            <span class="ed-swatch-box" style="background:${kind.swatch}"></span>
            <span>${kind.label}</span>
            <span class="ed-count" data-budget="${kind.id}"></span>`;
        button.onclick = () => selectTile(state, kind.value);
        ui.palette.appendChild(button);
    }

    // Brush sizes
    const brushRow = el('ed-brush-sizes');
    for (const size of [1, 2, 3]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.brush = String(size);
        button.textContent = `${size}×${size}`;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', `Brush size ${size} by ${size}`);
        button.onclick = () => {
            state.prefs.brushSize = size;
            savePrefs(state.prefs);
            state.uiDirty = true;
        };
        brushRow.appendChild(button);
    }

    // Tool buttons
    for (const { tool, id } of TOOL_BUTTONS) {
        const button = el<HTMLButtonElement>(id);
        button.onclick = () => selectTool(state, tool);
    }

    // Movable objects
    for (const marker of MARKER_KINDS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `ed-marker-${marker.id}`;
        button.title = `${marker.label} — ${marker.hint}`;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', marker.label);
        button.innerHTML = `
            <span class="ed-badge" style="color:${marker.color}; border-color:${marker.color}">${marker.badge}</span>
            <span class="ed-count" data-marker="${marker.id}"></span>`;
        button.onclick = () => {
            state.armedMarker = state.armedMarker === marker.id ? null : marker.id;
            if (state.armedMarker) selectTool(state, 'move');
            state.uiDirty = true;
        };
        ui.markers.appendChild(button);
    }

    el<HTMLButtonElement>('ed-hide').onclick = () => setPanelOpen(false);


    // Mirror modes
    const mirrorRow = el('ed-mirror-modes');
    for (const mode of MIRROR_MODES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `ed-mirror-${mode.id}`;
        button.dataset.mirror = mode.id;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', 'false');
        button.setAttribute('aria-label', `Mirror: ${mode.hint}`);
        button.title = mode.hint;
        button.textContent = `${mode.symbol} ${mode.label}`;
        button.onclick = () => setMirrorMode(state, mode.id);
        mirrorRow.appendChild(button);
    }

    const half = el<HTMLInputElement>('ed-half');
    half.checked = state.prefs.halfTileX;
    half.onchange = () => {
        state.prefs.halfTileX = half.checked;
        savePrefs(state.prefs);
    };

    el<HTMLButtonElement>('ed-grid').onclick = () => toggleGrid(state);

    // Undo / redo
    ui.undo.onclick = () => { if (undo(state)) syncToRenderer(state); };
    ui.redo.onclick = () => { if (redo(state)) syncToRenderer(state); };

    // Validate
    el<HTMLButtonElement>('ed-validate').onclick = () => runValidation(state);

    // Test level
    el<HTMLButtonElement>('ed-test-btn').onclick = () => {
        const result = runValidation(state);
        // runValidation has already opened the Level tab and named the first
        // problem, so there is nothing vague left to say here.
        if (!result.valid) return;
        // Persist so the editor session survives the test
        try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.level));
        } catch {
            // ignore quota errors
        }
        runTestGame(state, deepCopyLevel(state.level));
    };

    // Export / import / reset
    el<HTMLButtonElement>('ed-export').onclick = () => exportLevelJSON(state.level);
    el<HTMLButtonElement>('ed-import').onclick = () => {
        importLevelJSON((imported) => {
            pushUndo(state);
            Object.assign(state.level, imported);
            syncToRenderer(state);
            recountUsage(state);
            ui!.name.value = state.level.name;
            scheduleAutosave(state.level);
            runValidation(state);
        });
    };
    el<HTMLButtonElement>('ed-reset').onclick = () => {
        if (!confirm('Reset to the Classic level? Unsaved changes will be lost.')) return;
        pushUndo(state);
        Object.assign(state.level, deepCopyLevel(Levels.level1Data));
        ui!.name.value = state.level.name;
        state.libraryId = null;
        syncToRenderer(state);
        recountUsage(state);
        localStorage.removeItem(AUTOSAVE_KEY);
    };

    // Library
    const saveLibBtn = el<HTMLButtonElement>('ed-save-lib');
    saveLibBtn.onclick = () => {
        const trimmed = ui!.name.value.trim();
        if (!trimmed) {
            showToast('Give the level a name before saving it to the library');
            ui!.name.focus();
            return;
        }
        state.level.name = trimmed;
        state.libraryId = saveLevel(state.level, state.libraryId ?? undefined, activeTileSet(state).id);
        scheduleAutosave(state.level);
        state.uiDirty = true;
        showToast(`Saved "${trimmed}" to your library`);
    };
    ui.libCount.onclick = () => {
        openLibraryModal(state, ui!.name, (id) => {
            state.libraryId = id;
            state.uiDirty = true;
        });
    };

    state.uiDirty = true;
    return panel;
}

function toggleGrid(state: EditorState): void {
    state.prefs.showGrid = !state.prefs.showGrid;
    savePrefs(state.prefs);
    state.uiDirty = true;
}

/** Show one section. The others are hidden, so the visible one need not scroll. */
function setTab(state: EditorState, id: string): void {
    state.prefs.activeTab = TABS.some(t => t.id === id) ? id : TABS[0].id;
    savePrefs(state.prefs);
    state.uiDirty = true;
}

/** Bring a tool's section into view when it is chosen from elsewhere. */
function revealToolTab(state: EditorState, tool: EditorTool): void {
    const tab = TOOL_TAB[tool];
    if (tab && tab !== state.prefs.activeTab) setTab(state, tab);
}

function selectTile(state: EditorState, value: TileValue): void {
    state.selectedTileValue = value;
    state.selectedTool = 'paint';
    revealToolTab(state, 'paint');
    state.uiDirty = true;
}

function setMirrorMode(state: EditorState, mode: MirrorMode): void {
    state.prefs.mirrorMode = mode;
    savePrefs(state.prefs);
    state.uiDirty = true;
    showToast(`Mirror: ${mirrorModeDef(mode).hint}`);
}

function selectTool(state: EditorState, tool: EditorTool): void {
    state.selectedTool = tool;
    if (tool !== 'move') state.draggingMarker = null;
    revealToolTab(state, tool);
    state.uiDirty = true;
}

/** Refresh every live number and pressed-state in the panel. */
function refreshReadouts(state: EditorState): void {
    if (!ui) return;
    const tileSet = activeTileSet(state);

    ui.tileSetSelect.value = tileSet.id;
    ui.tileSetDesc.textContent = tileSet.description;

    // Budget rows
    for (const row of BUDGET_ROWS) {
        const li = ui.budgets.querySelector<HTMLElement>(`[data-key="${row.key}"]`);
        if (!li) continue;
        const used = state.usage[row.key];
        const budget = tileSet.budgets[row.key];
        li.querySelector('.ed-budget-val')!.textContent = formatBudget(used, budget);
        const bar = li.querySelector<HTMLElement>('.ed-budget-bar > span')!;
        const ratio = isInfinite(budget) ? 0 : Math.min(1, budget === 0 ? 1 : used / budget);
        bar.style.width = `${Math.round(ratio * 100)}%`;
        li.classList.toggle('ed-full', !isInfinite(budget) && used === budget);
        li.classList.toggle('ed-over', !isInfinite(budget) && used > budget);
    }

    // Palette: selection + how many are left
    for (const kind of TILE_KINDS) {
        const button = document.getElementById(`ed-tile-${kind.id}`);
        if (!button) continue;
        const selected = state.selectedTool === 'paint' && state.selectedTileValue === kind.value;
        button.setAttribute('aria-checked', String(selected));
        const budget = tileSet.budgets[kind.id];
        const count = button.querySelector<HTMLElement>('.ed-count')!;
        count.textContent = isInfinite(budget)
            ? '∞'
            : `${Math.max(0, budget - state.usage[kind.id])} left`;
        count.classList.toggle('ed-full', !isInfinite(budget) && state.usage[kind.id] >= budget);
    }

    // Tools
    for (const { tool, id } of TOOL_BUTTONS) {
        document.getElementById(id)?.setAttribute('aria-pressed', String(state.selectedTool === tool));
    }
    document.querySelectorAll<HTMLElement>('#ed-brush-sizes button').forEach((button) => {
        button.setAttribute('aria-pressed', String(Number(button.dataset.brush) === state.prefs.brushSize));
    });
    document.querySelectorAll<HTMLElement>('#ed-mirror-modes button').forEach((button) => {
        button.setAttribute('aria-checked', String(button.dataset.mirror === state.prefs.mirrorMode));
    });

    // Movable objects: which one is held, and where each sits
    for (const marker of MARKER_KINDS) {
        const button = document.getElementById(`ed-marker-${marker.id}`);
        if (!button) continue;
        button.setAttribute('aria-pressed', String(state.armedMarker === marker.id));
        const pos = marker.get(state.level);
        button.querySelector<HTMLElement>('.ed-count')!.textContent = `${pos.x}, ${pos.y}`;
    }

    // Zones
    el('ed-rz-count').textContent   = formatBudget(state.usage.red_zone,  tileSet.budgets.red_zone);
    el('ed-slow-count').textContent = formatBudget(state.usage.slow_zone, tileSet.budgets.slow_zone);
    const wrapRows: number[] = [];
    for (let row = 0; row < gridH; row++) {
        if (Levels.wrapsAt(state.level, row)) wrapRows.push(row);
    }
    el('ed-tunnel-desc').textContent = (wrapRows.length === 0
        ? 'Nothing wraps: no row is open at both edges. '
        : `Wraps on row${wrapRows.length === 1 ? '' : 's'} ${wrapRows.join(', ')} — `
            + 'a row wraps wherever both of its end tiles are walkable, so open an '
            + 'edge to make one. ')
        + 'Amber tiles are slow tiles. Tap a marked tile again to clear it, or use Erase.';

    // Tabs
    for (const tab of TABS) {
        const active = tab.id === state.prefs.activeTab;
        document.getElementById(`ed-tab-${tab.id}`)?.setAttribute('aria-selected', String(active));
        const panel = document.getElementById(`ed-panel-${tab.id}`);
        if (panel) panel.hidden = !active;
    }
    el('ed-grid').setAttribute('aria-pressed', String(state.prefs.showGrid));

    // History
    ui.undo.disabled = state.undoStack.length === 0;
    ui.redo.disabled = state.redoStack.length === 0;

    ui.libCount.textContent = `📂 My maps (${listLevels().length})`;
}

/** What a click on the maze would do right now. */
function toolSummary(state: EditorState): string {
    switch (state.selectedTool) {
        case 'paint': return `Paint ${tileKindOfValue(state.selectedTileValue).label}`;
        case 'erase': return 'Erase';
        case 'fill':  return `Fill ${tileKindOfValue(state.selectedTileValue).label}`;
        case 'move':  return state.armedMarker
            ? `Place ${markerById(state.armedMarker).label}`
            : 'Move objects';
        case 'red_zone':      return 'Red zone';
        case 'slow_zone':     return 'Slow tiles';
    }
}

function updateHoverInfo(state: EditorState): void {
    if (!ui) return;
    const hovered = state.hoveredCell;
    if (!hovered) {
        ui.info.textContent = toolSummary(state);
        return;
    }
    const parts = [`${hovered.x}, ${hovered.y}`];
    parts.push(tileKindOfValue(state.level.tiles[hovered.y][hovered.x]).label);
    const zone = zoneAtTile(state.level, hovered.x, hovered.y);
    if (zone) parts.push(zoneKindById(zone).label);
    const object = markerAtTile(state.level, hovered.x, hovered.y);
    if (object) parts.push(object.label);
    if (isReservedRow(hovered.y)) parts.push('reserved');
    ui.info.textContent = parts.join(' · ');
}

/**
 * Run the checks and say so where it can be seen: a headline in the Level tab,
 * a toast for whoever is looking at the maze rather than the panel, and — since
 * the detail lives in one tab — that tab brought forward.
 */
function runValidation(state: EditorState, reveal = true): ValidationResult {
    const result = validateLevel(state.level, activeTileSet(state));
    if (!ui) return result;

    const errors = result.errors.length;
    const warnings = result.warnings.length;
    const headline = result.valid
        ? `✔ Valid — ${result.smallDots} dots, ${result.powerDots} power pellets`
        : `✘ ${errors} ${errors === 1 ? 'problem' : 'problems'} to fix`
            + (warnings ? `, ${warnings} to check` : '');

    ui.validateResult.innerHTML = '';
    const add = (cls: string, text: string): void => {
        const div = document.createElement('div');
        div.className = cls;
        div.textContent = text;
        ui!.validateResult.appendChild(div);
    };
    add(result.valid ? 'ed-headline ed-ok' : 'ed-headline ed-error', headline);
    for (const error of result.errors)     add('ed-error', `✘ ${error}`);
    for (const warning of result.warnings) add('ed-warning', `⚠ ${warning}`);
    if (result.valid && warnings === 0) add('ed-warning', 'No warnings.');

    if (reveal) {
        setTab(state, 'level');
        // The first problem, by name — more use than "check the panel".
        showToast(result.valid
            ? headline
            : `${headline}: ${result.errors[0]}`);
    }
    return result;
}

// ── Canvas Event Handling ─────────────────────────────────────────────────────

function attachCanvasEvents(state: EditorState): void {
    const canvas = gameState.canvas;

    function onDown(clientX: number, clientY: number): void {
        if (testRunning) return;
        const cell = tileFromCanvas(clientX, clientY);
        if (!cell) return;
        isPainting = true;
        zoneDragMode = null;
        zoneDragSeen.clear();
        beginStroke(state);
        if (applyToolDown(state, cell)) noteChange(state);
    }

    function onMove(clientX: number, clientY: number): void {
        if (testRunning) return;
        const cell = tileFromCanvas(clientX, clientY);
        state.hoveredCell = cell;
        if (state.selectedTool === 'move') {
            const over = cell ? markerAtTile(state.level, cell.x, cell.y) : null;
            canvas.style.cursor = state.draggingMarker ? 'grabbing' : (over ? 'grab' : 'crosshair');
        } else {
            canvas.style.cursor = 'crosshair';
        }
        if (isPainting && cell) {
            if (applyToolDrag(state, cell)) noteChange(state);
        }
    }

    function onUp(): void {
        if (testRunning) return;
        isPainting = false;
        state.draggingMarker = null;
        pendingUndo = null;
    }

    // Mouse
    canvas.addEventListener('mousedown',  (e) => onDown(e.clientX, e.clientY));
    canvas.addEventListener('mousemove',  (e) => onMove(e.clientX, e.clientY));
    canvas.addEventListener('mouseup',    () => onUp());
    canvas.addEventListener('mouseleave', () => { onUp(); state.hoveredCell = null; });

    // Touch
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.touches[0];
        onDown(t.clientX, t.clientY);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const t = e.touches[0];
        onMove(t.clientX, t.clientY);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        onUp();
        state.hoveredCell = null;
    }, { passive: false });
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────

function nudgeArmedMarker(state: EditorState, dx: number, dy: number): void {
    if (!state.armedMarker) return;
    const marker = markerById(state.armedMarker);
    const pos = marker.get(state.level);
    const next = {
        x: Math.min(gridW - 1, Math.max(0, pos.x + dx)),
        y: Math.min(gridH - 1, Math.max(0, pos.y + dy)),
    };
    if (next.x === pos.x && next.y === pos.y) return;

    const occupant = markerAtTile(state.level, Math.floor(next.x), Math.floor(next.y), marker.id);
    if (occupant) {
        showToast(`${occupant.label} is already on that tile`);
        return;
    }

    beginStroke(state);
    marker.set(state.level, next);
    noteChange(state);
}

function attachKeyboardShortcuts(state: EditorState): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        const typing = target instanceof HTMLInputElement
            && (target.type === 'text' || target.type === 'number');
        if (typing || target instanceof HTMLSelectElement) return;

        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (undo(state)) syncToRenderer(state);
            } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
                e.preventDefault();
                if (redo(state)) syncToRenderer(state);
            }
            return;
        }
        if (e.altKey) return;

        const tileByKey = TILE_KINDS.find(k => k.key === e.key);
        if (tileByKey) {
            selectTile(state, tileByKey.value);
            return;
        }

        switch (e.key.toLowerCase()) {
            case 'b': selectTool(state, 'paint'); break;
            case 'e': selectTool(state, 'erase'); break;
            case 'f': selectTool(state, 'fill');  break;
            case 'm': selectTool(state, 'move');  break;
            case 'r': selectTool(state, 'red_zone');  break;
            case 's': selectTool(state, 'slow_zone'); break;
            case 'g': toggleGrid(state); break;
            case 'x':
                setMirrorMode(state, nextMirrorMode(state.prefs.mirrorMode));
                break;
            case 'h':
                setPanelOpen(!panelOpen);
                break;
            case '[':
                state.prefs.brushSize = Math.max(1, state.prefs.brushSize - 1);
                savePrefs(state.prefs);
                state.uiDirty = true;
                break;
            case ']':
                state.prefs.brushSize = Math.min(3, state.prefs.brushSize + 1);
                savePrefs(state.prefs);
                state.uiDirty = true;
                break;
            case 'escape':
                if (state.armedMarker) {
                    state.armedMarker = null;
                    state.uiDirty = true;
                }
                break;
            case 'arrowleft':  e.preventDefault(); nudgeArmedMarker(state, -1,  0); break;
            case 'arrowright': e.preventDefault(); nudgeArmedMarker(state,  1,  0); break;
            case 'arrowup':    e.preventDefault(); nudgeArmedMarker(state,  0, -1); break;
            case 'arrowdown':  e.preventDefault(); nudgeArmedMarker(state,  0,  1); break;
        }
    });
}

// ── Entry Point ───────────────────────────────────────────────────────────────

export function startEditorMode(): void {
    const saved = loadAutosave();
    const initialLevel = saved ?? Levels.level1Data;
    const state = createEditorState(initialLevel, null, loadPrefs());

    syncToRenderer(state);

    const toggle = document.createElement('button');
    toggle.id = 'ed-toggle';
    toggle.type = 'button';
    toggle.textContent = '✏';
    toggle.title = 'Show editor tools (H)';
    toggle.setAttribute('aria-label', 'Show editor tools');
    toggle.onclick = () => setPanelOpen(true);
    document.body.appendChild(toggle);

    buildPanel(state);
    setPanelOpen(true);
    window.addEventListener('resize', layoutCanvas);
    window.addEventListener('orientationchange', layoutCanvas);
    // Keeps working while a play-test owns the canvas, when the editor's own
    // render loop is stopped.
    window.visualViewport?.addEventListener('resize', layoutCanvas);
    window.visualViewport?.addEventListener('scroll', layoutCanvas);

    attachCanvasEvents(state);
    attachKeyboardShortcuts(state);

    startEditorLoop(state);
}
