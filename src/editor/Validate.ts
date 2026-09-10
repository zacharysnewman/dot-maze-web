import { gridW, gridH } from '../constants';
import type { LevelData } from '../types';
import { TILE_WALL, TILE_DOT, TILE_POWER } from '../tiles';
import { EDIT_MAX_Y, EDIT_MIN_Y, isReservedRow } from './Bounds';
import {
    BUDGET_ROWS,
    countUsage,
    isInfinite,
    MARKER_KINDS,
    markersCollide,
    type TileSet,
} from './TileSet';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    /** Dots + power pellets — everything the player must eat. */
    dotCount: number;
    smallDots: number;
    powerDots: number;
}

function isWalkable(level: LevelData, x: number, y: number): boolean {
    const tx = Math.round(x);
    const ty = Math.round(y);
    return tx >= 0 && tx < gridW && ty >= 0 && ty < gridH && level.tiles[ty][tx] > TILE_WALL;
}

export function validateLevel(level: LevelData, tileSet?: TileSet): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Grid dimensions
    if (level.tiles.length !== gridH) {
        errors.push(`Grid must have ${gridH} rows (has ${level.tiles.length})`);
    }
    for (let y = 0; y < Math.min(level.tiles.length, gridH); y++) {
        if (level.tiles[y].length !== gridW) {
            errors.push(`Row ${y} must have ${gridW} columns (has ${level.tiles[y].length})`);
            break;
        }
    }
    if (errors.length > 0) {
        return { valid: false, errors, warnings, dotCount: 0, smallDots: 0, powerDots: 0 };
    }

    // 2. Count collectibles
    let smallDots = 0;
    let powerDots = 0;
    for (const row of level.tiles) {
        for (const t of row) {
            if (t === TILE_DOT)   smallDots++;
            if (t === TILE_POWER) powerDots++;
        }
    }
    const dotCount = smallDots + powerDots;
    if (dotCount === 0) errors.push('Level must contain at least one dot or power pellet');

    // 3. Player spawn must be on a walkable tile
    const ps = level.playerStart;
    if (!isWalkable(level, ps.x, ps.y)) {
        errors.push(`Player spawn (${Math.round(ps.x)}, ${Math.round(ps.y)}) is on a wall`);
    }

    // 4. All enemy spawns must be on walkable tiles
    const enemyEntries: Array<{ name: string; pos: { x: number; y: number } }> = [
        { name: 'Red enemy',     pos: level.enemyStarts.redEnemy     },
        { name: 'Cyan enemy',    pos: level.enemyStarts.cyanEnemy    },
        { name: 'Pink enemy',    pos: level.enemyStarts.hotpinkEnemy },
        { name: 'Orange enemy',  pos: level.enemyStarts.orangeEnemy  },
    ];
    for (const { name, pos } of enemyEntries) {
        if (!isWalkable(level, pos.x, pos.y)) {
            errors.push(`${name} spawn (${Math.round(pos.x)}, ${Math.round(pos.y)}) is on a wall`);
        }
    }

    // 5. Fruit spawn must be on a walkable tile
    const fs = level.fruitSpawn;
    if (!isWalkable(level, fs.x, fs.y)) {
        warnings.push(`Fruit spawn (${Math.round(fs.x)}, ${Math.round(fs.y)}) is on a wall`);
    }

    // 6. A row open at one end only has nowhere to wrap to
    const oneSided: number[] = [];
    for (let y = 0; y < gridH; y++) {
        const left  = level.tiles[y][0] > TILE_WALL;
        const right = level.tiles[y][gridW - 1] > TILE_WALL;
        if (left !== right) oneSided.push(y);
    }
    if (oneSided.length > 0) {
        warnings.push(
            `Row(s) ${oneSided.join(', ')} are open at one edge only — nothing wraps there, `
            + 'so that end is a dead end',
        );
    }

    // 6b. Slow tiles on walls do nothing — enemies can never stand there
    const strandedSlow = level.tunnelSlowTiles.filter(
        t => !isWalkable(level, t.x, t.y),
    ).length;
    if (strandedSlow > 0) {
        warnings.push(`${strandedSlow} slow tile(s) sit on walls, where no enemy can reach them`);
    }

    // 7. BFS reachability from player start (respect tunnel wrapping)
    const startX = Math.round(ps.x);
    const startY = Math.round(ps.y);
    const reachable = new Set<string>();
    const queue: Array<{ x: number; y: number }> = [];

    if (startX >= 0 && startX < gridW && startY >= 0 && startY < gridH &&
        level.tiles[startY][startX] > TILE_WALL) {
        queue.push({ x: startX, y: startY });
    }

    while (queue.length > 0) {
        const { x, y } = queue.shift()!;
        const key = `${x},${y}`;
        if (reachable.has(key)) continue;
        if (x < 0 || x >= gridW || y < 0 || y >= gridH) continue;
        if (level.tiles[y][x] === TILE_WALL) continue;
        reachable.add(key);

        // Tunnel wrapping wherever the row is open at both edges
        if (level.tiles[y][0] > TILE_WALL && level.tiles[y][gridW - 1] > TILE_WALL) {
            if (x === 0)          queue.push({ x: gridW - 1, y });
            if (x === gridW - 1)  queue.push({ x: 0, y });
        }
        queue.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 });
    }

    // Check all dots are reachable
    let unreachableDot = false;
    for (let y = 0; y < gridH && !unreachableDot; y++) {
        for (let x = 0; x < gridW && !unreachableDot; x++) {
            const t = level.tiles[y][x];
            if ((t === TILE_DOT || t === TILE_POWER) && !reachable.has(`${x},${y}`)) {
                errors.push('Some dots are unreachable from the player spawn position');
                unreachableDot = true;
            }
        }
    }

    // 8. Level name should not be empty
    if (!level.name || level.name.trim() === '') {
        warnings.push('Level has no name');
    }

    // 9. Tile set budgets — an over-budget level is an editor-side error only,
    //    the level still loads and plays fine.
    const usage = countUsage(level);
    if (tileSet) {
        for (const { key, label } of BUDGET_ROWS) {
            const budget = tileSet.budgets[key];
            if (isInfinite(budget)) continue;
            if (usage[key] > budget) {
                errors.push(
                    `${label}: ${usage[key]} placed, "${tileSet.name}" tile set allows ${budget}`,
                );
            }
        }
    }

    // 10. Ghost house sanity
    if (usage.door === 0) {
        warnings.push('No ghost door tiles — ghosts will not have a gate to pass through');
    }
    if (powerDots === 0) {
        warnings.push('No power pellets — ghosts can never be frightened');
    }

    // 11. Collectibles hidden under the HUD (possible in imported levels — the
    //     editor itself will not paint there)
    let hiddenPellets = 0;
    for (let y = 0; y < gridH; y++) {
        if (!isReservedRow(y)) continue;
        for (let x = 0; x < gridW; x++) {
            const t = level.tiles[y][x];
            if (t === TILE_DOT || t === TILE_POWER) hiddenPellets++;
        }
    }
    if (hiddenPellets > 0) {
        warnings.push(
            `${hiddenPellets} pellet(s) sit outside rows ${EDIT_MIN_Y}–${EDIT_MAX_Y}, ` +
            `where the score and lives display covers them`,
        );
    }

    // 12. One zone to a tile
    const redKeys = new Set(level.redZoneTiles.map(t => `${t.x},${t.y}`));
    const doubleZoned = level.tunnelSlowTiles.filter(t => redKeys.has(`${t.x},${t.y}`)).length;
    if (doubleZoned > 0) {
        warnings.push(`${doubleZoned} tile(s) are marked as both a red zone and a slow tile`);
    }

    // 13. One movable object to a tile
    for (let i = 0; i < MARKER_KINDS.length; i++) {
        for (let j = i + 1; j < MARKER_KINDS.length; j++) {
            const a = MARKER_KINDS[i];
            const b = MARKER_KINDS[j];
            if (markersCollide(a.get(level), b.get(level))) {
                warnings.push(`${a.label} and ${b.label} share a tile`);
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings, dotCount, smallDots, powerDots };
}
