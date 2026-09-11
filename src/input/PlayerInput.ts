import type { Direction, IGameObject } from '../types';

/** Frames a direction stays queued after being pressed into a wall. */
export const BUFFER_FRAMES = 8;

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

/**
 * The writable view of a PlayerInput's own fields. The shared helpers below
 * read the held flags and rewrite the buffer, so an implementation passes
 * itself in: `applyPlayerInput(this, actor)`.
 */
export type PlayerInputState = { -readonly [K in keyof Omit<PlayerInput, 'update' | 'destroy'>]: PlayerInput[K] };

/** True when the tile next to `actor` in `dir` is walkable (tile value > 2). */
export function isDirOpen(actor: IGameObject, dir: Direction): boolean {
    const tile =
        dir === 'left'  ? actor.leftObject()   :
        dir === 'right' ? actor.rightObject()  :
        dir === 'up'    ? actor.topObject()    :
                          actor.bottomObject();
    return (tile ?? 0) > 2;
}

/** Queue `dir` to be retried for the next BUFFER_FRAMES frames. */
export function bufferDir(state: PlayerInputState, dir: Direction): void {
    state.bufferedDir = dir;
    state.bufferedDirFramesLeft = BUFFER_FRAMES;
}

/**
 * Turn held flags and the buffered direction into actor movement.
 *
 * Held directions apply every frame the tile is open, so holding into a wall
 * until a corridor opens keeps working. The buffer covers the opposite case: a
 * turn pressed slightly early, retried each frame until it fits or expires.
 */
export function applyPlayerInput(state: PlayerInputState, actor: IGameObject): void {
    if (state.leftPressed  && isDirOpen(actor, 'left'))  actor.moveDir = 'left';
    if (state.upPressed    && isDirOpen(actor, 'up'))    actor.moveDir = 'up';
    if (state.rightPressed && isDirOpen(actor, 'right')) actor.moveDir = 'right';
    if (state.downPressed  && isDirOpen(actor, 'down'))  actor.moveDir = 'down';

    if (state.bufferedDir === null) return;

    if (isDirOpen(actor, state.bufferedDir)) {
        actor.moveDir = state.bufferedDir;
        state.bufferedDir = null;
        state.bufferedDirFramesLeft = 0;
    } else {
        state.bufferedDirFramesLeft--;
        if (state.bufferedDirFramesLeft <= 0) state.bufferedDir = null;
    }
}
