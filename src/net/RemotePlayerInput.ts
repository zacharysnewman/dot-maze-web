import type { PlayerInput } from '../input/PlayerInput';
import { applyPlayerInput, bufferDir } from '../input/PlayerInput';
import type { Direction, IGameObject } from '../types';
import type { InputMsg } from './Protocol';
import { decodeHeld } from './Protocol';

/**
 * A player driven by input messages off the wire.
 *
 * This runs on the host, not the client: `update` reads the tiles around the
 * actor and writes `moveDir`, which only the authoritative simulation may do.
 * The client's job is to send held flags and buffered turns; the host decides
 * what they mean against the real maze.
 *
 * Nothing downstream knows the difference between this and a keyboard.
 */
export class RemotePlayerInput implements PlayerInput {
    leftPressed  = false;
    rightPressed = false;
    upPressed    = false;
    downPressed  = false;
    bufferedDir: Direction | null = null;
    bufferedDirFramesLeft = 0;

    /** Highest seq applied, echoed back in snapshots so the client can reconcile. */
    lastSeq = 0;
    /** When the last message landed, for noticing a client that went quiet. */
    lastReceivedAt = 0;

    /**
     * Apply an input message. Out-of-order and duplicate messages are dropped:
     * transport is unreliable and unordered by design, and a stale held-flag
     * set would stutter the player.
     */
    receive(msg: InputMsg): void {
        if (msg.seq <= this.lastSeq) return;
        this.lastSeq = msg.seq;
        this.lastReceivedAt = performance.now();

        const held = decodeHeld(msg.held);
        this.leftPressed  = held.leftPressed;
        this.rightPressed = held.rightPressed;
        this.upPressed    = held.upPressed;
        this.downPressed  = held.downPressed;

        // A buffered turn arrives once and is retried locally until it fits or
        // expires, so re-buffering the same direction every message would make
        // it immortal. Only a direction the sender newly buffered counts.
        if (msg.buffered !== null && msg.buffered !== this.bufferedDir) {
            bufferDir(this, msg.buffered);
        }
    }

    /** Drop held input without dropping the seat — used when a peer goes quiet. */
    clearHeld(): void {
        this.leftPressed = this.rightPressed = this.upPressed = this.downPressed = false;
        this.bufferedDir = null;
        this.bufferedDirFramesLeft = 0;
    }

    update(actor: IGameObject): void {
        applyPlayerInput(this, actor);
    }

    destroy(): void {
        this.clearHeld();
        this.lastSeq = 0;
        this.lastReceivedAt = 0;
    }
}
