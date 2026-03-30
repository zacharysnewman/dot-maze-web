import { unit, gridW, gridH, RED_ZONE_TILES } from '../constants';
import type { IGameObject, Direction, PlayerState } from '../types';
import { gameState } from '../game-state';
import { Levels } from './Levels';
import { Stats } from './Stats';
import { Time } from './Time';

// Frightened duration by level (seconds)
const FRIGHTENED_DURATION: Record<number, number> = {
    1:6, 2:5, 3:4, 4:3, 5:2, 6:5, 7:2, 8:2, 9:1,
    10:5, 11:2, 12:1, 13:1, 14:3, 15:1, 16:1, 17:0, 18:1,
};

// Frightened flash count by level
const FRIGHTENED_FLASH_COUNT: Record<number, number> = {
    1:5, 2:5, 3:5, 4:5, 5:5, 6:5, 7:5, 8:5, 9:3,
    10:5, 11:5, 12:3, 13:3, 14:5, 15:3, 16:3, 17:0, 18:3,
};

type WallDrawFn = (x: number, y: number) => void;

export class Draw {
    static playerAnim = 0;
    static playerAnimTime = 0;

    // Call once per frame from the game loop to advance Player mouth animation.
    static advancePlayerAnim(): void {
        if (gameState.frozen) return;
        const frameChangePerSecond = 30;
        const frames = [0.0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1];
        Draw.playerAnimTime += Time.deltaTime;
        Draw.playerAnim = Math.floor(Draw.playerAnimTime * frameChangePerSecond) % frames.length;
    }

    static normalizedUnit(): number {
        return 1;
    }

    static rect(color: string, x: number, y: number, w: number, h: number): void {
        gameState.ctx.fillStyle = color;
        gameState.ctx.fillRect(x, y, w, h);
    }

    static background(): void {
        Draw.rect('black', 0, 0, gameState.canvas.width, gameState.canvas.height);
    }

