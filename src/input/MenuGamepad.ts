import { connectedPads, padConfirmHeld, padDirections } from './GamepadRead';

export interface MenuGamepadEdges {
    confirm: boolean;
    up:      boolean;
    down:    boolean;
    left:    boolean;
    right:   boolean;
}

function noEdges(): MenuGamepadEdges {
    return { confirm: false, up: false, down: false, left: false, right: false };
}

/**
 * Edge-triggered menu input from every connected pad at once.
 *
 * The screens that use this used to poll navigator.getGamepads()[0] for
 * buttons 0 and 3. A pad that lands on a later slot — a lone Joy-Con, or
 * anything plugged in after another pad took slot 0 — was invisible to the
 * menu even though the game itself could read it, so the controller appeared
 * dead on the start screen and the player-select screen never came up. Any
 * pad drives the menu now, and any of its non-directional buttons confirms.
 */
export class MenuGamepad {
    private prev = noEdges();

    /** Directions/buttons that went down since the last poll. */
    poll(): MenuGamepadEdges {
        const held = noEdges();
        for (const gp of connectedPads()) {
            const dir = padDirections(gp);
            held.confirm = held.confirm || padConfirmHeld(gp);
            held.up      = held.up      || dir.up;
            held.down    = held.down    || dir.down;
            held.left    = held.left    || dir.left;
            held.right   = held.right   || dir.right;
        }

        const edges: MenuGamepadEdges = {
            confirm: held.confirm && !this.prev.confirm,
            up:      held.up      && !this.prev.up,
            down:    held.down    && !this.prev.down,
            left:    held.left    && !this.prev.left,
            right:   held.right   && !this.prev.right,
        };
        this.prev = held;
        return edges;
    }

    /**
     * Forget what is held, so a button still down when a screen opens has to
     * be released before it counts there. Without this the press that leaves
     * one screen immediately confirms the next.
     */
    reset(): void {
        this.prev = { confirm: true, up: true, down: true, left: true, right: true };
    }
}
