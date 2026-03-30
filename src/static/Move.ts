import { unit } from '../constants';
import { gameState } from '../game-state';
import { lerp } from '../utils';
import { Levels } from './Levels';
import { Time } from './Time';
import { Draw } from './Draw';
import { AI } from './AI';
import type { IGameObject, PlayerState } from '../types';

export class Move {
    static player(player: PlayerState): void {
        if (!player.active || player.dying) return;
        if (gameState.frozen || player.frozen) return;
        Move.moveObject(player.actor);

        const p = player.actor;
        if (p.moveDir === 'right' || p.moveDir === 'left') {
            p.y = lerp(p.y, p.roundedAbsoluteY(), 0.1);
        } else if (p.moveDir === 'up' || p.moveDir === 'down') {
            p.x = lerp(p.x, p.roundedAbsoluteX(), 0.1);
        }
    }

    static blinky(): void {
        if (gameState.frozen) return;
        if (gameState.players.some(p => p.frozen) && gameState.blinky.enemyMode !== 'eyes' && gameState.blinky.enemyMode !== 'entering') return;
        const g = gameState.blinky;
        if (g.enemyMode === 'house') { Move.enemyBounce(g); return; }
        if (g.enemyMode === 'entering') { Move.enemyEnter(g); return; }
        if (g.enemyMode === 'exiting') { Move.enemyExit(g); return; }
        Move.moveObject(g);
    }

    static inky(): void {
        if (gameState.frozen) return;
        const g = gameState.inky;
        if (gameState.players.some(p => p.frozen) && g.enemyMode !== 'eyes' && g.enemyMode !== 'entering') return;
        if (g.enemyMode === 'house') { Move.enemyBounce(g); return; }
        if (g.enemyMode === 'entering') { Move.enemyEnter(g); return; }
        if (g.enemyMode === 'exiting') { Move.enemyExit(g); return; }
        Move.moveObject(g);
    }

    static pinky(): void {
        if (gameState.frozen) return;
        const g = gameState.pinky;
        if (gameState.players.some(p => p.frozen) && g.enemyMode !== 'eyes' && g.enemyMode !== 'entering') return;
        if (g.enemyMode === 'house') { Move.enemyBounce(g); return; }
        if (g.enemyMode === 'entering') { Move.enemyEnter(g); return; }
        if (g.enemyMode === 'exiting') { Move.enemyExit(g); return; }
        Move.moveObject(g);
    }

    static clyde(): void {
        if (gameState.frozen) return;
        const g = gameState.clyde;
        if (gameState.players.some(p => p.frozen) && g.enemyMode !== 'eyes' && g.enemyMode !== 'entering') return;
        if (g.enemyMode === 'house') { Move.enemyBounce(g); return; }
        if (g.enemyMode === 'entering') { Move.enemyEnter(g); return; }
        if (g.enemyMode === 'exiting') { Move.enemyExit(g); return; }
        Move.moveObject(g);
    }

    // Bounce enemy up and down inside the enemy house
    static enemyBounce(enemy: IGameObject): void {
        const bounceTopY    = 16 * unit + unit / 2; // tile row 16 center
        const bounceBottomY = 17 * unit + unit / 2; // tile row 17 center
        const step = enemy.moveSpeed * Time.scaledDeltaTime * Draw.normalizedUnit();

        if (enemy.moveDir === 'up') {
            enemy.y -= step;
            if (enemy.y <= bounceTopY) { enemy.y = bounceTopY; enemy.moveDir = 'down'; }
        } else {
            enemy.y += step;
            if (enemy.y >= bounceBottomY) { enemy.y = bounceBottomY; enemy.moveDir = 'up'; }
        }
    }

    // Navigate returning eyes from the entrance (col 13, row 14) down to the enemy's spawn position,
    // then hand off to exiting. Mirrors enemyExit in reverse.
    static enemyEnter(enemy: IGameObject): void {
        const step = enemy.moveSpeed * Time.scaledDeltaTime * Draw.normalizedUnit();
        const enterX = 13 * unit + unit / 2; // center column — always enter straight down
        const centerY = 17 * unit + unit / 2; // row 17 — house interior center row

        
        const spawnXByColor: Record<string, number> = {
            'red':     13.5 * unit + unit / 2, // Blinky → center (lives outside normally)
            'hotpink': 13.5 * unit + unit / 2, // Pinky  → center
            'cyan':    12   * unit + unit / 2, // Inky   → left
            'orange':  15   * unit + unit / 2, // Clyde  → right
        };
        // Fallback to Pinky/Blinky tile if color unrecognised
        const spawnX = spawnXByColor[enemy.color] ?? enterX;

        // Step 1: move straight down to row 17 (bypasses the door tile via direct Y movement)
        if (enemy.y < centerY - 0.5) {
            enemy.y = Math.min(enemy.y + step, centerY);
            enemy.moveDir = 'down';
            return;
        }
        enemy.y = centerY;

        // Step 2: move horizontally to this enemy's spawn column
        if (Math.abs(enemy.x - spawnX) > 0.5) {
            if (enemy.x > spawnX) {
                enemy.x = Math.max(enemy.x - step, spawnX);
                enemy.moveDir = 'left';
            } else {
                enemy.x = Math.min(enemy.x + step, spawnX);
                enemy.moveDir = 'right';
            }
            return;
        }

        // Arrived at spawn — set normal maze speed and begin exiting
        enemy.x = spawnX;
        const lvl = gameState.level;
        enemy.moveSpeed = lvl === 1 ? 0.75 : lvl <= 4 ? 0.85 : 0.95;
        enemy.enemyMode = 'exiting';
    }

    // Navigate enemy from inside the house to the exit tile (col 13, row 14)
    static enemyExit(enemy: IGameObject): void {
        const step  = enemy.moveSpeed * Time.scaledDeltaTime * Draw.normalizedUnit();
        const exitX = 13 * unit + unit / 2; // pixel 270 — center of exit column
        const exitY = 14 * unit + unit / 2; // pixel 290 — corridor above door

        // Step 1: center horizontally on the exit column
        if (Math.abs(enemy.x - exitX) > 0.5) {
            if (enemy.x > exitX) {
                enemy.x = Math.max(enemy.x - step, exitX);
                enemy.moveDir = 'left';
            } else {
                enemy.x = Math.min(enemy.x + step, exitX);
                enemy.moveDir = 'right';
            }
            return;
        }

        // Step 2: move straight up through the door (tile 2 passable in this mode)
        enemy.x = exitX;
        enemy.moveDir = 'up';
        enemy.y = Math.max(enemy.y - step, exitY);

        // Step 3: reached exit — hand control back to normal AI
        if (enemy.y <= exitY) {
            enemy.y = exitY;
            const modeChanges = gameState.modeChangesInHouse[enemy.color] ?? 0;
            enemy.enemyMode = AI.getCurrentGlobalMode();
            enemy.moveDir   = modeChanges > 0 ? 'right' : 'left';
            gameState.modeChangesInHouse[enemy.color] = 0;
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
