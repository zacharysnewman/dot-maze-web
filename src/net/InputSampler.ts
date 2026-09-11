import type { PlayerInput } from '../input/PlayerInput';
import type { Direction, IGameObject, TileValue } from '../types';
import { TILE_EMPTY } from '../tiles';
import { encodeHeld } from './Protocol';

/**
 * An actor standing in an imaginary open crossroads. Every direction is
 * walkable, so any turn a player asks for is accepted.
 */
const OPEN_CROSSROADS: IGameObject = {
    color: 'yellow', x: 0, y: 0, scale: 1, moveSpeed: 1, moveDir: 'left',
    update() {},
    roundedX: () => 0, roundedY: () => 0,
    gridX: () => 0, gridY: () => 0,
    roundedAbsoluteX: () => 0, roundedAbsoluteY: () => 0,
    leftObject:   (): TileValue => TILE_EMPTY,
    rightObject:  (): TileValue => TILE_EMPTY,
    topObject:    (): TileValue => TILE_EMPTY,
    bottomObject: (): TileValue => TILE_EMPTY,
};

export interface SampledInput {
    held: number;
    buffered: Direction | null;
}

/**
 * Reads what the local player is asking for, on a machine that runs no
 * simulation.
 *
 * A gamepad only updates its held flags inside `update()`, and a buffered turn
 * is only consumed there, so the sampler calls `update()` against an actor in
 * an open crossroads. Every direction is walkable there, so the buffer is
 * consumed the moment it is set — which is the point: a turn is reported once,
 * on the frame it was asked for, and the host decides whether the real maze
 * allows it.
 *
 * Sending the buffered direction on every frame instead would make it
 * immortal: the host retries a buffered turn for 8 frames and then drops it,
 * and a client repeating it would re-arm it forever.
 */
export class InputSampler {
    constructor(private readonly input: PlayerInput) {}

    sample(): SampledInput {
        const queued = this.input.bufferedDir;
        this.input.update(OPEN_CROSSROADS);
        // Report the turn only on the frame the buffer gave it up. Reading
        // `moveDir` instead would report a held direction every frame, which is
        // the immortal buffer this is here to avoid.
        const consumed = queued !== null && this.input.bufferedDir === null;
        return { held: encodeHeld(this.input), buffered: consumed ? queued : null };
    }

    destroy(): void {
        this.input.destroy();
    }
}
