import { unit } from '../constants';
import { Levels } from '../static/Levels';
import type { Direction, IGameObject, TileValue } from '../types';

type DrawFn        = (obj: IGameObject) => void;
type TileCallbackFn = (x: number, y: number) => void;

export class GameObject implements IGameObject {
    color: string;
    x: number;
    y: number;
    scale: number;
    moveSpeed: number;
    moveDir: Direction;

    private drawFunction: DrawFn;
    private moveFunction: () => void;
    private onTileChangedFunction: TileCallbackFn;
    private onTileCenteredFunction: TileCallbackFn;

    private lastTileX: number;
    private lastTileY: number;
    private checkingForCenter: boolean;

    constructor(
        color: string,
        x: number,
        y: number,
        scale: number,
        moveFunction: () => void,
        drawFunction: DrawFn,
        onTileChangedFunction: TileCallbackFn,
        onTileCenteredFunction: TileCallbackFn,
    ) {
        this.color = color;
        this.x = x * unit + unit / 2;
        this.y = y * unit + unit / 2;
        this.scale = scale;
        this.moveFunction = moveFunction;
        this.drawFunction = drawFunction;
        this.onTileChangedFunction = onTileChangedFunction;
        this.onTileCenteredFunction = onTileCenteredFunction;

        this.lastTileX = this.roundedX();
        this.lastTileY = this.roundedY();
        this.checkingForCenter = false;

        this.moveSpeed = 1.0;
        this.moveDir   = 'left';
    }

    update(): void {
        this.moveFunction();
        this.checkTileUpdates();
        this.drawFunction(this);
    }

    /**
     * Travel to a position as if it had been walked, rather than appearing
     * there.
     *
     * `checkTileUpdates` only ever fires for the tile an object lands on, so
     * assigning a position two tiles away silently skips the one in between —
     * its dot uneaten, anything standing in it never met. Stepping half a tile
     * at a time visits every tile on the way, in order, and `onStep` lets the
     * caller run the checks a normal frame would.
     */
    sweepTo(x: number, y: number, onStep?: () => void): void {
        const maxStep = unit / 2;
        for (;;) {
            const dx = x - this.x;
            const dy = y - this.y;
            const remaining = Math.abs(dx) + Math.abs(dy);
            if (remaining <= maxStep) {
                this.x = x;
                this.y = y;
                this.checkTileUpdates();
                onStep?.();
                return;
            }
            const fraction = maxStep / remaining;
            this.x += dx * fraction;
            this.y += dy * fraction;
            this.checkTileUpdates();
            onStep?.();
        }
    }

    roundedX(): number { return Math.round(this.gridX()); }
    roundedY(): number { return Math.round(this.gridY()); }
    gridX(): number    { return this.x / unit - 0.5; }
    gridY(): number    { return this.y / unit - 0.5; }

    roundedAbsoluteX(): number { return this.roundedX() * unit + unit / 2; }
    roundedAbsoluteY(): number { return this.roundedY() * unit + unit / 2; }

    leftObject(): TileValue | undefined {
        return Levels.levelSetup[this.roundedY()][this.roundedX() - 1] as TileValue | undefined;
    }

    rightObject(): TileValue | undefined {
        return Levels.levelSetup[this.roundedY()][this.roundedX() + 1] as TileValue | undefined;
    }

    topObject(): TileValue | undefined {
        const row = Levels.levelSetup[this.roundedY() - 1];
        return row !== undefined ? row[this.roundedX()] as TileValue | undefined : undefined;
    }

    bottomObject(): TileValue | undefined {
        const row = Levels.levelSetup[this.roundedY() + 1];
        return row !== undefined ? row[this.roundedX()] as TileValue | undefined : undefined;
    }

    private checkTileUpdates(): void {
        if (this.lastTileX !== this.roundedX() || this.lastTileY !== this.roundedY()) {
            this.checkingForCenter = true;
            this.onTileChangedFunction(this.roundedX(), this.roundedY());
        }

        const distX = Math.abs(this.roundedX() - this.gridX());
        const distY = Math.abs(this.roundedY() - this.gridY());

        if (this.checkingForCenter && distX < 0.1 && distY < 0.1) {
            this.checkingForCenter = false;
            this.onTileCenteredFunction(this.roundedX(), this.roundedY());
        }

        this.lastTileX = this.roundedX();
        this.lastTileY = this.roundedY();
    }
}
