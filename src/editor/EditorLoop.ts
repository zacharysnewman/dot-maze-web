import { unit, gridW, gridH } from '../constants';
import { gameState } from '../game-state';
import { Levels } from '../static/Levels';
import { Draw } from '../static/Draw';
import type { TileValue } from '../types';
import { TILE_EMPTY, TILE_WALL, TILE_GHOST_DOOR, TILE_DOT, TILE_POWER } from '../tiles';
import {
    createEditorState,
    pushUndo,
    undo,
    redo,
    type EditorState,
    type EditorTool,
} from './EditorState';

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

function syncToRenderer(state: EditorState): void {
    gameState.currentLevel = state.level;
    Levels.levelDynamic = state.level.tiles.map(row => [...row] as TileValue[]);
}

// ── Tool Application ──────────────────────────────────────────────────────────

let isPainting = false;
let redZoneDragMode: 'add' | 'remove' | null = null;
const redZoneDragSeen = new Set<string>();

function applyToolDown(state: EditorState, cell: { x: number; y: number }): void {
    const { x, y } = cell;
    switch (state.selectedTool) {
        case 'paint':
        case 'erase': {
            const newTile: TileValue = state.selectedTool === 'erase'
                ? TILE_EMPTY as TileValue
                : state.selectedTileValue;
            state.level.tiles[y][x] = newTile;
            Levels.levelDynamic[y][x] = newTile;
            break;
        }
        case 'player_spawn':
            state.level.playerStart = { x, y };
            break;
        case 'enemy_blinky':
            state.level.enemyStarts.blinky = { x, y };
            break;
        case 'enemy_inky':
            state.level.enemyStarts.inky = { x, y };
            break;
        case 'enemy_pinky':
            state.level.enemyStarts.pinky = { x, y };
            break;
        case 'enemy_clyde':
            state.level.enemyStarts.clyde = { x, y };
            break;
        case 'fruit_spawn':
            state.level.fruitSpawn = { x, y };
            break;
        case 'enemy_house_door':
            state.level.enemyHouseDoor = { x, y };
            break;
        case 'tunnel_config':
            state.level.tunnelRow = y;
            break;
        case 'red_zone': {
            const key = `${x},${y}`;
            const idx = state.level.redZoneTiles.findIndex(t => t.x === x && t.y === y);
            if (idx >= 0) {
                redZoneDragMode = 'remove';
                state.level.redZoneTiles.splice(idx, 1);
            } else {
                redZoneDragMode = 'add';
                state.level.redZoneTiles.push({ x, y });
            }
            redZoneDragSeen.add(key);
            break;
        }
    }
}

function applyToolDrag(state: EditorState, cell: { x: number; y: number }): void {
    const { x, y } = cell;
    switch (state.selectedTool) {
        case 'paint':
        case 'erase': {
            const newTile: TileValue = state.selectedTool === 'erase'
                ? TILE_EMPTY as TileValue
                : state.selectedTileValue;
            state.level.tiles[y][x] = newTile;
            Levels.levelDynamic[y][x] = newTile;
            break;
        }
        case 'player_spawn':   state.level.playerStart = { x, y }; break;
        case 'enemy_blinky':   state.level.enemyStarts.blinky = { x, y }; break;
        case 'enemy_inky':     state.level.enemyStarts.inky   = { x, y }; break;
        case 'enemy_pinky':    state.level.enemyStarts.pinky  = { x, y }; break;
        case 'enemy_clyde':    state.level.enemyStarts.clyde  = { x, y }; break;
        case 'fruit_spawn':    state.level.fruitSpawn        = { x, y }; break;
        case 'enemy_house_door': state.level.enemyHouseDoor  = { x, y }; break;
        case 'tunnel_config':  state.level.tunnelRow = y; break;
        case 'red_zone': {
            const key = `${x},${y}`;
            if (redZoneDragSeen.has(key)) break;
            redZoneDragSeen.add(key);
            const idx = state.level.redZoneTiles.findIndex(t => t.x === x && t.y === y);
            if (redZoneDragMode === 'add' && idx < 0) {
                state.level.redZoneTiles.push({ x, y });
            } else if (redZoneDragMode === 'remove' && idx >= 0) {
                state.level.redZoneTiles.splice(idx, 1);
            }
            break;
        }
    }
}

