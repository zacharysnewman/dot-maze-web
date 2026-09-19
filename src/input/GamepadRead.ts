// Low-level gamepad reading shared by the in-game input and the menus.
//
// Pads that report `mapping: 'standard'` put the d-pad on buttons 12–15 and
// the left stick on axes 0/1. Plenty of pads don't — a Joy-Con is the one that
// prompted this — and report their d-pad on the hat axis instead, sometimes
// with the face buttons at indices that have nothing to do with the standard
// layout. Reading every source and OR-ing them keeps both kinds working
// without having to recognise individual controllers.

const DEADZONE = 0.3;

// Standard gamepad mapping button indices
export const BTN_UP    = 12;
export const BTN_DOWN  = 13;
export const BTN_LEFT  = 14;
export const BTN_RIGHT = 15;

// Non-standard pads commonly expose the d-pad as a single "hat" axis here.
const HAT_AXIS = 9;

export interface PadDirections {
    left:  boolean;
    right: boolean;
    up:    boolean;
    down:  boolean;
}

function noDirections(): PadDirections {
    return { left: false, right: false, up: false, down: false };
}

/**
 * Decode the hat axis. It rests outside [-1, 1] (typically 1.29 or 3.29) and
 * otherwise runs through eight positions in steps of 2/7, clockwise from -1 =
 * up. Anything out of range is the neutral position.
 */
function hatDirections(value: number | undefined): PadDirections {
    if (value === undefined || value > 1.05 || value < -1.05) return noDirections();
    const pos = Math.round((value + 1) * 3.5) % 8; // 0 = up, 1 = up-right, ... 7 = up-left
    return {
        up:    pos === 7 || pos === 0 || pos === 1,
        right: pos >= 1 && pos <= 3,
        down:  pos >= 3 && pos <= 5,
        left:  pos >= 5 && pos <= 7,
    };
}

/** Every direction the pad is currently reporting, from d-pad, stick and hat. */
export function padDirections(gp: Gamepad): PadDirections {
    const axisX = gp.axes[0] ?? 0;
    const axisY = gp.axes[1] ?? 0;
    const hat   = hatDirections(gp.axes[HAT_AXIS]);

    return {
        left:  (gp.buttons[BTN_LEFT]?.pressed  ?? false) || axisX < -DEADZONE || hat.left,
        right: (gp.buttons[BTN_RIGHT]?.pressed ?? false) || axisX >  DEADZONE || hat.right,
        up:    (gp.buttons[BTN_UP]?.pressed    ?? false) || axisY < -DEADZONE || hat.up,
        down:  (gp.buttons[BTN_DOWN]?.pressed  ?? false) || axisY >  DEADZONE || hat.down,
    };
}

/**
 * True while any non-directional button is held. Menus take this as "confirm"
 * rather than watching particular face buttons, because a non-standard pad
 * puts them wherever it likes; buttons 12–15 stay out of it so the d-pad keeps
 * navigating instead of confirming.
 */
export function padConfirmHeld(gp: Gamepad): boolean {
    for (let i = 0; i < gp.buttons.length; i++) {
        if (i >= BTN_UP && i <= BTN_RIGHT) continue;
        if (gp.buttons[i]?.pressed ?? false) return true;
    }
    return false;
}

/** Connected pads, skipping the empty slots navigator.getGamepads() leaves. */
export function connectedPads(): Gamepad[] {
    const pads: Gamepad[] = [];
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
        if (gp !== null) pads.push(gp);
    }
    return pads;
}
