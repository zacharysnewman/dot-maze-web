export const gridW = 28;
export const gridH = 36;
export const unit = 20;


// T-junctions where enemies cannot turn upward in scatter/chase mode.
// These are the four intersections flanking the enemy house where horizontal
// corridors meet the vertical enemy-house corridors (cols 12 & 15):
//   Upper pair: row 14 (top wall of enemy house interior)
//   Lower pair: row 26 (lower horizontal corridor)
export const RED_ZONE_TILES = [
    { x: 12, y: 14 },
    { x: 15, y: 14 },
    { x: 12, y: 26 },
    { x: 15, y: 26 },
] as const;
export const RED_ZONE = new Set(RED_ZONE_TILES.map(t => `${t.x},${t.y}`));