// ── Overlay Rendering ─────────────────────────────────────────────────────────

function drawSpawnMarker(
    ctx: CanvasRenderingContext2D,
    pos: { x: number; y: number },
    color: string,
    label: string,
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
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(unit * 0.38)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px, py);
    ctx.restore();
}

function drawEditorOverlay(state: EditorState, ctx: CanvasRenderingContext2D): void {
    const lv = state.level;

    // Tunnel row highlight
    ctx.save();
    ctx.fillStyle = 'rgba(0,200,255,0.12)';
    ctx.fillRect(0, lv.tunnelRow * unit, gridW * unit, unit);
    ctx.restore();

    // Red zone tile markers
    ctx.save();
    ctx.fillStyle = 'rgba(255,0,0,0.28)';
    for (const t of lv.redZoneTiles) {
        ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
    }
    ctx.restore();

    // Enemy house door highlight
    ctx.save();
    ctx.strokeStyle = 'rgba(255,180,255,0.9)';
    ctx.lineWidth = 2;
    const d = lv.enemyHouseDoor;
    ctx.strokeRect(d.x * unit + 1, d.y * unit + 1, unit - 2, unit - 2);
    ctx.restore();

    // Spawn markers
    drawSpawnMarker(ctx, lv.playerStart,         'yellow',   'P');
    drawSpawnMarker(ctx, lv.enemyStarts.blinky,  '#FF3333',  'B');
    drawSpawnMarker(ctx, lv.enemyStarts.inky,    '#00FFFF',  'I');
    drawSpawnMarker(ctx, lv.enemyStarts.pinky,   '#FFB8FF',  'Pi');
    drawSpawnMarker(ctx, lv.enemyStarts.clyde,   '#FFB852',  'C');
    drawSpawnMarker(ctx, lv.fruitSpawn,          '#FF6600',  'F');

    // Grid lines
    if (state.showGrid) {
        ctx.save();
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
        ctx.restore();
    }

    // Hover cell highlight
    if (state.hoveredCell) {
        const { x, y } = state.hoveredCell;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x * unit, y * unit, unit, unit);
        ctx.restore();
    }
}

// ── rAF Loop ──────────────────────────────────────────────────────────────────

let infoEl: HTMLElement | null = null;

function editorLoop(state: EditorState): void {
    Draw.level();
    drawEditorOverlay(state, gameState.ctx);

    if (infoEl) {
        const h = state.hoveredCell;
        infoEl.textContent = h ? `(${h.x}, ${h.y})` : '';
    }

    requestAnimationFrame(() => editorLoop(state));
}

// ── Panel UI ──────────────────────────────────────────────────────────────────

const PALETTE: Array<{ value: TileValue; label: string; bg: string }> = [
    { value: TILE_WALL       as TileValue, label: 'Wall',  bg: '#1a1ab0' },
    { value: TILE_GHOST_DOOR as TileValue, label: 'Door',  bg: '#3a1a2a' },
    { value: TILE_DOT        as TileValue, label: 'Dot',   bg: '#111' },
    { value: TILE_POWER      as TileValue, label: 'Power', bg: '#1a1a00' },
    { value: TILE_EMPTY      as TileValue, label: 'Empty', bg: '#0a0a1a' },
];

const SPAWN_BTNS: Array<{ tool: EditorTool; label: string; color: string }> = [
    { tool: 'player_spawn',   label: 'P Player', color: 'yellow'   },
    { tool: 'enemy_blinky',   label: 'B Blinky', color: '#FF3333'  },
    { tool: 'enemy_inky',     label: 'I Inky',   color: '#00FFFF'  },
    { tool: 'enemy_pinky',    label: 'Pi Pinky', color: '#FFB8FF'  },
    { tool: 'enemy_clyde',    label: 'C Clyde',  color: '#FFB852'  },
    { tool: 'fruit_spawn',    label: 'F Fruit',  color: '#FF6600'  },
    { tool: 'enemy_house_door', label: '🚪 Door', color: 'lightpink' },
];

const SPECIAL_BTNS: Array<{ tool: EditorTool; label: string }> = [
    { tool: 'tunnel_config', label: '~ Tunnel Row' },
    { tool: 'red_zone',      label: '⊕ Red Zone'   },
];

