import { unit } from '../constants';
import { gameState } from '../game-state';
import { lerp } from '../utils';
import { Levels } from './Levels';
import { Time } from './Time';
import { Draw } from './Draw';
import type { IGameObject } from '../types';

export class Move {
    static pacman(): void {
        if (gameState.frozen) return;
        Move.moveObject(gameState.pacman);

        const p = gameState.pacman;
        if (p.moveDir === 'right' || p.moveDir === 'left') {
            p.y = lerp(p.y, p.roundedAbsoluteY(), 0.1);
        } else if (p.moveDir === 'up' || p.moveDir === 'down') {
            p.x = lerp(p.x, p.roundedAbsoluteX(), 0.1);
        }
    }

    static blinky(): void {
        if (gameState.frozen) return;
        Move.moveObject(gameState.blinky);
    }

    static inky(): void {
        if (gameState.frozen) return;
        Move.moveObject(gameState.inky);
    }

    static pinky(): void {
        if (gameState.frozen) return;
        Move.moveObject(gameState.pinky);
    }

    static sue(): void {
        if (gameState.frozen) return;
        Move.moveObject(gameState.sue);
    }

    static moveObject(obj: IGameObject): void {
        const speed = 2 * obj.moveSpeed;
        const minDistance = 1;

        // Tunnel teleport
        if (obj.moveDir === 'left' && obj.leftObject() === undefined) {
            obj.x = (Levels.levelSetup[obj.roundedY()].length - 1) * unit + unit / 2;
        }
        if (obj.moveDir === 'right' && obj.rightObject() === undefined) {
            obj.x = unit / 2;
        }

        const leftObj   = obj.leftObject();
        const rightObj  = obj.rightObject();
        const topObj    = obj.topObject();
        const bottomObj = obj.bottomObject();

        // Can move if target tile is walkable (>2), or if already past the wall
        // threshold and the tile is open (<=0 means wall, but object can squeeze past).
        // Undefined means off-grid; treat as impassable (tunnels are handled above).
        const canMoveLeft  = leftObj  !== undefined && (leftObj  > 2 || (leftObj  <= 0 && obj.gridX() - (obj.roundedX() - 1) > minDistance));
        const canMoveRight = rightObj !== undefined && (rightObj > 2 || (rightObj <= 0 && (obj.roundedX() + 1) - obj.gridX() > minDistance));
        const canMoveUp    = topObj   !== undefined && (topObj   > 2 || (topObj   <= 0 && obj.gridY() - (obj.roundedY() - 1) > minDistance));
        const canMoveDown  = bottomObj !== undefined && (bottomObj > 2 || (bottomObj <= 0 && (obj.roundedY() + 1) - obj.gridY() > minDistance));

        const step = speed * Time.scaledDeltaTime * Draw.normalizedUnit();
        if (obj.moveDir === 'left' && canMoveLeft) {
            const centerX = obj.roundedAbsoluteX();
            obj.x -= step;
            if (leftObj !== undefined && leftObj <= 2) obj.x = Math.max(obj.x, centerX);
        } else if (obj.moveDir === 'right' && canMoveRight) {
            const centerX = obj.roundedAbsoluteX();
            obj.x += step;
            if (rightObj !== undefined && rightObj <= 2) obj.x = Math.min(obj.x, centerX);
        } else if (obj.moveDir === 'up' && canMoveUp) {
            const centerY = obj.roundedAbsoluteY();
            obj.y -= step;
            if (topObj !== undefined && topObj <= 2) obj.y = Math.max(obj.y, centerY);
        } else if (obj.moveDir === 'down' && canMoveDown) {
            const centerY = obj.roundedAbsoluteY();
            obj.y += step;
            if (bottomObj !== undefined && bottomObj <= 2) obj.y = Math.min(obj.y, centerY);
        }
    }
}
