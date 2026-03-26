import { unit, gridW, gridH } from '../constants';
import type { IGameObject, Direction } from '../types';
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
    static pacmanAnim = 0;
    static pacmanAnimTime = 0;

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

    static pacman(obj: IGameObject): void {
        const { color, x, y, scale } = obj;
        const ctx = gameState.ctx;
        const frames = [0.0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1];
        const frameChangePerSecond = 30;
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

        // Advance only during active game time (pauses when frozen or eating-ghost freeze)
        if (!gameState.frozen && !gameState.pacmanFrozen) {
            Draw.pacmanAnimTime += Time.deltaTime;
        }
        Draw.pacmanAnim = Math.floor(Draw.pacmanAnimTime * frameChangePerSecond) % frames.length;
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

    static ghost(obj: IGameObject): void {
        const { color, x, y, scale, ghostMode } = obj;

        if (ghostMode === 'eyes') {
            Draw.drawGhostEyes(color, x, y, scale, obj.moveDir);
            return;
        }

        if (ghostMode === 'frightened') {
            const flashCount = Draw.getFrightenedFlashCount(gameState.level);
            const flashDuration = flashCount * 14 / 60;
            const timeLeft = gameState.frightenedRemaining;
            const isFlashing = flashCount > 0 && timeLeft < flashDuration && timeLeft > 0;
            let ghostColor = '#0000cc';
            if (isFlashing) {
                // Use wall-clock time so flash rate is consistent at any frame rate
                ghostColor = Math.floor(Time.timeSinceStart * (60 / 7)) % 2 === 0 ? '#0000cc' : 'white';
            }
            Draw.drawGhostBody(ghostColor, x, y, scale);
            Draw.drawFrightenedEyes(x, y, scale, ghostColor);
            return;
        }

        Draw.drawGhostBody(color, x, y, scale);
        Draw.drawGhostEyes(color, x, y, scale, obj.moveDir);
    }

    static drawFrightenedEyes(x: number, y: number, scale: number, bodyColor: string): void {
        const ctx = gameState.ctx;
        const ghostSize = scale * unit;
        const eyeOffsetX = ghostSize * 0.3;
        const eyeOffsetY = ghostSize * 0.15;
        const eyeRadius  = ghostSize * 0.12;
        const dotColor = bodyColor === 'white' ? '#0000cc' : 'white';
        ctx.fillStyle = dotColor;
        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(x + side * eyeOffsetX, y - eyeOffsetY, eyeRadius, 0, Math.PI * 2);
            ctx.fill();
        }
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

    static drawGhostEyes(_color: string, x: number, y: number, scale: number, dir?: Direction): void {
        const ctx = gameState.ctx;
        const ghostSize = scale * unit;
        const eyeOffsetX = ghostSize * 0.42;
        const eyeOffsetY = ghostSize * 0.1;
        const eyeRadius  = ghostSize * 0.35;
        const pupilRadius = ghostSize * 0.15;
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
        for (let i = 0; i < Stats.lives; i++) {
            ctx.beginPath();
            ctx.arc(unit + i * unit * 1.4, livesY, unit * 0.35, 0.2 * Math.PI, 1.8 * Math.PI, false);
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
        // Row 20 is the open corridor inside the ghost house enclosure
        ctx.fillText('READY!', gameState.canvas.width / 2, 20 * unit + unit / 2);
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
    }

    private static debugRedZones(ctx: CanvasRenderingContext2D): void {
        // The 4 T-junctions where ghosts cannot turn upward in scatter/chase mode.
        // Green = restriction lifted (frightened), Red = upward blocked (scatter/chase).
        const RED_ZONES = [{ x: 6, y: 14 }, { x: 21, y: 14 }, { x: 6, y: 26 }, { x: 21, y: 26 }];
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

    private static debugTargetTiles(ctx: CanvasRenderingContext2D): void {
        for (const ghost of gameState.ghosts) {
            const t = gameState.debugGhostTargets[ghost.color];
            if (!t) continue;
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = ghost.color;
            ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = ghost.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(t.x * unit + 1, t.y * unit + 1, unit - 2, unit - 2);
            ctx.restore();
        }
    }

    private static debugTargetingViz(ctx: CanvasRenderingContext2D): void {
        const tc = (tx: number, ty: number) => ({ x: tx * unit + unit / 2, y: ty * unit + unit / 2 });

        for (const ghost of gameState.ghosts) {
            const mode = ghost.ghostMode;
            if (!mode || mode === 'house' || mode === 'exiting' || mode === 'frightened') continue;

            const t = gameState.debugGhostTargets[ghost.color];
            if (!t) continue;
            const tp = tc(t.x, t.y);

            if (ghost.color === 'cyan' && mode === 'chase') {
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
                    Draw.debugArrow(ctx, pp.x, pp.y, tp.x, tp.y, ghost.color);
                }
            } else if (ghost.color === 'orange' && mode === 'chase') {
                // Clyde: 8-tile radius circle + arrow to target
                const radiusPx = 8 * unit;
                ctx.save();
                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = ghost.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.arc(ghost.x, ghost.y, radiusPx, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
                Draw.debugArrow(ctx, ghost.x, ghost.y, tp.x, tp.y, ghost.color);
            } else if (ghost.color === 'hotpink' && mode === 'chase') {
                // Pinky: dashed arrow Pac-Man→4-ahead, then arrow 4-ahead→target
                const ahead = gameState.debugPinkyAhead;
                if (ahead) {
                    const ap = tc(ahead.x, ahead.y);
                    const pm = gameState.pacman;
                    ctx.save();
                    ctx.globalAlpha = 0.5;
                    ctx.strokeStyle = ghost.color;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(pm.x, pm.y);
                    ctx.lineTo(ap.x, ap.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
                Draw.debugArrow(ctx, ghost.x, ghost.y, tp.x, tp.y, ghost.color);
            } else {
                // Blinky (chase/scatter) and eyes: simple arrow ghost→target
                Draw.debugArrow(ctx, ghost.x, ghost.y, tp.x, tp.y, ghost.color);
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

        // Per-ghost mode badges above each ghost
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (const ghost of gameState.ghosts) {
            const label = modeLabel[ghost.ghostMode ?? ''] ?? (ghost.ghostMode ?? '');
            const badgeY = ghost.y - ghost.scale * unit * 0.75;
            ctx.save();
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(ghost.x - tw / 2 - 3, badgeY - 11, tw + 6, 11);
            ctx.fillStyle = ghost.color;
            ctx.fillText(label, ghost.x, badgeY);
            ctx.restore();
        }
    }
}
