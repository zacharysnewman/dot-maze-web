import { gameState } from '../game-state';
import { getDistance } from '../utils';
import type { IGameObject, Direction } from '../types';

interface TurnOption {
    dir: Direction;
    x: number;
    y: number;
}

// Red-zone T-intersections: ghosts in scatter/chase cannot turn upward here.
// Two pairs of intersections flank the ghost house (rows 14 and 26, cols 6 and 21).
const RED_ZONE = new Set(['6,14', '21,14', '6,26', '21,26']);

// Scatter corner targets by ghost color
const SCATTER_TARGETS: Record<string, { x: number; y: number }> = {
    'red':     { x: 26, y: 0  },  // Blinky — top-right
    'hotpink': { x: 2,  y: 0  },  // Pinky — top-left
    'cyan':    { x: 27, y: 34 },  // Inky — bottom-right
    'orange':  { x: 0,  y: 34 },  // Clyde — bottom-left
};

// Ghost house return tile — eyes navigate here to revive
const EYES_TARGET = { x: 13, y: 14 };

export class AI {
    static modePatterns: [string, number, number, number][] = [
        ['scatter',  7,       7,       5      ],
        ['chase',    20,      20,      20     ],
        ['scatter',  7,       7,       5      ],
        ['chase',    20,      20,      20     ],
        ['scatter',  5,       5,       5      ],
        ['chase',    20,      1033,    1037   ],
        ['scatter',  5,       1 / 60,  1 / 60 ],
        ['chase',    -1,      -1,      -1     ],
    ];

    static prngState = 0;

    static prngNext(): number {
        AI.prngState = (AI.prngState * 1664525 + 1013904223) >>> 0;
        return AI.prngState;
    }

    static resetPrng(): void {
        AI.prngState = 0;
    }

    // Returns the current global scatter/chase mode based on the timer index
    static getCurrentGlobalMode(): 'scatter' | 'chase' {
        return AI.modePatterns[gameState.scatterChaseIndex][0] as 'scatter' | 'chase';
    }

    // Returns the duration (seconds) of the current mode phase for the current level.
    // -1 means indefinite.
    static getCurrentPhaseDuration(): number {
        const idx = gameState.scatterChaseIndex;
        const level = gameState.level;
        const col = level === 1 ? 1 : level <= 4 ? 2 : 3;
        return AI.modePatterns[idx][col];
    }