function buildPanel(state: EditorState): void {
    const panel = document.createElement('div');
    panel.id = 'editor-panel';
    panel.innerHTML = `
        <style>
        #editor-panel {
            position: fixed; top: 12px; right: 12px;
            background: rgba(0,0,0,0.92); color: #eee;
            padding: 14px 16px 18px; border: 2px solid #666;
            border-radius: 8px; z-index: 100;
            font-family: monospace; font-size: 18px;
            display: flex; flex-direction: column; gap: 10px;
            width: 170px; max-height: calc(100vh - 24px); overflow-y: auto;
            touch-action: none;
        }
        #editor-panel h3 { font-size: 20px; color: #ff0; margin: 0; }
        #editor-panel .ed-section { display: flex; flex-direction: column; gap: 5px; }
        #editor-panel .ed-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        #editor-panel button {
            background: #222; color: #eee; border: 1px solid #555;
            border-radius: 4px; padding: 7px 6px; cursor: pointer;
            font-family: monospace; font-size: 14px; text-align: left;
            touch-action: manipulation; white-space: nowrap; overflow: hidden;
        }
        #editor-panel button:active, #editor-panel button.active {
            background: #333; border-color: #ff0; color: #ff0;
        }
        #editor-panel .ed-swatch {
            display: flex; align-items: center; gap: 6px;
            padding: 5px; border: 2px solid transparent;
            border-radius: 4px; cursor: pointer; touch-action: manipulation;
        }
        #editor-panel .ed-swatch.active { border-color: #ff0; }
        #editor-panel .ed-swatch-box {
            width: 18px; height: 18px; border-radius: 2px; border: 1px solid #555; flex-shrink: 0;
        }
        #editor-panel .ed-row { display: flex; gap: 5px; }
        #editor-panel .ed-row button { flex: 1; text-align: center; }
        #editor-panel label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 15px; }
        #editor-panel label input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; accent-color: #ff0; }
        #ed-info { font-size: 13px; color: #888; min-height: 1em; }
        </style>
        <h3>✏ EDITOR</h3>

        <div class="ed-section">
            <div class="ed-label">Tile</div>
            <div id="ed-palette"></div>
        </div>

        <div class="ed-section">
            <div class="ed-label">Tool</div>
            <button id="ed-tool-paint">✏ Paint</button>
            <button id="ed-tool-erase">◻ Erase</button>
        </div>

        <div class="ed-section">
            <div class="ed-label">Spawns</div>
            <div id="ed-spawns"></div>
        </div>

        <div class="ed-section">
            <div class="ed-label">Special</div>
            <div id="ed-special"></div>
        </div>

        <div class="ed-section">
            <label><input type="checkbox" id="ed-grid" checked> Grid</label>
        </div>

        <div class="ed-section">
            <div class="ed-row">
                <button id="ed-undo">↩ Undo</button>
                <button id="ed-redo">↪ Redo</button>
            </div>
        </div>

        <div id="ed-info"></div>
    `;
    document.body.appendChild(panel);

    // Stop all input events from bubbling to canvas handlers
    panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('click',      (e) => e.stopPropagation());
    panel.addEventListener('mousedown',  (e) => e.stopPropagation());
    panel.addEventListener('mouseup',    (e) => e.stopPropagation());

    infoEl = document.getElementById('ed-info');

    // Shared tool-refresh — highlights the active tool across all sections
    const allToolBtnIds: Partial<Record<EditorTool, string>> = {};

    function refreshAllTools(): void {
        for (const [tool, id] of Object.entries(allToolBtnIds)) {
            document.getElementById(id!)?.classList.toggle('active', state.selectedTool === tool);
        }
        // Palette active state
        document.querySelectorAll<HTMLElement>('#ed-palette .ed-swatch').forEach((el) => {
            const val = Number(el.dataset.tileValue) as TileValue;
            el.classList.toggle('active', state.selectedTool === 'paint' && state.selectedTileValue === val);
        });
    }

    // Palette
    const paletteEl = document.getElementById('ed-palette')!;
    for (const entry of PALETTE) {
        const swatch = document.createElement('div');
        swatch.className = 'ed-swatch';
        swatch.dataset.tileValue = String(entry.value);
        swatch.innerHTML = `<div class="ed-swatch-box" style="background:${entry.bg}"></div><span>${entry.label}</span>`;
        const select = (): void => {
            state.selectedTileValue = entry.value;
            state.selectedTool = 'paint';
            refreshAllTools();
        };
        swatch.addEventListener('click', select);
        swatch.addEventListener('touchend', (e) => { e.preventDefault(); select(); });
        paletteEl.appendChild(swatch);
    }

    // Paint / Erase
    const paintBtnId = 'ed-tool-paint';
    const eraseBtnId = 'ed-tool-erase';
    allToolBtnIds['paint'] = paintBtnId;
    allToolBtnIds['erase'] = eraseBtnId;

    const paintBtn = document.getElementById(paintBtnId) as HTMLButtonElement;
    const eraseBtn = document.getElementById(eraseBtnId) as HTMLButtonElement;
    paintBtn.onclick = () => { state.selectedTool = 'paint'; refreshAllTools(); };
    eraseBtn.onclick = () => { state.selectedTool = 'erase'; refreshAllTools(); };

    // Spawn buttons
    const spawnsEl = document.getElementById('ed-spawns')!;
    for (const entry of SPAWN_BTNS) {
        const btn = document.createElement('button');
        btn.id = `ed-tool-${entry.tool}`;
        btn.style.color = entry.color;
        btn.textContent = entry.label;
        allToolBtnIds[entry.tool] = btn.id;
        btn.onclick = () => { state.selectedTool = entry.tool; refreshAllTools(); };
        spawnsEl.appendChild(btn);
    }

    // Special buttons
    const specialEl = document.getElementById('ed-special')!;
    for (const entry of SPECIAL_BTNS) {
        const btn = document.createElement('button');
        btn.id = `ed-tool-${entry.tool}`;
        btn.textContent = entry.label;
        allToolBtnIds[entry.tool] = btn.id;
        btn.onclick = () => { state.selectedTool = entry.tool; refreshAllTools(); };
        specialEl.appendChild(btn);
    }

    // Grid toggle
    const gridCheck = document.getElementById('ed-grid') as HTMLInputElement;
    gridCheck.onchange = () => { state.showGrid = gridCheck.checked; };

    // Undo / Redo
    const undoBtn = document.getElementById('ed-undo') as HTMLButtonElement;
    const redoBtn = document.getElementById('ed-redo') as HTMLButtonElement;
    undoBtn.onclick = () => { undo(state); syncToRenderer(state); };
    redoBtn.onclick = () => { redo(state); syncToRenderer(state); };

    // Initial state
    refreshAllTools();
}

