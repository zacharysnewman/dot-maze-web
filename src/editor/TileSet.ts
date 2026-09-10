// Editor-only "tile set" model: how many of each thing a level is allowed to
// contain, and what the placeable things are.
//
// Nothing here touches the saved level format or game logic — a tile set is
// purely an authoring constraint that lives in the editor. Budgets are counts;
// INFINITE (-1) means "place as many as you like".

import { Levels } from '../static/Levels';
import { TILE_WALL, TILE_ENEMY_DOOR, TILE_DOT, TILE_POWER, TILE_EMPTY } from '../tiles';
import type { LevelData, TileValue } from '../types';

/** Budget value meaning "unlimited". */
export const INFINITE = -1;

// ── Placeable kinds ───────────────────────────────────────────────────────────

/** Things painted into the tile grid. */
export type TileKindId = 'wall' | 'empty' | 'dot' | 'power' | 'door';
/** Things toggled per-tile but stored as a coordinate list. */
export type ZoneKindId = 'red_zone' | 'slow_zone';
/** Single movable objects — exactly one of each exists in a level. */
export type MarkerKindId =
    | 'player'
    | 'enemy_red'
    | 'enemy_cyan'
    | 'enemy_hotpink'
    | 'enemy_orange'
    | 'fruit'
    | 'scatter_red'
    | 'scatter_cyan'
    | 'scatter_hotpink'
    | 'scatter_orange';

/** Everything a tile set carries a budget for. */
export type BudgetKey = TileKindId | ZoneKindId;

export interface TileKind {
    id: TileKindId;
    value: TileValue;
    label: string;
    /** Palette swatch background. */
    swatch: string;
    /** One-line explanation shown as a tooltip. */
    hint: string;
    /** Digit shortcut in the palette. */
    key: string;
    /**
     * Kinds without a palette entry. The enemy door only makes sense inside the
     * fixed enemy house, which the editor does not let you change, so it is
     * still counted and drawn — just never painted.
     */
    paintable?: boolean;
}

export const TILE_KINDS: readonly TileKind[] = [
    {
        id: 'wall', value: TILE_WALL as TileValue, label: 'Wall', swatch: '#1a1ab0', key: '1',
        hint: 'Solid wall — nothing can pass through it',
    },
    {
        id: 'empty', value: TILE_EMPTY as TileValue, label: 'Empty', swatch: '#0a0a1a', key: '2',
        hint: 'Open corridor with no collectible',
    },
    {
        id: 'dot', value: TILE_DOT as TileValue, label: 'Dot', swatch: '#c9c48a', key: '3',
        hint: 'Small pellet — counts toward clearing the level',
    },
    {
        id: 'power', value: TILE_POWER as TileValue, label: 'Power', swatch: '#fff2a8', key: '4',
        hint: 'Power pellet — frightens the enemies',
    },
    {
        id: 'door', value: TILE_ENEMY_DOOR as TileValue, label: 'Enemy Door', swatch: '#ff9de0',
        key: '', paintable: false,
        hint: 'Gate the enemies pass through — part of the fixed enemy house',
    },
] as const;

/** The kinds the palette offers. */
export const PAINTABLE_TILE_KINDS: readonly TileKind[] =
    TILE_KINDS.filter(k => k.paintable !== false);

export function tileKindOfValue(value: TileValue): TileKind {
    return TILE_KINDS.find(k => k.value === value) ?? tileKindById('empty');
}

export function tileKindById(id: TileKindId): TileKind {
    return TILE_KINDS.find(k => k.id === id)!;
}

// ── Markers: one movable object each ──────────────────────────────────────────

export interface MarkerKind {
    id: MarkerKindId;
    label: string;
    /** Single character drawn inside the on-canvas marker. */
    badge: string;
    color: string;
    /** 'spawn' markers sit on the maze; 'scatter' markers are AI corner targets. */
    group: 'spawn' | 'scatter';
    /** Fixed markers cannot be moved — the game hardcodes where they belong. */
    fixed?: boolean;
    hint: string;
    get(level: LevelData): { x: number; y: number };
    set(level: LevelData, pos: { x: number; y: number }): void;
}

