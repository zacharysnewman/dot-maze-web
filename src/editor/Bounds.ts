// Which tiles the editor lets you paint.
//
// The grid is 28 × 36, but the game draws its HUD over the outermost rows, so
// maze content there is hidden in play:
//
//   row 0  — "1UP" / "HIGH SCORE" / level
//   row 1  — the score digits
//   row 35 — lives and the fruit counter
//
// Those rows are blocked for tiles and zones. Columns are not clipped: the
// tunnel wraps through column 0 and column 27, so those have to stay paintable.
//
// Movable objects are exempt. Scatter targets in particular belong outside the
// maze — the built-in level parks them on rows 0 and 34.

import { gridW, gridH } from '../constants';

export const EDIT_MIN_X = 0;
export const EDIT_MAX_X = gridW - 1;
export const EDIT_MIN_Y = 2;
export const EDIT_MAX_Y = gridH - 2;

export const EDIT_COLS = EDIT_MAX_X - EDIT_MIN_X + 1;
export const EDIT_ROWS = EDIT_MAX_Y - EDIT_MIN_Y + 1;

/** True when a tile may be painted, filled or given a zone. */
export function isEditableTile(x: number, y: number): boolean {
    if (x < EDIT_MIN_X || x > EDIT_MAX_X || y < EDIT_MIN_Y || y > EDIT_MAX_Y) return false;
    return !isEnemyHouseTile(x, y);
}

/** True for a row the HUD covers, where painting is refused. */
export function isReservedRow(y: number): boolean {
    return y < EDIT_MIN_Y || y > EDIT_MAX_Y;
}

/**
 * The enemy house, which cannot be edited or moved.
 *
 * The game hardcodes this structure in pixel coordinates: eyes navigate to
 * (13, 14), descend to row 17, bob between rows 16 and 17 and leave up column
 * 13 (`AI.EYES_TARGET`, `Move.enemyEnter`, `Move.enemyBounce`,
 * `Move.enemyExit`). Rebuilding the house elsewhere would look fine until the
 * first enemy is eaten and its eyes flew back to a wall, so the editor keeps
 * the whole enclosure — and the corridor its exit opens onto — as it is.
 */
// The box covers the structure itself: the door row down to the bottom wall,
// which is two tiles thick (rows 18-19) like every other wall in the maze.
//
// Row 14, the corridor enemies exit onto, is deliberately left editable — it
// carries the red-zone pair at (12, 14) and (15, 14) that stops enemies turning
// back up into the house, and those have to stay adjustable. What that row must
// not lose is a way out: validation walks from the exit tile and errors if
// enemies cannot reach anything beyond the house.
export const HOUSE_MIN_X = 10;
export const HOUSE_MAX_X = 17;
export const HOUSE_MIN_Y = 15;
export const HOUSE_MAX_Y = 19;

/** Where `Move.enemyExit` leaves an enemy once it clears the door. */
export const HOUSE_EXIT = { x: 13, y: HOUSE_MIN_Y - 1 };

export function isEnemyHouseTile(x: number, y: number): boolean {
    return x >= HOUSE_MIN_X && x <= HOUSE_MAX_X && y >= HOUSE_MIN_Y && y <= HOUSE_MAX_Y;
}

export const HOUSE_HINT =
    'The enemy house is fixed — the game navigates it by hardcoded coordinates';

/** Shown when someone tries to move an enemy spawn. */
export const FIXED_SPAWN_HINT =
    'the game spawns enemies at fixed positions inside the house';

export const RESERVED_ROWS_HINT =
    `Rows outside ${EDIT_MIN_Y}–${EDIT_MAX_Y} are covered by the score and lives display`;
