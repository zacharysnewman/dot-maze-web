import type { Direction, IGameObject } from '../types';

export interface PlayerInput {
    readonly leftPressed: boolean;
    readonly rightPressed: boolean;
    readonly upPressed: boolean;
    readonly downPressed: boolean;
    readonly bufferedDir: Direction | null;
    readonly bufferedDirFramesLeft: number;
    update(actor: IGameObject): void;
    destroy(): void;
}
