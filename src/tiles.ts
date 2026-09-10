// Named constants for tile values used in the level grid (TileValue type).
// Tile values > 2 are walkable (passable by players and enemies).
export const TILE_WALL       = 0;  // solid wall (impassable)
export const TILE_ENEMY_DOOR = 2;  // enemy house gate (passable only in entering/exiting mode)
export const TILE_DOT        = 3;  // pellet
export const TILE_POWER      = 4;  // power pellet
export const TILE_EMPTY      = 5;  // open corridor (no collectible)