// ── Canvas Event Handling ─────────────────────────────────────────────────────

function attachCanvasEvents(state: EditorState): void {
    const canvas = gameState.canvas;

    function onDown(clientX: number, clientY: number): void {
        const cell = tileFromCanvas(clientX, clientY);
        if (!cell) return;
        isPainting = true;
        redZoneDragMode = null;
        redZoneDragSeen.clear();
        pushUndo(state);
        applyToolDown(state, cell);
    }

    function onMove(clientX: number, clientY: number): void {
        const cell = tileFromCanvas(clientX, clientY);
        state.hoveredCell = cell;
        if (isPainting && cell) applyToolDrag(state, cell);
    }

    function onUp(): void { isPainting = false; }

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
    }, { passive: false });
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────

function attachKeyboardShortcuts(state: EditorState): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo(state);
                syncToRenderer(state);
            } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
                e.preventDefault();
                redo(state);
                syncToRenderer(state);
            }
        }
    });
}

// ── Entry Point ───────────────────────────────────────────────────────────────

export function startEditorMode(): void {
    const state = createEditorState(Levels.level1Data);

    // Wire level into the renderer
    gameState.currentLevel = state.level;
    Levels.levelSetup   = state.level.tiles;
    Levels.levelDynamic = state.level.tiles.map(row => [...row] as TileValue[]);

    buildPanel(state);
    attachCanvasEvents(state);
    attachKeyboardShortcuts(state);

    requestAnimationFrame(() => editorLoop(state));
}
