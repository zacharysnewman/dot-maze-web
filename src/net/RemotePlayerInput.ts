import { unit } from '../constants';
import type { PlayerInput } from '../input/PlayerInput';
import { applyPlayerInput, bufferDir, isDirOpen } from '../input/PlayerInput';
import type { Direction, IGameObject } from '../types';
import type { InputMsg } from './Protocol';
import { decodeHeld } from './Protocol';

/**
 * How long a turn waits for the player to reach the tile it was asked for.
 * Generous, because it is waiting for a place rather than a moment, but not
 * unbounded — a turn addressed to a tile the player never reaches has to expire.
 */
const WAIT_FOR_PLACE_FRAMES = 24;

/** How far past the asked-for junction a turn can still be honoured. */
const REACH_BACK = unit;

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
    /**
     * Where this player stood when `lastSeq` was first applied — the host's
     * half of the pair the client reconciles against. Recorded at the same
     * point in the input stream as the client's own record of the same seq, so
     * the difference between them is disagreement rather than latency.
     */
    ackX = 0;
    ackY = 0;
    private seqUnapplied = false;
    /** When the last message landed, for noticing a client that went quiet. */
    lastReceivedAt = 0;

    /**
     * Run after every step of a rebuilt path, so the host can make the checks a
     * normal frame would — otherwise a rebuilt corner could carry a player
     * through something it should have met.
     */
    onPathStep: (() => void) | null = null;

    /** Where the pending turn was asked for, in the sender's own position. */
    private turnAt: { x: number; y: number } | null = null;
    private framesWaiting = 0;
    private waitingThisFrame = false;

    /**
     * Apply an input message. Out-of-order and duplicate messages are dropped:
     * transport is unreliable and unordered by design, and a stale held-flag
     * set would stutter the player.
     */
    receive(msg: InputMsg): void {
        if (msg.seq <= this.lastSeq) return;
        this.lastSeq = msg.seq;
        this.seqUnapplied = true;
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
            this.turnAt = { x: msg.x, y: msg.y };
            this.framesWaiting = 0;
        }
    }

    /** Drop held input without dropping the seat — used when a peer goes quiet. */
    clearHeld(): void {
        this.leftPressed = this.rightPressed = this.upPressed = this.downPressed = false;
        this.bufferedDir = null;
        this.bufferedDirFramesLeft = 0;
        this.turnAt = null;
    }

    update(actor: IGameObject): void {
        if (this.seqUnapplied) {
            this.seqUnapplied = false;
            this.ackX = actor.x;
            this.ackY = actor.y;
        }
        this.waitingThisFrame = false;
        this.placeTurn(actor);

        if (!this.waitingThisFrame) {
            applyPlayerInput(this, actor);
            return;
        }

        // Hold the turn back without losing it: the player has not reached the
        // junction it was asked for, and turning at an earlier one would take
        // them somewhere they never chose. The buffer waits for a place, so its
        // frame budget is not spent here.
        const waiting = this.bufferedDir;
        const framesLeft = this.bufferedDirFramesLeft;
        this.bufferedDir = null;
        applyPlayerInput(this, actor);
        this.bufferedDir = waiting;
        this.bufferedDirFramesLeft = framesLeft;
    }

    destroy(): void {
        this.clearHeld();
        this.lastSeq = 0;
        this.lastReceivedAt = 0;
        this.ackX = 0;
        this.ackY = 0;
        this.seqUnapplied = false;
        this.onPathStep = null;
    }

    /**
     * Judge the pending turn against the junction it was asked for rather than
     * wherever the player has got to.
     *
     * A turn is a decision about a place. The host applies one a round trip
     * after the client made it, so by then its player has moved on — and
     * `isDirOpen` asks about the tile it is in *now*. Left alone, a turn made
     * at a junction is tested against the corridor past it, where the wall says
     * no.
     */
    private placeTurn(actor: IGameObject): void {
        if (this.bufferedDir === null || this.turnAt === null) return;

        const horizontal = actor.moveDir === 'left' || actor.moveDir === 'right';
        const forward = actor.moveDir === 'right' || actor.moveDir === 'down' ? 1 : -1;

        // A turn asked for in another corridor belongs to a player that has
        // since been corrected; there is nothing here to place.
        const strayed = horizontal
            ? Math.abs(actor.y - this.turnAt.y)
            : Math.abs(actor.x - this.turnAt.x);
        if (strayed > unit) {
            this.turnAt = null;
            return;
        }

        const travelled = (horizontal ? actor.x - this.turnAt.x : actor.y - this.turnAt.y) * forward;

        if (travelled < -0.01) {
            // Not there yet — wait for the place rather than turning early.
            this.framesWaiting++;
            if (this.framesWaiting > WAIT_FOR_PLACE_FRAMES) {
                this.turnAt = null;
                this.framesWaiting = 0;
                return;
            }
            this.waitingThisFrame = true;
            return;
        }

        if (travelled > REACH_BACK) {
            // Too far past to rebuild honestly — but the player did press this,
            // so forget only the place and let the ordinary buffer take it at
            // the next junction. Discarding it outright would swallow the input
            // entirely, which is worse than taking the turn a corner late.
            this.turnAt = null;
            return;
        }

        if (!isDirOpen(actor, this.bufferedDir)) {
            // A wall that way from here, so this is not the junction they
            // meant. Leave it to the ordinary buffer to retry.
            this.turnAt = null;
            return;
        }

        // Turn where they turned, and spend the distance travelled since on the
        // new corridor. Without that second half the player rounds the corner a
        // round trip late and stays that far behind — and every corner adds
        // another, until the gap is wider than the prediction can absorb.
        const corner = horizontal
            ? { x: this.turnAt.x, y: actor.roundedAbsoluteY() }
            : { x: actor.roundedAbsoluteX(), y: this.turnAt.y };
        this.rebuildCorner(actor, corner, travelled);
    }

    /**
     * Take the turn at the junction it was asked for, and spend the distance
     * already travelled past it on the new corridor instead.
     *
     * Conserving the distance is the point. Simply moving the player back would
     * place them behind where they are on their own screen — and a moment later
     * they could be caught by something they had already passed, which is a
     * death that no simulation without latency would have produced. Walking the
     * same distance around the corner puts them where they would have been all
     * along.
     */
    private rebuildCorner(actor: IGameObject, centre: { x: number; y: number }, overshoot: number): void {
        const turn = this.bufferedDir;
        if (turn === null) return;

        const onStep = this.onPathStep ?? undefined;
        // Back over ground already covered: its dots are eaten and its
        // encounters already happened, so this leg can consume nothing twice.
        actor.sweepTo(centre.x, centre.y, onStep);
        actor.moveDir = turn;
        this.walkOn(actor, overshoot, onStep);

        this.bufferedDir = null;
        this.bufferedDirFramesLeft = 0;
        this.turnAt = null;
        this.framesWaiting = 0;
    }

    /** Travel along the current direction, stopping at a wall. */
    private walkOn(actor: IGameObject, distance: number, onStep?: () => void): void {
        const step = unit / 2;
        let left = distance;
        while (left > 0.01) {
            if (!isDirOpen(actor, actor.moveDir)) return;
            const move = Math.min(step, left);
            const [dx, dy] = HEADING[actor.moveDir];
            actor.sweepTo(actor.x + dx * move, actor.y + dy * move, onStep);
            left -= move;
        }
    }
}

const HEADING: Record<Direction, [number, number]> = {
    left:  [-1, 0],
    right: [1, 0],
    up:    [0, -1],
    down:  [0, 1],
};