    static walls(): void {
        const ctx = gameState.ctx;
        ctx.beginPath();
        ctx.strokeStyle = 'blue';
        ctx.lineWidth = 3;

        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                if (Levels.level1[y][x] === 0) {
                    const drawWall = Draw.getWallType(x, y);
                    drawWall(x * unit, y * unit);
                }
            }
        }

        ctx.stroke();
    }

    static player(obj: IGameObject, player: PlayerState): void {
        if (!player.active && !player.dying) return; // sitting out — don't draw
        if (player.dying) { Draw.playerDeathAnim(obj, player); return; }
        const { color, x, y, scale } = obj;
        const ctx = gameState.ctx;
        const frames = [0.0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1];
        const size = scale * unit;

        let dirMultiplier = 1;
        switch (obj.moveDir) {
            case 'left':  dirMultiplier = 1;   break;
            case 'right': dirMultiplier = 0;   break;
            case 'up':    dirMultiplier = 1.5; break;
            case 'down':  dirMultiplier = 0.5; break;
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size,
            frames[Draw.playerAnim] * Math.PI + Math.PI * dirMultiplier,
            (1.0 + frames[Draw.playerAnim]) * Math.PI + Math.PI * dirMultiplier,
            false);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, size,
            (1 - frames[Draw.playerAnim]) * Math.PI + Math.PI * dirMultiplier,
            (1 + (1 - frames[Draw.playerAnim])) * Math.PI + Math.PI * dirMultiplier,
            false);
        ctx.fill();

        // Draw player prop (P1=none, P2=backpack, P3=bow, P4=tic-tac pill)
        Draw.playerProp(obj, player.id);
    }

    private static playerDeathAnim(obj: IGameObject, player: PlayerState): void {
        const ctx = gameState.ctx;
        const { x, y, scale, moveDir } = obj;
        const size = scale * unit;
        const p = player.deathProgress;

        // Phase 1 (0 → 0.62): mouth opens progressively wider until Player vanishes
        const OPEN_END = 0.62;
        if (p < OPEN_END) {
            const t = p / OPEN_END;                    // 0 → 1
            const mouthAngle = t * Math.PI;            // 0 → π (fully open = gone)
            // Orient mouth in the direction Player was travelling
            let baseAngle = 0;
            if (moveDir === 'left')  baseAngle = Math.PI;
            if (moveDir === 'up')    baseAngle = -Math.PI / 2;
            if (moveDir === 'down')  baseAngle = Math.PI / 2;
            const startAngle = baseAngle + mouthAngle;
            const endAngle   = baseAngle - mouthAngle;
            ctx.fillStyle = 'yellow';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.arc(x, y, size, startAngle, endAngle, false);
            ctx.closePath();
            ctx.fill();
            return;
        }

        // Phase 2 (0.62 → 0.87): pop burst; 0.87→1.0 is silent delay
        const POP_END = 0.75;
        if (p >= POP_END) return;
        const confettiP = (p - OPEN_END) / (POP_END - OPEN_END); // 0 → 1
        const alpha = 1 - confettiP;
        const NUM_PARTICLES = 12;
        for (let i = 0; i < NUM_PARTICLES; i++) {
            const angle = (i / NUM_PARTICLES) * Math.PI * 2;
            const speed = (0.6 + (i % 3) * 0.25) * size;
            const px    = x + Math.cos(angle) * speed * confettiP;
            const py    = y + Math.sin(angle) * speed * confettiP;
            const pSize = size * (0.22 + (i % 3) * 0.07) * (1 - confettiP * 0.4) * 0.5;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = 'yellow';
            ctx.beginPath();
            ctx.arc(px, py, pSize, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // Draw player-specific prop relative to the actor's position and moveDir.
    // P1: no prop. P2: backpack. P3: bow. P4: tic-tac pill.
    private static playerProp(obj: IGameObject, id: number): void {
        if (id === 1) return;
        const ctx = gameState.ctx;
        const { x, y, scale, moveDir } = obj;
        const size = scale * unit;

        // "Back" direction vector (opposite of movement)
        let backDx = 0, backDy = 0;
        switch (moveDir) {
            case 'right': backDx = -1; break;
            case 'left':  backDx = +1; break;
            case 'down':  backDy = -1; break;
            case 'up':    backDy = +1; break;
        }

        if (id === 2) {
            // Backpack Man — brown rounded rect on the back, rotates with direction
            const isVertical = backDy !== 0;
            const pw = size * (isVertical ? 0.825 : 0.45);
            const ph = size * (isVertical ? 0.45  : 0.825);
            const bx = x + backDx * (size * 0.85) - pw / 2;
            const by = y + backDy * (size * 0.85) - ph / 2 - size * 0.15;
            ctx.fillStyle = '#8B5E3C';
            ctx.beginPath();
            ctx.roundRect(bx, by, pw, ph, size * 0.08);
            ctx.fill();
        } else if (id === 3) {
            // Miss Player — purple bow on top of head, rotates with moveDir.
            // topDx/topDy: direction from pac-center toward bow (left/right keeps world-up).
            // spreadDx/spreadDy: perpendicular (90° CCW from top), lobes fan along this axis.
            let topDx = 0, topDy = -1;
            if      (moveDir === 'up')   { topDx =  1; topDy = 0; }
            else if (moveDir === 'down') { topDx = -1; topDy = 0; }
            const spreadDx = -topDy;
            const spreadDy =  topDx;
            const bowHalfSpread = size * 0.6;
            const bowDepth      = size * 0.44;
            const bcx = x + topDx * size * 1.15;
            const bcy = y + topDy * size * 1.15;
            ctx.fillStyle = '#b44fff';
            // Lobe in –spread direction
            ctx.beginPath();
            ctx.moveTo(bcx, bcy);
            ctx.lineTo(bcx - spreadDx * bowHalfSpread + topDx * bowDepth,
                       bcy - spreadDy * bowHalfSpread + topDy * bowDepth);
            ctx.lineTo(bcx - spreadDx * bowHalfSpread - topDx * bowDepth,
                       bcy - spreadDy * bowHalfSpread - topDy * bowDepth);
            ctx.closePath();
            ctx.fill();
            // Lobe in +spread direction
            ctx.beginPath();
            ctx.moveTo(bcx, bcy);
            ctx.lineTo(bcx + spreadDx * bowHalfSpread + topDx * bowDepth,
                       bcy + spreadDy * bowHalfSpread + topDy * bowDepth);
            ctx.lineTo(bcx + spreadDx * bowHalfSpread - topDx * bowDepth,
                       bcy + spreadDy * bowHalfSpread - topDy * bowDepth);
            ctx.closePath();
            ctx.fill();
            // Center knot
            ctx.beginPath();
            ctx.arc(bcx, bcy, size * 0.18, 0, Math.PI * 2);
            ctx.fill();
        } else if (id === 4) {
            // Tic-Tac-Toe Player — # grid drawn on body, rotates with moveDir
            const gridHalf = size * 0.55;
            const third    = gridHalf * 0.55;
            const angle = moveDir === 'right' ?  0
                        : moveDir === 'down'  ?  Math.PI / 2
                        : moveDir === 'left'  ?  Math.PI
                        :                       -Math.PI / 2;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.lineWidth = size * 0.1;
            ctx.lineCap = 'round';
            ctx.beginPath();
            // Two horizontal bars
            ctx.moveTo(-gridHalf, -third); ctx.lineTo(gridHalf, -third);
            ctx.moveTo(-gridHalf,  third); ctx.lineTo(gridHalf,  third);
            // Two vertical bars
            ctx.moveTo(-third, -gridHalf); ctx.lineTo(-third, gridHalf);
            ctx.moveTo( third, -gridHalf); ctx.lineTo( third, gridHalf);
            ctx.stroke();
            ctx.restore();
        }
    }

    static getFrightenedDuration(level: number): number {
        return level >= 19 ? 0 : (FRIGHTENED_DURATION[level] ?? 0);
    }

    static getFrightenedFlashCount(level: number): number {
        return level >= 19 ? 0 : (FRIGHTENED_FLASH_COUNT[level] ?? 0);
    }

    static getFruitEmoji(level: number): string {
        if (level === 1) return '🍒';
        if (level === 2) return '🍓';
        if (level <= 4)  return '🍊';
        if (level <= 6)  return '🍎';
        if (level <= 8)  return '🍈';
        if (level <= 10) return '⭐';
        if (level <= 12) return '🔔';
        return '🗝️';
    }

    static fruit(): void {
        if (!gameState.fruitActive) return;
        const { x, y } = gameState.fruitActive;
        const ctx = gameState.ctx;
        const fontSize = Math.round(unit * 0.9);
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Draw.getFruitEmoji(gameState.level), x, y);
    }

    static fruitCounter(): void {
        // Show current level's fruit + completed levels (up to last 7 total)
        const allItems = [...gameState.fruitHistory, gameState.level];
        const maxDisplay = 7;
        const displayItems = allItems.slice(-maxDisplay);
        const ctx = gameState.ctx;
        const fontSize = Math.round(unit * 0.85);
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const livesY = (gridH - 1) * unit + unit / 2;
        const startX = gameState.canvas.width - unit;
        for (let i = 0; i < displayItems.length; i++) {
            const lvl = displayItems[displayItems.length - 1 - i];
            ctx.fillText(Draw.getFruitEmoji(lvl), startX - i * unit * 1.3, livesY);
        }
    }

    static enemy(obj: IGameObject): void {
        const { color, x, y, scale, enemyMode } = obj;

        // Hide enemies while all players are dying (no active non-dying player remains)
        if (gameState.players.length > 0 && gameState.players.every(p => !p.active || p.dying)) return;

        if (enemyMode === 'eyes' || enemyMode === 'entering') {
            Draw.drawEnemyEyes(color, x, y, scale, obj.moveDir);
            return;
        }

        if (enemyMode === 'frightened') {
            const flashCount = Draw.getFrightenedFlashCount(gameState.level);
            const flashDuration = flashCount * 14 / 60;
            const timeLeft = gameState.frightenedRemaining;
            const isFlashing = flashCount > 0 && timeLeft < flashDuration && timeLeft > 0;
            let enemyColor = '#0000cc';
            if (isFlashing) {
                enemyColor = Math.floor(Time.frameCount / 7) % 2 === 0 ? '#0000cc' : 'white';
            }
            Draw.drawEnemyBody(enemyColor, x, y, scale);
            Draw.drawFrightenedEyes(x, y, scale, enemyColor);
            return;
        }

        Draw.drawEnemyBody(color, x, y, scale);
        Draw.drawEnemyEyes(color, x, y, scale, obj.moveDir);
    }

    static drawFrightenedEyes(x: number, y: number, scale: number, bodyColor: string): void {
        const ctx = gameState.ctx;
        const enemySize = scale * unit;
        const eyeOffsetX = enemySize * 0.3;
        const eyeOffsetY = enemySize * 0.15;
        const eyeRadius  = enemySize * 0.12;
        const dotColor = bodyColor === 'white' ? '#0000cc' : 'white';
        ctx.fillStyle = dotColor;
        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(x + side * eyeOffsetX, y - eyeOffsetY, eyeRadius, 0, Math.PI * 2);
            ctx.fill();
        }
        // Frowny mouth — center placed below so the arc curves upward (∩ shape)
        const mouthCenterY = y + enemySize * 0.5;
        const mouthR = enemySize * 0.28;
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = Math.max(1, enemySize * 0.12);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(x, mouthCenterY, mouthR, Math.PI, 0, false); // left→top→right = frown
        ctx.stroke();
        ctx.lineCap = 'butt'; // restore default so subsequent strokes (walls) are unaffected
    }

    static drawEnemyBody(color: string, x: number, y: number, scale: number): void {
        const ctx = gameState.ctx;
        const enemySize = scale * unit;
        let curX = x;
        let curY = y;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(curX, curY);

        ctx.arc(curX, curY, enemySize, Math.PI, 0, false);

        curX += enemySize;
        curY += enemySize / 2 + enemySize / 3;
        ctx.lineTo(curX, curY);

        const numBumps = Math.floor(performance.now() / 400) % 2 === 0 ? 3 : 4;
        const enemyBump = enemySize / numBumps;
        for (let i = 0; i < numBumps; i++) {
            curX -= enemyBump;
            ctx.lineTo(curX, curY);
            ctx.arc(curX, curY, enemyBump, Math.PI * 2, Math.PI, false);
            curX -= enemyBump;
        }

        ctx.lineTo(curX, curY);

        curY -= enemySize / 2 + enemySize / 3;
        ctx.lineTo(curX, curY);

        ctx.fill();
    }

    static drawEnemyEyes(_color: string, x: number, y: number, scale: number, dir?: Direction): void {
        const ctx = gameState.ctx;
        const enemySize = scale * unit;
        const eyeOffsetX = enemySize * 0.42;
        const eyeOffsetY = enemySize * 0.1;
        const eyeRadius  = enemySize * 0.35;
        const pupilRadius = enemySize * 0.15;
        // Max pupil travel = eye radius minus pupil radius, damped slightly
        const maxTravel = (eyeRadius - pupilRadius) * 0.65;

        // Pupil center offset from eye center based on movement direction
        let pdx = 0, pdy = maxTravel * 0.3; // default: slight downward gaze
        switch (dir) {
            case 'right': pdx = +maxTravel; pdy = 0; break;
            case 'left':  pdx = -maxTravel; pdy = 0; break;
            case 'up':    pdx = 0; pdy = -maxTravel; break;
            case 'down':  pdx = 0; pdy = +maxTravel; break;
        }

        for (const side of [-1, 1]) {
            const ex = x + side * eyeOffsetX;
            const ey = y - eyeOffsetY;

            // White
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(ex, ey, eyeRadius, 0, Math.PI * 2);
            ctx.fill();

            // Dark blue pupil — tracks movement direction
            ctx.fillStyle = '#1a1aff';
            ctx.beginPath();
            ctx.arc(ex + pdx, ey + pdy, pupilRadius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    static dots(): void {
        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                if (Levels.levelDynamic[y][x] === 3) Draw.dot(unit / 8, x, y);
                if (Levels.levelDynamic[y][x] === 4) Draw.dot(unit / 3, x, y);
            }
        }
    }

    static dot(circle: number, x: number, y: number): void {
        const ctx = gameState.ctx;
        ctx.fillStyle = 'lightgoldenrodyellow';
        ctx.beginPath();
        ctx.arc(x * unit + unit / 2, y * unit + unit / 2, circle, 0, Math.PI * 2, true);
        ctx.fill();
    }

    static getWallType(x: number, y: number): WallDrawFn {
        const left        = x - 1 > 0             ? Levels.level1[y][x - 1] > 0     : false;
        const top         = y - 1 > 0             ? Levels.level1[y - 1][x] > 0     : false;
        const right       = x + 1 < gridW         ? Levels.level1[y][x + 1] > 0     : false;
        const bottom      = y + 1 < gridH         ? Levels.level1[y + 1][x] > 0     : false;
        const topLeft     = y - 1 > 0 && x - 1 > 0       ? Levels.level1[y - 1][x - 1] > 0 : false;
        const topRight    = y - 1 > 0 && x + 1 < gridW   ? Levels.level1[y - 1][x + 1] > 0 : false;
        const bottomRight = y + 1 < gridH && x + 1 < gridW ? Levels.level1[y + 1][x + 1] > 0 : false;
        const bottomLeft  = y + 1 < gridH && x - 1 > 0   ? Levels.level1[y + 1][x - 1] > 0 : false;

        if ((left || right) && !(top || bottom))        return Draw.wallVertical;
        if ((top || bottom) && !(left || right))        return Draw.wallHorizontal;
        if (left && top && !(right || bottom))          return Draw.wallTLC;
        if (top && right && !(bottom || left))          return Draw.wallTRC;
        if (right && bottom && !(left || top))          return Draw.wallBRC;
        if (bottom && left && !(top || right))          return Draw.wallBLC;
        if (topLeft && !(top || right || bottom || left))    return Draw.wallBRC;
        if (topRight && !(top || right || bottom || left))   return Draw.wallBLC;
        if (bottomRight && !(top || right || bottom || left)) return Draw.wallTLC;
        if (bottomLeft && !(top || right || bottom || left)) return Draw.wallTRC;

        return Draw.nothing;
    }

    static nothing(_x: number, _y: number): void {}

    static wallVertical(x: number, y: number): void {
        const ctx = gameState.ctx;
        ctx.moveTo(x + unit / 2, y);
        ctx.lineTo(x + unit / 2, y + unit);
    }

    static wallHorizontal(x: number, y: number): void {
        const ctx = gameState.ctx;
        ctx.moveTo(x, y + unit / 2);
        ctx.lineTo(x + unit, y + unit / 2);
    }

    // Arc center: (x + unit, y + unit) — bottom-right of cell
    static wallTLC(x: number, y: number): void {
        const ctx = gameState.ctx;
        ctx.moveTo(x + unit / 2, y + unit);
        ctx.arc(x + unit, y + unit, unit / 2, Math.PI, 1.5 * Math.PI, false);
    }

    // Arc center: (x, y + unit) — bottom-left of cell
    static wallTRC(x: number, y: number): void {
        const ctx = gameState.ctx;
        ctx.moveTo(x, y + unit / 2);
        ctx.arc(x, y + unit, unit / 2, 1.5 * Math.PI, 2 * Math.PI, false);
    }

    // Arc center: (x, y) — top-left of cell
    static wallBRC(x: number, y: number): void {
        const ctx = gameState.ctx;
        ctx.moveTo(x + unit / 2, y);
        ctx.arc(x, y, unit / 2, 0, 0.5 * Math.PI, false);
    }

    // Arc center: (x + unit, y) — top-right of cell
    static wallBLC(x: number, y: number): void {
        const ctx = gameState.ctx;
        ctx.moveTo(x + unit, y + unit / 2);
        ctx.arc(x + unit, y, unit / 2, 0.5 * Math.PI, Math.PI, false);
    }

    static cageGate(): void {
        const ctx = gameState.ctx;
        const x = 11 * unit;
        const y = 16.5 * unit;
        ctx.beginPath();
        ctx.strokeStyle = 'lightpink';
        ctx.moveTo(x + unit + unit / 2, y - unit / 2);
        ctx.lineTo(x + 4 * unit + unit / 2, y - unit / 2);
        ctx.stroke();
    }

    static hud(): void {
        const ctx = gameState.ctx;
        const fontSize = Math.round(unit * 0.8);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textBaseline = 'top';

        // Score (top-left)
        ctx.fillStyle = 'white';
        ctx.textAlign = 'left';
        ctx.fillText('1UP', unit, unit * 0.1);
        ctx.fillText(String(Stats.currentScore).padStart(6, ' '), unit, unit * 1.0);

        // High score (top-center)
        ctx.textAlign = 'center';
        ctx.fillText('HIGH SCORE', gameState.canvas.width / 2, unit * 0.1);
        ctx.fillText(String(Stats.highScore).padStart(6, ' '), gameState.canvas.width / 2, unit * 1.0);

        // Level (top-right)
        ctx.textAlign = 'right';
        ctx.fillText(`L${gameState.level}`, gameState.canvas.width - unit, unit * 0.1);

        // Lives (bottom row, represented as small yellow circles)
        const livesY = (gridH - 1) * unit + unit / 2;
        ctx.fillStyle = 'yellow';
        for (let i = 0; i < gameState.sharedLives; i++) {
            const cx = unit + i * unit * 1.4;
            const r  = unit * 0.35;
            ctx.beginPath();
            ctx.moveTo(cx, livesY);
            ctx.arc(cx, livesY, r, 0.2 * Math.PI, 1.8 * Math.PI, false);
            ctx.closePath();
            ctx.fill();
        }

        // Fruit/level counter (bottom-right, last 7 fruits)
        Draw.fruitCounter();
    }

    static readyText(): void {
        if (!gameState.showReady) return;
        const ctx = gameState.ctx;
        const fontSize = Math.round(unit * 0.9);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'yellow';
        // Row 20 is the open corridor inside the enemy house enclosure
        ctx.fillText('READY!', gameState.canvas.width / 2, 20 * unit + unit / 2);
    }

    static gameOverScreen(): void {
        const ctx = gameState.ctx;
        const cx = gameState.canvas.width / 2;
        const cy = gameState.canvas.height / 2;

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, gameState.canvas.width, gameState.canvas.height);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = `bold ${Math.round(unit * 1.4)}px monospace`;
        ctx.fillStyle = 'red';
        ctx.fillText('GAME OVER', cx, cy - unit);

        ctx.font = `bold ${Math.round(unit * 0.85)}px monospace`;
        ctx.fillStyle = 'white';
        ctx.fillText(`SCORE  ${Stats.currentScore}`, cx, cy + unit * 1.2);
    }

    static playerSelectScreen(playerCount: number, controllerMode: boolean, connectedCount: number): void {
        const ctx = gameState.ctx;
        const w = gameState.canvas.width;
        const h = gameState.canvas.height;
        const cx = w / 2;

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Title
        ctx.fillStyle = 'yellow';
        ctx.font = `bold ${Math.round(unit * 1.3)}px monospace`;
        ctx.fillText('SELECT PLAYERS', cx, unit * 2.5);

        // Mode toggle
        const modeLabel = controllerMode ? 'PAD SHIFT' : 'KEYBOARD';
        ctx.fillStyle = '#aaa';
        ctx.font = `bold ${Math.round(unit * 0.9)}px monospace`;
        ctx.fillText(`\u25C4  ${modeLabel}  \u25BA`, cx, unit * 5);
        ctx.fillStyle = '#555';
        ctx.font = `${Math.round(unit * 0.48)}px monospace`;
        ctx.fillText('\u2190 \u2192 or swipe left/right to change mode', cx, unit * 6.3);

        // Max players achievable with current mode + connected controllers:
        // PAD SHIFT: P1=keyboard, P2=pad0 ... so kbd + N pads = N+1 players
        // KEYBOARD:  P1=keyboard+pad0, P2=pad1 ... pad0 is used by P1, so extra players = N-1
        const maxAvail = controllerMode
            ? Math.min(1 + connectedCount, 4)
            : Math.min(Math.max(connectedCount, 1), 4);

        // Player count rows (1–4 pac-man icons each)
        const rowYs = [unit * 9, unit * 11.5, unit * 14, unit * 16.5];
        const iconSpacing = unit * 1.7;

        for (let count = 1; count <= 4; count++) {
            const isSelected = count === playerCount;
            const isAvail    = count <= maxAvail;
            const y          = rowYs[count - 1];
            const iconR      = isSelected ? unit * 0.5 : unit * 0.42;
            const totalSpan  = (count - 1) * iconSpacing;

            // Row highlight
            if (isSelected) {
                ctx.fillStyle = 'rgba(255,255,0,0.07)';
                ctx.fillRect(0, y - unit, w, unit * 2);
            }

            // Player icons
            for (let i = 0; i < count; i++) {
                const ix = cx - totalSpan / 2 + i * iconSpacing;
                // P1 (i=0) always has keyboard; others need a specific pad index
                // PAD SHIFT: player i+1 needs pad[i-1]  →  padNeeded = i-1
                // KEYBOARD:  player i+1 needs pad[i]    →  padNeeded = i
                const padNeeded = controllerMode ? i - 1 : i;
                const hasInput  = i === 0 || padNeeded < connectedCount;

                ctx.fillStyle = isSelected
                    ? (hasInput ? 'yellow' : '#664400')
                    : isAvail
                        ? (hasInput ? '#777' : '#333')
                        : '#222';

                ctx.beginPath();
                ctx.moveTo(ix, y);
                ctx.arc(ix, y, iconR, 0.2 * Math.PI, 1.8 * Math.PI, false);
                ctx.closePath();
                ctx.fill();
            }
        }

        // Up/down navigation arrows — only shown when there are counts to navigate to
        const selY = rowYs[playerCount - 1];
        ctx.font = `${Math.round(unit * 0.7)}px monospace`;
        ctx.fillStyle = playerCount > 1 ? '#aaa' : '#333';
        ctx.fillText('\u25B2', cx, selY - unit * 1.3);
        ctx.fillStyle = playerCount < maxAvail ? '#aaa' : '#333';
        ctx.fillText('\u25BC', cx, selY + unit * 1.3);

        // Navigation hints
        ctx.fillStyle = '#555';
        ctx.font = `${Math.round(unit * 0.48)}px monospace`;
        ctx.fillText('\u2191 \u2193 or swipe up/down to change count', cx, unit * 18.3);

        // Start instruction
        ctx.fillStyle = 'white';
        ctx.font = `bold ${Math.round(unit * 0.9)}px monospace`;
        ctx.fillText('TAP OR PRESS START', cx, unit * 20.2);

        // Control legend
        ctx.fillStyle = '#666';
        ctx.font = `${Math.round(unit * 0.48)}px monospace`;
        ctx.fillText('CONTROLLER: A   KEYBOARD: Enter   TOUCH: Tap', cx, unit * 21.5);

        if (connectedCount === 0) {
            ctx.fillStyle = '#444';
            ctx.fillText('Connect controllers for more players', cx, unit * 22.8);
        }
    }

    static scorePopups(): void {
        const ctx = gameState.ctx;
        const now = Time.timeSinceStart;
        const fontSize = Math.round(unit * 0.7);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'cyan';
        for (const popup of gameState.scorePopups) {
            if (now < popup.endTime) {
                ctx.fillText(String(popup.score), popup.x, popup.y);
            }
        }
        gameState.scorePopups = gameState.scorePopups.filter(p => now < p.endTime);
    }

    static level(): void {
        Draw.background();
        Draw.walls();
        Draw.cageGate();
        Draw.dots();
        Draw.fruit();
    }

    // ── Debug Overlay ─────────────────────────────────────────────────────────

    static debug(): void {
        if (!gameState.debugEnabled) return;
        const ctx = gameState.ctx;
        if (gameState.debugShowRedZones)     Draw.debugRedZones(ctx);
        if (gameState.debugShowTargetTiles)  Draw.debugTargetTiles(ctx);
        if (gameState.debugShowTargetingViz) Draw.debugTargetingViz(ctx);
        if (gameState.debugShowModes)        Draw.debugModes(ctx);
        if (gameState.debugShowEnemyPaths)   Draw.debugEnemyPaths(ctx);
        if (gameState.debugTilePicker)       Draw.debugTilePickerOverlay(ctx);
    }

    private static debugTilePickerOverlay(ctx: CanvasRenderingContext2D): void {
        const t = gameState.debugSelectedTile;
        if (!t) return;

        const TILE_NAMES: Record<number, string> = { 0: 'wall', 2: 'door', 3: 'dot', 4: 'energizer', 5: 'empty' };
        const raw = Levels.levelDynamic[t.y]?.[t.x];
        const tileName = raw !== undefined ? (TILE_NAMES[raw] ?? String(raw)) : 'oob';
        const label = `(${t.x}, ${t.y})  ${tileName}`;

        // Highlight selected tile
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = 'white';
        ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x * unit + 1, t.y * unit + 1, unit - 2, unit - 2);
        ctx.restore();

        // Coordinate label — positioned above the tile, flipped below if too close to top
        const labelPadX = 6, labelPadY = 4;
        ctx.font = 'bold 13px monospace';
        const tw = ctx.measureText(label).width;
        const boxW = tw + labelPadX * 2;
        const boxH = 13 + labelPadY * 2;
        let bx = t.x * unit + unit / 2 - boxW / 2;
        let by = t.y * unit - boxH - 4;
        // clamp horizontally
        bx = Math.max(2, Math.min(gameState.canvas.width - boxW - 2, bx));
        // flip below tile if too close to top
        if (by < 2) by = t.y * unit + unit + 4;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.82)';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, boxW, boxH);
        ctx.fillStyle = 'white';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label, bx + labelPadX, by + labelPadY);
        ctx.restore();
    }

    private static debugRedZones(ctx: CanvasRenderingContext2D): void {
        // The 4 T-junctions where enemies cannot turn upward in scatter/chase mode.
        // Green = restriction lifted (frightened), Red = upward blocked (scatter/chase).
        const RED_ZONES = RED_ZONE_TILES;
        const blocked = gameState.frightenedRemaining <= 0;
        const color   = blocked ? 'red' : '#00e676';

        for (const { x, y } of RED_ZONES) {
            const px = x * unit, py = y * unit;
            const cx = px + unit / 2, cy = py + unit / 2;
            const r  = unit * 0.28;
            ctx.save();
            // Tile fill
            ctx.globalAlpha = 0.30;
            ctx.fillStyle = color;
            ctx.fillRect(px, py, unit, unit);
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 1, py + 1, unit - 2, unit - 2);
            // Upward arrow
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy + r);
            ctx.lineTo(cx, cy - r);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - r * 0.5, cy - r * 0.45);
            ctx.lineTo(cx, cy - r);
            ctx.lineTo(cx + r * 0.5, cy - r * 0.45);
            ctx.stroke();
            // Prohibition slash (only when blocked)
            if (blocked) {
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(cx - r * 0.65, cy - r * 0.75);
                ctx.lineTo(cx + r * 0.65, cy - r * 0.1);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    private static debugArrow(
        ctx: CanvasRenderingContext2D,
        x1: number, y1: number,
        x2: number, y2: number,
        color: string,
        alpha = 0.9,
    ): void {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 4) return;
        const headLen = Math.min(14, len * 0.28);
        const angle = Math.atan2(dy, dx);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // BFS from enemy tile to target tile, respecting walls (and door for non-eyes).
    // Returns array of {x,y} tiles from enemy to target, or [] if unreachable.
    private static bfsPath(
        sx: number, sy: number,
        tx: number, ty: number,
        allowDoor: boolean,
    ): Array<{ x: number; y: number }> {
        const key = (x: number, y: number) => `${x},${y}`;
        const queue: Array<{ x: number; y: number; path: Array<{ x: number; y: number }> }> = [
            { x: sx, y: sy, path: [{ x: sx, y: sy }] },
        ];
        const visited = new Set<string>([key(sx, sy)]);
        const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
        while (queue.length) {
            const { x, y, path } = queue.shift()!;
            if (x === tx && y === ty) return path;
            for (const { dx, dy } of dirs) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
                if (visited.has(key(nx, ny))) continue;
                const tile = Levels.levelSetup[ny]?.[nx] ?? 0;
                if (tile === 0) continue;
                if (tile === 2 && !allowDoor) continue;
                visited.add(key(nx, ny));
                queue.push({ x: nx, y: ny, path: [...path, { x: nx, y: ny }] });
            }
        }
        return [];
    }

    private static debugEnemyPaths(ctx: CanvasRenderingContext2D): void {
        // Lane index per enemy — gives each a unique perpendicular offset
        const LANE: Record<string, number> = { red: 0, hotpink: 1, cyan: 2, orange: 3 };
        const LANE_WIDTH = 3.5; // px between lanes
        // Offsets centred around 0: -1.5, -0.5, +0.5, +1.5
        const laneOffset = (color: string) => (LANE[color] ?? 0) * LANE_WIDTH - LANE_WIDTH * 1.5;

        for (const enemy of gameState.enemies) {
            const mode = enemy.enemyMode;
            if (!mode || mode === 'house' || mode === 'exiting' || mode === 'frightened') continue;
            const t = gameState.debugEnemyTargets[enemy.color];
            if (!t) continue;

            const gx = enemy.roundedX(), gy = enemy.roundedY();
            const allowDoor = mode === 'eyes';
            const path = Draw.bfsPath(gx, gy, t.x, t.y, allowDoor);
            if (path.length < 2) continue;

            const off = laneOffset(enemy.color);

            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = enemy.color;
            ctx.fillStyle = enemy.color;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);

            for (let i = 0; i < path.length - 1; i++) {
                const cx1 = path[i].x * unit + unit / 2,   cy1 = path[i].y * unit + unit / 2;
                const cx2 = path[i+1].x * unit + unit / 2, cy2 = path[i+1].y * unit + unit / 2;

                // Perpendicular to this segment
                const dx = cx2 - cx1, dy = cy2 - cy1;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const px = -dy / len * off, py = dx / len * off;

                const ax = cx1 + px, ay = cy1 + py;
                const bx = cx2 + px, by = cy2 + py;

                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();

                // Small arrowhead at end of each segment
                ctx.setLineDash([]);
                Draw.arrowhead(ctx, ax, ay, bx, by, 6);
                ctx.setLineDash([4, 3]);
            }

            // Large arrowhead at the final point of the path
            const last = path[path.length - 1];
            const prev = path[path.length - 2];
            const ex1 = prev.x * unit + unit / 2, ey1 = prev.y * unit + unit / 2;
            const ex2 = last.x * unit + unit / 2, ey2 = last.y * unit + unit / 2;
            const edx = ex2 - ex1, edy = ey2 - ey1;
            const elen = Math.sqrt(edx * edx + edy * edy) || 1;
            const epx = -edy / elen * off, epy = edx / elen * off;
            ctx.setLineDash([]);
            Draw.arrowhead(ctx, ex1 + epx, ey1 + epy, ex2 + epx, ey2 + epy, 10);

            ctx.restore();
        }
    }

    private static arrowhead(
        ctx: CanvasRenderingContext2D,
        x1: number, y1: number,
        x2: number, y2: number,
        headLen: number,
    ): void {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
    }

    private static debugTargetTiles(ctx: CanvasRenderingContext2D): void {
        for (const enemy of gameState.enemies) {
            const t = gameState.debugEnemyTargets[enemy.color];
            if (!t) continue;
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = enemy.color;
            ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = enemy.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(t.x * unit + 1, t.y * unit + 1, unit - 2, unit - 2);
            ctx.restore();
        }
    }

    private static debugTargetingViz(ctx: CanvasRenderingContext2D): void {
        const tc = (tx: number, ty: number) => ({ x: tx * unit + unit / 2, y: ty * unit + unit / 2 });

        for (const enemy of gameState.enemies) {
            const mode = enemy.enemyMode;
            if (!mode || mode === 'house' || mode === 'exiting' || mode === 'frightened') continue;

            const t = gameState.debugEnemyTargets[enemy.color];
            if (!t) continue;
            const tp = tc(t.x, t.y);

            if (enemy.color === 'cyan' && mode === 'chase') {
                // Inky: dashed line Blinky→pivot, solid arrow pivot→target
                const pivot = gameState.debugInkyPivot;
                if (pivot) {
                    const pp = tc(pivot.x, pivot.y);
                    const bl = gameState.blinky;
                    ctx.save();
                    ctx.globalAlpha = 0.55;
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 4]);
                    ctx.beginPath();
                    ctx.moveTo(bl.x, bl.y);
                    ctx.lineTo(pp.x, pp.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                    // pivot marker
                    ctx.save();
                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = 'white';
                    ctx.beginPath();
                    ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                    // doubled vector: pivot → target
                    Draw.debugArrow(ctx, pp.x, pp.y, tp.x, tp.y, enemy.color);
                }
            } else if (enemy.color === 'orange' && mode === 'chase') {
                // Clyde: 8-tile radius circle + arrow to target
                const radiusPx = 8 * unit;
                ctx.save();
                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = enemy.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.arc(enemy.x, enemy.y, radiusPx, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
                Draw.debugArrow(ctx, enemy.x, enemy.y, tp.x, tp.y, enemy.color);
            } else if (enemy.color === 'hotpink' && mode === 'chase') {
                // Pinky: dashed arrow Player→4-ahead, then arrow 4-ahead→target
                const ahead = gameState.debugPinkyAhead;
                if (ahead) {
                    const ap = tc(ahead.x, ahead.y);
                    const pm = gameState.players[0]?.actor;
                    if (pm) {
                        ctx.save();
                        ctx.globalAlpha = 0.5;
                        ctx.strokeStyle = enemy.color;
                        ctx.lineWidth = 1.5;
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath();
                        ctx.moveTo(pm.x, pm.y);
                        ctx.lineTo(ap.x, ap.y);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.restore();
                    }
                }
                Draw.debugArrow(ctx, enemy.x, enemy.y, tp.x, tp.y, enemy.color);
            } else {
                // Blinky (chase/scatter) and eyes: simple arrow enemy→target
                Draw.debugArrow(ctx, enemy.x, enemy.y, tp.x, tp.y, enemy.color);
            }
        }
    }

    private static debugModes(ctx: CanvasRenderingContext2D): void {
        const modeLabel: Record<string, string> = {
            scatter: 'SCATTER', chase: 'CHASE', frightened: 'FLEE',
            eyes: 'EYES', house: 'HOUSE', exiting: 'EXIT',
        };
        const globalMode = `GLOBAL: ${(gameState.scatterChaseIndex < 8
            ? ['scatter','chase','scatter','chase','scatter','chase','scatter','chase'][gameState.scatterChaseIndex]
            : 'chase').toUpperCase()}`;

        // Global mode badge — top-center below HUD
        ctx.save();
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const gw = ctx.measureText(globalMode).width + 8;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(gameState.canvas.width / 2 - gw / 2, 42, gw, 14);
        ctx.fillStyle = 'white';
        ctx.fillText(globalMode, gameState.canvas.width / 2, 44);
        ctx.restore();

        // Per-enemy mode badges above each enemy
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (const enemy of gameState.enemies) {
            const label = modeLabel[enemy.enemyMode ?? ''] ?? (enemy.enemyMode ?? '');
            const badgeY = enemy.y - enemy.scale * unit * 0.75;
            ctx.save();
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(enemy.x - tw / 2 - 3, badgeY - 11, tw + 6, 11);
            ctx.fillStyle = enemy.color;
            ctx.fillText(label, enemy.x, badgeY);
            ctx.restore();
        }
    }
}
