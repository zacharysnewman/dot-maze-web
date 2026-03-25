export type Direction = 'left' | 'right' | 'up' | 'down';

export type TileValue = 0 | 2 | 3 | 4 | 5;

export type GhostMode = 'scatter' | 'chase' | 'frightened' | 'eyes';

export interface IGameObject {
    color: string;
    x: number;
    y: number;
    scale: number;
    moveSpeed: number;
    moveDir: Direction;
    ghostMode?: GhostMode;
    pendingReverse?: boolean;
    update(): void;
    roundedX(): number;
    roundedY(): number;
    gridX(): number;
    gridY(): number;
    roundedAbsoluteX(): number;
    roundedAbsoluteY(): number;
    leftObject(): TileValue | undefined;
    rightObject(): TileValue | undefined;
    topObject(): TileValue | undefined;
    bottomObject(): TileValue | undefined;
}
