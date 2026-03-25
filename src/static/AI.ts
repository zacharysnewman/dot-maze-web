import { gameState } from '../game-state';
import { getDistance } from '../utils';
import type { IGameObject, Direction } from '../types';

interface TurnOption {
    dir: Direction;
    x: number;
    y: number;
}

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

    static ghostTileCenter(obj: IGameObject): void {
        const myX = obj.roundedX();
        const myY = obj.roundedY();
        const pX  = gameState.pacman.roundedX();
        const pY  = gameState.pacman.roundedY();

        const canMoveLeft  = (obj.leftObject()   ?? 0) > 2 && obj.moveDir !== 'right';
        const canMoveRight = (obj.rightObject()  ?? 0) > 2 && obj.moveDir !== 'left';
        const canMoveUp    = (obj.topObject()    ?? 0) > 2 && obj.moveDir !== 'down';
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
            const dist = getDistance(turn.x, turn.y, pX, pY);
            if (dist < bestDist) {
                bestDist = dist;
                bestDir  = turn.dir;
            }
        }

        obj.moveDir = bestDir;
        console.log(obj.moveDir);
    }
}
