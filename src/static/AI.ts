import { gameState } from '../game-state';
import { Levels } from './Levels';
import { getDistance } from '../utils';
import type { IGameObject, Direction } from '../types';

interface TurnOption {
    dir: Direction;
    x: number;
    y: number;
}

// Red-zone T-intersections: enemies in scatter/chase cannot turn upward here.
// Two pairs flank the enemy house: (12,14)+(15,14) above, (12,26)+(15,26) below.

// Enemy house return tile — eyes navigate here to revive
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

    static enemyTileCenter(obj: IGameObject): void {
        if (gameState.frozen) return;

        const mode = obj.enemyMode ?? AI.getCurrentGlobalMode();
        if (mode === 'house' || mode === 'entering' || mode === 'exiting') return;

        if (mode === 'frightened') {
            AI.enemyFrightenedMove(obj);
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
            const st = gameState.currentLevel.scatterTargets;
            const cornerByColor: Record<string, { x: number; y: number }> = {
                'red':     st.redEnemy,
                'hotpink': st.hotpinkEnemy,
                'cyan':    st.cyanEnemy,
                'orange':  st.orangeEnemy,
            };
            // Cruise Elroy: red overrides scatter to chase nearest player
            if (obj.color === 'red' && gameState.elroyLevel > 0) {
                const target = AI.nearestPlayer(obj);
                if (target) {
                    targetX = target.roundedX();
                    targetY = target.roundedY();
                } else {
                    const corner = cornerByColor[obj.color] ?? { x: 0, y: 0 };
                    targetX = corner.x;
                    targetY = corner.y;
                }
            } else {
                const corner = cornerByColor[obj.color] ?? { x: 0, y: 0 };
                targetX = corner.x;
                targetY = corner.y;
            }
        } else {
            // chase — per-enemy authentic targeting against nearest active player
            const player = AI.nearestPlayer(obj);
            if (!player) return; // no active players — skip
            if (obj.color === 'hotpink') {
                // hotpink: 4 tiles ahead of nearest player (with up overflow bug)
                const ahead = AI.tilesAheadOf(player, 4);
                targetX = ahead.x;
                targetY = ahead.y;
                if (gameState.debugEnabled) gameState.debugHotpinkAhead = ahead;
            } else if (obj.color === 'cyan') {
                // cyan: doubled vector from red through 2 tiles ahead of nearest player
                const intermediate = AI.tilesAheadOf(player, 2);
                const redEnemy = gameState.redEnemy;
                targetX = 2 * intermediate.x - redEnemy.roundedX();
                targetY = 2 * intermediate.y - redEnemy.roundedY();
                if (gameState.debugEnabled) gameState.debugCyanPivot = intermediate;
            } else if (obj.color === 'orange') {
                // orange: target nearest player if ≥8 tiles away, else retreat to corner
                const dist = getDistance(obj.roundedX(), obj.roundedY(), player.roundedX(), player.roundedY());
                if (gameState.debugEnabled) gameState.debugOrangeDistToPlayer = dist;
                if (dist >= 8) {
                    targetX = player.roundedX();
                    targetY = player.roundedY();
                } else {
                    targetX = 0;
                    targetY = 34;
                }
            } else {
                // red: direct pursuit of nearest player's tile
                targetX = player.roundedX();
                targetY = player.roundedY();
            }
        }

        if (gameState.debugEnabled) gameState.debugEnemyTargets[obj.color] = { x: targetX, y: targetY };

        // Treat undefined (off-grid) as passable on the tunnel row so enemies can wrap
        const onTunnelRow = Levels.wrapsAt(gameState.currentLevel, myY);
        const inRedZone = (mode === 'scatter' || mode === 'chase') &&
            gameState.currentLevel.redZoneTiles.some(t => t.x === myX && t.y === myY);
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

    // Returns the nearest active player's actor to the given enemy, or null if none.
    static nearestPlayer(enemy: IGameObject): IGameObject | null {
        let nearest: IGameObject | null = null;
        let minDist = Infinity;
        for (const player of gameState.players) {
            if (!player.active || player.dying) continue;
            const d = getDistance(enemy.roundedX(), enemy.roundedY(), player.actor.roundedX(), player.actor.roundedY());
            if (d < minDist) { minDist = d; nearest = player.actor; }
        }
        return nearest;
    }

    // Returns the tile N steps ahead of the given actor in its movement direction.
    // Reproduces the upward overflow bug from the original ROM:
    // when the actor faces up, both x and y are offset by -N (instead of just y).
    static tilesAheadOf(actor: IGameObject, n: number): { x: number; y: number } {
        const px = actor.roundedX();
        const py = actor.roundedY();
        switch (actor.moveDir) {
            case 'right': return { x: px + n, y: py     };
            case 'left':  return { x: px - n, y: py     };
            case 'down':  return { x: px,     y: py + n };
            case 'up':    return { x: px - n, y: py - n }; // up overflow bug
        }
    }

    // PRNG-based random direction selection for frightened enemies
    static enemyFrightenedMove(obj: IGameObject): void {
        const allDirs: Direction[] = ['up', 'left', 'down', 'right'];
        const onTunnelRow = Levels.wrapsAt(gameState.currentLevel, obj.roundedY());
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