export const MARKER_KINDS: readonly MarkerKind[] = [
    {
        id: 'player', label: 'Player', badge: 'P', color: 'yellow', group: 'spawn',
        hint: 'Where the player starts each life',
        get: lv => lv.playerStart,
        set: (lv, p) => { lv.playerStart = p; },
    },
    {
        id: 'enemy_red', fixed: true, label: 'Red enemy', badge: 'R', color: '#FF3333', group: 'spawn',
        hint: 'Red enemy starting point',
        get: lv => lv.enemyStarts.redEnemy,
        set: (lv, p) => { lv.enemyStarts.redEnemy = p; },
    },
    {
        id: 'enemy_cyan', fixed: true, label: 'Cyan enemy', badge: 'C', color: '#00FFFF', group: 'spawn',
        hint: 'Cyan enemy starting point',
        get: lv => lv.enemyStarts.cyanEnemy,
        set: (lv, p) => { lv.enemyStarts.cyanEnemy = p; },
    },
    {
        id: 'enemy_hotpink', fixed: true, label: 'Pink enemy', badge: 'H', color: '#FFB8FF', group: 'spawn',
        hint: 'Pink enemy starting point',
        get: lv => lv.enemyStarts.hotpinkEnemy,
        set: (lv, p) => { lv.enemyStarts.hotpinkEnemy = p; },
    },
    {
        id: 'enemy_orange', fixed: true, label: 'Orange enemy', badge: 'O', color: '#FFB852', group: 'spawn',
        hint: 'Orange enemy starting point',
        get: lv => lv.enemyStarts.orangeEnemy,
        set: (lv, p) => { lv.enemyStarts.orangeEnemy = p; },
    },
    {
        id: 'fruit', label: 'Fruit', badge: 'F', color: '#FF6600', group: 'spawn',
        hint: 'Where bonus fruit appears',
        get: lv => lv.fruitSpawn,
        set: (lv, p) => { lv.fruitSpawn = p; },
    },
    {
        id: 'scatter_red', label: 'Red target', badge: '✕', color: '#FF3333', group: 'scatter',
        hint: 'Corner the red enemy retreats to in scatter mode',
        get: lv => lv.scatterTargets.redEnemy,
        set: (lv, p) => { lv.scatterTargets.redEnemy = p; },
    },
    {
        id: 'scatter_cyan', label: 'Cyan target', badge: '✕', color: '#00FFFF', group: 'scatter',
        hint: 'Corner the cyan enemy retreats to in scatter mode',
        get: lv => lv.scatterTargets.cyanEnemy,
        set: (lv, p) => { lv.scatterTargets.cyanEnemy = p; },
    },
    {
        id: 'scatter_hotpink', label: 'Pink target', badge: '✕', color: '#FFB8FF', group: 'scatter',
        hint: 'Corner the pink enemy retreats to in scatter mode',
        get: lv => lv.scatterTargets.hotpinkEnemy,
        set: (lv, p) => { lv.scatterTargets.hotpinkEnemy = p; },
    },
    {
        id: 'scatter_orange', label: 'Orange target', badge: '✕', color: '#FFB852', group: 'scatter',
        hint: 'Corner the orange enemy retreats to in scatter mode',
        get: lv => lv.scatterTargets.orangeEnemy,
        set: (lv, p) => { lv.scatterTargets.orangeEnemy = p; },
    },
] as const;

export function markerById(id: MarkerKindId): MarkerKind {
    return MARKER_KINDS.find(m => m.id === id)!;
}

/**
 * The tiles a movable object sits on. A half-tile position (e.g. x = 13.5)
 * straddles two columns, so it occupies both — which is what it looks like on
 * the canvas, and what decides whether two objects collide.
 */
export function markerTiles(pos: { x: number; y: number }): Array<{ x: number; y: number }> {
    const xs = [...new Set([Math.floor(pos.x), Math.round(pos.x)])];
    const ys = [...new Set([Math.floor(pos.y), Math.round(pos.y)])];
    return xs.flatMap(x => ys.map(y => ({ x, y })));
}

export function markerOccupies(pos: { x: number; y: number }, x: number, y: number): boolean {
    return markerTiles(pos).some(t => t.x === x && t.y === y);
}

/** True when two objects would share a tile — objects are one to a tile. */
export function markersCollide(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    return markerTiles(a).some(t => markerOccupies(b, t.x, t.y));
}

/**
 * The marker occupying a tile, if any: what the move tool grabs, and what
 * blocks another object from being dropped there. Spawn markers win over
 * scatter targets when they overlap.
 */
export function markerAtTile(
    level: LevelData,
    x: number,
    y: number,
    exclude?: MarkerKindId,
): MarkerKind | null {
    for (const group of ['spawn', 'scatter'] as const) {
        for (const m of MARKER_KINDS) {
            if (m.group !== group || m.id === exclude) continue;
            if (markerOccupies(m.get(level), x, y)) return m;
        }
    }
    return null;
}

// ── Usage counting ────────────────────────────────────────────────────────────

export type Usage = Record<BudgetKey, number>;

export function emptyUsage(): Usage {
    return { wall: 0, empty: 0, dot: 0, power: 0, door: 0, red_zone: 0, slow_zone: 0 };
}