    static ghostTileCenter(obj: IGameObject): void {
        if (gameState.frozen) return;

        const mode = obj.ghostMode ?? AI.getCurrentGlobalMode();
        if (mode === 'house' || mode === 'exiting') return;

        if (mode === 'frightened') {
            AI.ghostFrightenedMove(obj);
            return;
        }

        const myX = obj.roundedX();
        const myY = obj.roundedY();
        let targetX: number;
        let targetY: number;

        if (mode === 'eyes') {
            targetX = EYES_TARGET.x;
            targetY = EYES_TARGET.y;
        } else if (mode === 'scatter') {
            // Cruise Elroy: Blinky overrides scatter to keep chasing Pac-Man
            if (obj.color === 'red' && gameState.elroyLevel > 0) {
                targetX = gameState.pacman.roundedX();
                targetY = gameState.pacman.roundedY();
            } else {
                const corner = SCATTER_TARGETS[obj.color] ?? { x: 0, y: 0 };
                targetX = corner.x;
                targetY = corner.y;
            }
        } else {
            // chase — per-ghost authentic targeting
            const pacman = gameState.pacman;
            if (obj.color === 'hotpink') {
                // Pinky: 4 tiles ahead of Pac-Man (with up overflow bug)
                const ahead = AI.tilesAheadOfPacman(4);
                targetX = ahead.x;
                targetY = ahead.y;
                if (gameState.debugEnabled) gameState.debugPinkyAhead = ahead;
            } else if (obj.color === 'cyan') {
                // Inky: doubled vector from Blinky through 2 tiles ahead of Pac-Man
                const intermediate = AI.tilesAheadOfPacman(2);
                const blinky = gameState.blinky;
                targetX = 2 * intermediate.x - blinky.roundedX();
                targetY = 2 * intermediate.y - blinky.roundedY();
                if (gameState.debugEnabled) gameState.debugInkyPivot = intermediate;
            } else if (obj.color === 'orange') {
                // Clyde: target Pac-Man if ≥8 tiles away, else retreat to scatter corner
                const dist = getDistance(obj.roundedX(), obj.roundedY(), pacman.roundedX(), pacman.roundedY());
                if (gameState.debugEnabled) gameState.debugClydeDistToPacman = dist;
                if (dist >= 8) {
                    targetX = pacman.roundedX();
                    targetY = pacman.roundedY();
                } else {
                    targetX = 0;
                    targetY = 34;
                }
            } else {
                // Blinky: direct pursuit of Pac-Man's current tile
                targetX = pacman.roundedX();
                targetY = pacman.roundedY();
            }
        }

        if (gameState.debugEnabled) gameState.debugGhostTargets[obj.color] = { x: targetX, y: targetY };

        // Treat undefined (off-grid) as passable on the tunnel row so ghosts can wrap
        const TUNNEL_ROW = 17;
        const onTunnelRow = myY === TUNNEL_ROW;
        const inRedZone = (mode === 'scatter' || mode === 'chase') && RED_ZONE.has(`${myX},${myY}`);
        const canMoveLeft  = ((obj.leftObject()  ?? 0) > 2 || (onTunnelRow && obj.leftObject()  === undefined)) && obj.moveDir !== 'right';
        const canMoveRight = ((obj.rightObject() ?? 0) > 2 || (onTunnelRow && obj.rightObject() === undefined)) && obj.moveDir !== 'left';
        const canMoveUp    = (obj.topObject()    ?? 0) > 2 && obj.moveDir !== 'down' && !inRedZone;
        const canMoveDown  = (obj.bottomObject() ?? 0) > 2 && obj.moveDir !== 'up';

        const turns: TurnOption[] = [];
        // Priority: up > left > down > right
        if (canMoveUp)    turns.push({ dir: 'up',    x: myX,     y: myY - 1 });
        if (canMoveLeft)  turns.push({ dir: 'left',  x: myX - 1, y: myY     });
        if (canMoveDown)  turns.push({ dir: 'down',  x: myX,     y: myY + 1 });
        if (canMoveRight) turns.push({ dir: 'right', x: myX + 1, y: myY     });

        if (turns.length === 0) return;

        let bestDir: Direction = turns[0].dir;
        let bestDist = Infinity;
        for (const turn of turns) {
            const dist = getDistance(turn.x, turn.y, targetX, targetY);
            if (dist < bestDist) {
                bestDist = dist;
                bestDir  = turn.dir;
            }
        }

        obj.moveDir = bestDir;
    }

    // Returns the tile N steps ahead of Pac-Man in his movement direction.
    // Reproduces the upward overflow bug from the original ROM:
    // when Pac-Man faces up, both x and y are offset by -N (instead of just y).
    static tilesAheadOfPacman(n: number): { x: number; y: number } {
        const pacman = gameState.pacman;
        const px = pacman.roundedX();
        const py = pacman.roundedY();
        switch (pacman.moveDir) {
            case 'right': return { x: px + n, y: py     };
            case 'left':  return { x: px - n, y: py     };
            case 'down':  return { x: px,     y: py + n };
            case 'up':    return { x: px - n, y: py - n }; // up overflow bug
        }
    }

    // PRNG-based random direction selection for frightened ghosts
    static ghostFrightenedMove(obj: IGameObject): void {
        const allDirs: Direction[] = ['up', 'left', 'down', 'right'];
        const TUNNEL_ROW = 17;
        const onTunnelRow = obj.roundedY() === TUNNEL_ROW;
        const canMove: Record<Direction, boolean> = {
            left:  ((obj.leftObject()  ?? 0) > 2 || (onTunnelRow && obj.leftObject()  === undefined)) && obj.moveDir !== 'right',
            right: ((obj.rightObject() ?? 0) > 2 || (onTunnelRow && obj.rightObject() === undefined)) && obj.moveDir !== 'left',
            up:    (obj.topObject()    ?? 0) > 2 && obj.moveDir !== 'down',
            down:  (obj.bottomObject() ?? 0) > 2 && obj.moveDir !== 'up',
        };

        const rng = AI.prngNext();
        const startIdx = rng % 4;

        for (let i = 0; i < 4; i++) {
            const dir = allDirs[(startIdx + i) % 4];
            if (canMove[dir]) {
                obj.moveDir = dir;
                return;
            }
        }
    }
}
