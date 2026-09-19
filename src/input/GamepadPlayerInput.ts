import type { PlayerInput } from './PlayerInput';
import { applyPlayerInput, bufferDir } from './PlayerInput';
import { connectedPads, padDirections } from './GamepadRead';
import type { PadDirections } from './GamepadRead';
import type { Direction, IGameObject } from '../types';

export class GamepadPlayerInput implements PlayerInput {
    leftPressed  = false;
    rightPressed = false;
    upPressed    = false;
    downPressed  = false;
    bufferedDir: Direction | null = null;
    bufferedDirFramesLeft = 0;

    private prevLeft  = false;
    private prevRight = false;
    private prevUp    = false;
    private prevDown  = false;

    private readonly gamepadIndex: number;

    // Indices of gamepads seen via gamepadconnected event (persists even when
    // navigator.getGamepads() hasn't been polled yet after a page load).
    private static readonly _seenViaEvent = new Set<number>();
    static {
        window.addEventListener('gamepadconnected',    (e: GamepadEvent) => {
            GamepadPlayerInput._seenViaEvent.add(e.gamepad.index);
        });
        window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
            GamepadPlayerInput._seenViaEvent.delete(e.gamepad.index);
        });
    }

    constructor(gamepadIndex: number) {
        this.gamepadIndex = gamepadIndex;
    }

    // Returns indices of all currently connected gamepads, using the union of
    // the event-tracked set and the live poll so controllers are detected as
    // soon as the browser reports them (even before a button press on some platforms).
    static connectedIndices(): number[] {
        const indices = new Set<number>(GamepadPlayerInput._seenViaEvent);
        for (const gp of connectedPads()) indices.add(gp.index);
        return Array.from(indices).sort((a, b) => a - b);
    }

    // Register a callback that fires whenever a gamepad is connected or disconnected.
    static listenForConnectionChanges(callback: () => void): void {
        window.addEventListener('gamepadconnected',    () => callback());
        window.addEventListener('gamepaddisconnected', () => callback());
    }

    private poll(): PadDirections {
        const gp = navigator.getGamepads()[this.gamepadIndex];
        if (!gp) return { left: false, right: false, up: false, down: false };
        return padDirections(gp);
    }

    update(actor: IGameObject): void {
        const { left, right, up, down } = this.poll();

        this.leftPressed  = left;
        this.rightPressed = right;
        this.upPressed    = up;
        this.downPressed  = down;

        // Buffer on rising edge (fresh press)
        if (left  && !this.prevLeft)  bufferDir(this, 'left');
        if (right && !this.prevRight) bufferDir(this, 'right');
        if (up    && !this.prevUp)    bufferDir(this, 'up');
        if (down  && !this.prevDown)  bufferDir(this, 'down');

        this.prevLeft = left; this.prevRight = right;
        this.prevUp   = up;   this.prevDown  = down;

        applyPlayerInput(this, actor);
    }

    destroy(): void {
        this.leftPressed = this.rightPressed = this.upPressed = this.downPressed = false;
        this.prevLeft = this.prevRight = this.prevUp = this.prevDown = false;
        this.bufferedDir = null;
    }
}