/** The two per-tile zones, which live as coordinate lists rather than tile values. */
export const ZONE_KINDS: readonly {
    id: ZoneKindId;
    label: string;
    hint: string;
    tiles(level: LevelData): Array<{ x: number; y: number }>;
}[] = [
    {
        id: 'red_zone', label: 'Red zone',
        hint: 'Junctions where enemies may not turn upward in scatter or chase mode',
        tiles: lv => lv.redZoneTiles,
    },
    {
        id: 'slow_zone', label: 'Slow tiles',
        hint: 'Tiles where enemies crawl — the warp-tunnel mouths',
        tiles: lv => lv.tunnelSlowTiles,
    },
] as const;

export function zoneKindById(id: ZoneKindId): (typeof ZONE_KINDS)[number] {
    return ZONE_KINDS.find(z => z.id === id)!;
}

/** The single zone on a tile, if any — zones are mutually exclusive. */
export function zoneAtTile(level: LevelData, x: number, y: number): ZoneKindId | null {
    for (const zone of ZONE_KINDS) {
        if (zone.tiles(level).some(t => t.x === x && t.y === y)) return zone.id;
    }
    return null;
}

/** Count everything a tile set budgets, from a level's actual contents. */
export function countUsage(level: LevelData): Usage {
    const usage = emptyUsage();
    for (const row of level.tiles) {
        for (const value of row) {
            usage[tileKindOfValue(value).id]++;
        }
    }
    usage.red_zone  = level.redZoneTiles.length;
    usage.slow_zone = level.tunnelSlowTiles.length;
    return usage;
}

// ── Tile sets ─────────────────────────────────────────────────────────────────

export interface TileSet {
    id: string;
    name: string;
    description: string;
    budgets: Usage;
}

/** Budgets taken straight from the built-in Classic map. */
function classicBudgets(): Usage {
    const counted = countUsage(Levels.level1Data);
    return {
        wall:      INFINITE,
        empty:     INFINITE,
        dot:       counted.dot,
        power:     counted.power,
        door:      counted.door,
        // Zones are a design choice rather than a stock of pieces, so they are
        // counted but never capped.
        red_zone:  INFINITE,
        slow_zone: INFINITE,
    };
}

const CLASSIC = classicBudgets();

export const TILE_SETS: readonly TileSet[] = [
    {
        id: 'classic',
        name: 'Classic',
        description: `Exactly the main map's stock: ${CLASSIC.dot} dots, ${CLASSIC.power} power pellets.`,
        budgets: CLASSIC,
    },
    {
        id: 'extended',
        name: 'Extended',
        description: 'Room for a bigger maze — half again as many dots, twice the pellets.',
        budgets: {
            wall:      INFINITE,
            empty:     INFINITE,
            dot:       Math.round(CLASSIC.dot * 1.5),
            power:     CLASSIC.power * 2,
            door:      CLASSIC.door * 2,
            red_zone:  INFINITE,
            slow_zone: INFINITE,
        },
    },
    {
        id: 'sandbox',
        name: 'Sandbox',
        description: 'No limits at all. Handy while blocking out a layout.',
        budgets: {
            wall: INFINITE, empty: INFINITE, dot: INFINITE, power: INFINITE,
            door: INFINITE, red_zone: INFINITE, slow_zone: INFINITE,
        },
    },
] as const;

export const DEFAULT_TILE_SET_ID = 'classic';

export function getTileSet(id: string | null | undefined): TileSet {
    return TILE_SETS.find(t => t.id === id) ?? TILE_SETS[0];
}

// ── Budget queries ────────────────────────────────────────────────────────────

export function isInfinite(budget: number): boolean {
    return budget === INFINITE;
}

export function budgetOf(tileSet: TileSet, key: BudgetKey): number {
    return tileSet.budgets[key];
}

/** How many more of `key` may be placed. Infinity when the budget is unlimited. */
export function remainingOf(tileSet: TileSet, usage: Usage, key: BudgetKey): number {
    const budget = tileSet.budgets[key];
    if (isInfinite(budget)) return Infinity;
    return budget - usage[key];
}

/** "12 / 240" or "12 / ∞" — for the budget readout. */
export function formatBudget(used: number, budget: number): string {
    return `${used} / ${isInfinite(budget) ? '∞' : budget}`;
}

/** Budget rows worth showing in the panel, in display order. */
export const BUDGET_ROWS: readonly { key: BudgetKey; label: string }[] = [
    { key: 'dot',      label: 'Dots'      },
    { key: 'power',    label: 'Power'     },
    { key: 'red_zone',  label: 'Red zones' },
    { key: 'slow_zone', label: 'Slow tiles' },
    { key: 'wall',      label: 'Walls'     },
] as const;
