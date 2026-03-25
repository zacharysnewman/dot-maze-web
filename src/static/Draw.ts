import { unit, baseUnit, gridW, gridH } from '../constants';
import { gameState } from '../game-state';
import { Levels } from './Levels';
import { Stats } from './Stats';
import { Time } from './Time';

type WallDrawFn = (x: number, y: number) => void;

export class Draw {
    static pacmanAnim = 0;

    static normalizedUnit(): number {
        return unit / baseUnit;
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

    static pacman(color: string, x: number, y: number, scale: number): void {
        const ctx = gameState.ctx;
        const frames = [0.0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1];
        const frameChangePerSecond = 30;
        const size = scale * unit;

        let dirMultiplier = 1;
        switch (gameState.pacman.moveDir) {
            case 'left':  dirMultiplier = 1;   break;
            case 'right': dirMultiplier = 0;   break;
            case 'up':    dirMultiplier = 1.5; break;
            case 'down':  dirMultiplier = 0.5; break;
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size,
            frames[Draw.pacmanAnim] * Math.PI + Math.PI * dirMultiplier,
            (1.0 + frames[Draw.pacmanAnim]) * Math.PI + Math.PI * dirMultiplier,
            false);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, size,
            (1 - frames[Draw.pacmanAnim]) * Math.PI + Math.PI * dirMultiplier,
            (1 + (1 - frames[Draw.pacmanAnim])) * Math.PI + Math.PI * dirMultiplier,
            false);
        ctx.fill();

        const event = Time.frameCount % Math.round(60 / frameChangePerSecond);
        if (event === 0) Draw.pacmanAnim++;
        if (Draw.pacmanAnim >= frames.length) Draw.pacmanAnim = 0;
    }

    static ghost(color: string, x: number, y: number, scale: number): void {
        Draw.drawGhostBody(color, x, y, scale);
        Draw.drawGhostEyes(color, x, y, scale);
    }

    static drawGhostBody(color: string, x: number, y: number, scale: number): void {
        const ctx = gameState.ctx;
        const ghostSize = scale * unit;
        let curX = x;
        let curY = y;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(curX, curY);

        ctx.arc(curX, curY, ghostSize, Math.PI, 0, false);

        curX += unit - ghostSize / 2;
        curY += ghostSize / 2 + ghostSize / 3;
        ctx.lineTo(curX, curY);

        const ghostBump = ghostSize / 3;
        for (let i = 0; i < 3; i++) {
            curX -= ghostBump;
            ctx.lineTo(curX, curY);
            ctx.arc(curX, curY, ghostBump, Math.PI * 2, Math.PI, false);
            curX -= ghostBump;
        }

        ctx.lineTo(curX, curY);

        curY -= ghostSize / 2 + ghostSize / 3;
        ctx.lineTo(curX, curY);

        ctx.fill();
    }

    static drawGhostEyes(_color: string, x: number, y: number, scale: number): void {
        const ctx = gameState.ctx;
        const ghostSize = scale * unit;
        const eyeOffsetX = ghostSize * 0.42;
        const eyeOffsetY = ghostSize * 0.1;
        const eyeRadius  = ghostSize * 0.35;
        const pupilRadius = ghostSize * 0.15;
        const pupilOffsetX = ghostSize * 0.1;
        const pupilOffsetY = ghostSize * 0.08;

        for (const side of [-1, 1]) {
            const ex = x + side * eyeOffsetX;
            const ey = y - eyeOffsetY;

            // White
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(ex, ey, eyeRadius, 0, Math.PI * 2);
            ctx.fill();

            // Dark blue pupil
            ctx.fillStyle = '#1a1aff';
            ctx.beginPath();
            ctx.arc(ex + side * pupilOffsetX, ey + pupilOffsetY, pupilRadius, 0, Math.PI * 2);
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
        for (let i = 0; i < Stats.lives; i++) {
            ctx.beginPath();
            ctx.arc(unit + i * unit * 1.4, livesY, unit * 0.35, 0.2 * Math.PI, 1.8 * Math.PI, false);
            ctx.fill();
        }
    }

    static gameOverScreen(): void {
        const ctx = gameState.ctx;
        const cx = gameState.canvas.width / 2;
        const cy = gameState.canvas.height / 2;
        const fontSize = Math.round(unit * 1.2);

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, gameState.canvas.width, gameState.canvas.height);

        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'red';
        ctx.fillText('GAME OVER', cx, cy);
    }

    static level(): void {
        Draw.background();
        Draw.walls();
        Draw.cageGate();
        Draw.dots();
    }
}
