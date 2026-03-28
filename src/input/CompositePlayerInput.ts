import type { PlayerInput } from './PlayerInput';
import type { Direction, IGameObject } from '../types';

export class CompositePlayerInput implements PlayerInput {
    get leftPressed():  boolean { return this.inputs.some(i => i.leftPressed);  }
    get rightPressed(): boolean { return this.inputs.some(i => i.rightPressed); }
    get upPressed():    boolean { return this.inputs.some(i => i.upPressed);    }
    get downPressed():  boolean { return this.inputs.some(i => i.downPressed);  }

    get bufferedDir(): Direction | null {
        // Return the most recently set buffered direction (highest framesLeft)
        let best: Direction | null = null;
        let bestFrames = 0;
        for (const i of this.inputs) {
            if (i.bufferedDir !== null && i.bufferedDirFramesLeft > bestFrames) {
                best = i.bufferedDir;
                bestFrames = i.bufferedDirFramesLeft;
            }
        }
        return best;
    }

    get bufferedDirFramesLeft(): number {
        let best = 0;
        for (const i of this.inputs) {
            if (i.bufferedDirFramesLeft > best) best = i.bufferedDirFramesLeft;
        }
        return best;
    }

    private readonly inputs: PlayerInput[];

    constructor(inputs: PlayerInput[]) {
        this.inputs = inputs;
    }

    update(actor: IGameObject): void {
        for (const i of this.inputs) i.update(actor);
    }

    destroy(): void {
        for (const i of this.inputs) i.destroy();
    }
}
