import { unit } from '../constants';
import { gameState } from '../game-state';
import { lerp } from '../utils';
import { Levels } from './Levels';
import { Time } from './Time';
import { Draw } from './Draw';
import { AI } from './AI';
import type { IGameObject } from '../types';

export class Move {
    static pacman(): void {
        if (gameState.frozen || gameState.pacmanFrozen) return;
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
        if (gameState.pacmanFrozen && gameState.blinky.ghostMode !== 'eyes') return;
        const g = gameState.blinky;
        if (g.ghostMode === 'house') { Move.ghostBounce(g); return; }
        if (g.ghostMode === 'exiting') { Move.ghostExit(g); return; }
        Move.moveObject(g);
    }

    static inky(): void {
        if (gameState.frozen) return;
        const g = gameState.inky;
        if (gameState.pacmanFrozen && g.ghostMode !== 'eyes') return;
        if (g.ghostMode === 'house') { Move.ghostBounce(g); return; }
        if (g.ghostMode === 'exiting') { Move.ghostExit(g); return; }
        Move.moveObject(g);
    }

    static pinky(): void {
        if (gameState.frozen) return;
        const g = gameState.pinky;
        if (gameState.pacmanFrozen && g.ghostMode !== 'eyes') return;
        if (g.ghostMode === 'house') { Move.ghostBounce(g); return; }
        if (g.ghostMode === 'exiting') { Move.ghostExit(g); return; }
        Move.moveObject(g);
    }

    static clyde(): void {
        if (gameState.frozen) return;
        const g = gameState.clyde;
        if (gameState.pacmanFrozen && g.ghostMode !== 'eyes') return;
        if (g.ghostMode === 'house') { Move.ghostBounce(g); return; }
        if (g.ghostMode === 'exiting') { Move.ghostExit(g); return; }
        Move.moveObject(g);
    }

    // Bounce ghost up and down inside the ghost house
    static ghostBounce(ghost: IGameObject): void {
        const bounceTopY    = 16 * unit + unit / 2; // tile row 16 center
        const bounceBottomY = 17 * unit + unit / 2; // tile row 17 center
        const step = ghost.moveSpeed * Time.scaledDeltaTime * Draw.normalizedUnit();

        if (ghost.moveDir === 'up') {
            ghost.y -= step;
            if (ghost.y <= bounceTopY) { ghost.y = bounceTopY; ghost.moveDir = 'down'; }
        } else {
            ghost.y += step;
            if (ghost.y >= bounceBottomY) { ghost.y = bounceBottomY; ghost.moveDir = 'up'; }
        }
    }

    // Navigate ghost from inside the house to the exit tile (col 13, row 14)
    static ghostExit(ghost: IGameObject): void {
        const step  = 2 * ghost.moveSpeed * Time.scaledDeltaTime * Draw.normalizedUnit();
        const exitX = 13 * unit + unit / 2; // pixel 270 — center of exit column
        const exitY = 14 * unit + unit / 2; // pixel 290 — corridor above door

        // Step 1: center horizontally on the exit column
        if (Math.abs(ghost.x - exitX) > 0.5) {
            if (ghost.x > exitX) {
                ghost.x = Math.max(ghost.x - step, exitX);
                ghost.moveDir = 'left';
            } else {
                ghost.x = Math.min(ghost.x + step, exitX);
                ghost.moveDir = 'right';
            }
            return;
        }

        // Step 2: move straight up through the door (tile 2 passable in this mode)
        ghost.x = exitX;
        ghost.moveDir = 'up';
        ghost.y = Math.max(ghost.y - step, exitY);

        // Step 3: reached exit — hand control back to normal AI
        if (ghost.y <= exitY) {
            ghost.y = exitY;
            const modeChanges = gameState.modeChangesInHouse[ghost.color] ?? 0;
            ghost.ghostMode = AI.getCurrentGlobalMode();
            ghost.moveDir   = modeChanges > 0 ? 'right' : 'left';
            gameState.modeChangesInHouse[ghost.color] = 0;
        }
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
