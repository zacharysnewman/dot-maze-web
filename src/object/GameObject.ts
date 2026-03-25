import { unit } from '../constants';
import { Levels } from '../static/Levels';
import type { Direction, IGameObject, TileValue } from '../types';

type DrawFn        = (color: string, x: number, y: number, scale: number) => void;
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
    private lastPosX: number;
    private lastPosY: number;
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
        this.lastPosX  = this.gridX();
        this.lastPosY  = this.gridY();
        this.checkingForCenter = false;

        this.moveSpeed = 1.0;
        this.moveDir   = 'left';
    }

    update(): void {
        this.checkTileUpdates();
        this.moveFunction();
        this.drawFunction(this.color, this.x, this.y, this.scale);
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
        this.lastPosX  = this.gridX();
        this.lastPosY  = this.gridY();
    }
}
