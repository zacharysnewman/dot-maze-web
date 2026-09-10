// Brings levels saved by older versions of the editor up to the current shape.
//
// Applied wherever the editor ingests level JSON it did not just produce:
// the autosave slot, the library, and file import.

import { gridW, gridH } from '../constants';
import type { LevelData } from '../types';

/** Fields older saves carried instead of `tunnelSlowTiles`. */
interface LegacyLevel {
    tunnelSlowColMax?: number;
    tunnelSlowColMin?: number;
    tunnelRow?: number;
    tunnelRows?: number[];
}

/**
 * Slow tunnel tiles used to be a pair of column bounds applied to the tunnel
 * row. Expand them into the tile list they described, so an old level keeps
 * exactly the slow tiles it had.
 */
export function migrateLevel(level: LevelData): LevelData {
    // Levels used to declare where they wrapped, first as one row and then as a
    // list. It is read from the tiles now: a row wraps when both of its end
    // tiles are walkable, which is what the game always actually did.
    const legacy = level as unknown as LegacyLevel;
    const legacyRows = Array.isArray(legacy.tunnelRows)
        ? legacy.tunnelRows
        : typeof legacy.tunnelRow === 'number' ? [legacy.tunnelRow] : [];
    delete legacy.tunnelRow;
    delete legacy.tunnelRows;

    if (!Array.isArray(level.tunnelSlowTiles)) {
        const legacy = level as unknown as LegacyLevel;
        const row = legacyRows[0];
        const tiles: Array<{ x: number; y: number }> = [];
        if (typeof row === 'number' && row >= 0 && row < gridH) {
            const max = typeof legacy.tunnelSlowColMax === 'number' ? legacy.tunnelSlowColMax : -1;
            const min = typeof legacy.tunnelSlowColMin === 'number' ? legacy.tunnelSlowColMin : gridW;
            for (let x = 0; x < gridW; x++) {
                if (x <= max || x >= min) tiles.push({ x, y: row });
            }
        }
        level.tunnelSlowTiles = tiles;
    }
    delete (level as unknown as LegacyLevel).tunnelSlowColMax;
    delete (level as unknown as LegacyLevel).tunnelSlowColMin;

    // A tile carries at most one zone. Hand-edited or pre-exclusivity files can
    // list the same tile twice; the red zone wins, matching the editor's order.
    if (Array.isArray(level.redZoneTiles)) {
        const red = new Set(level.redZoneTiles.map(t => `${t.x},${t.y}`));
        level.tunnelSlowTiles = level.tunnelSlowTiles.filter(t => !red.has(`${t.x},${t.y}`));
    }
    return level;
}
