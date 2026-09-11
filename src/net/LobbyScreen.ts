import { unit } from '../constants';
import { gameState } from '../game-state';
import { CODE_LENGTH, MAX_PLAYERS, isLobbyCode } from './Protocol';
import type { PeerInfo } from './Protocol';

export interface LobbyView {
    role: 'host' | 'client';
    code: string;
    roster: PeerInfo[];
    selfPlayerId: number;
    status: string;
    error: string | null;
}

/** The LEAVE button, in tile units. Exported so taps can be hit-tested. */
const LEAVE_BUTTON = { x: 9, y: 30, w: 10, h: 2.6 };

export function hitsLeaveButton(canvasX: number, canvasY: number): boolean {
    const x = canvasX / unit;
    const y = canvasY / unit;
    return x >= LEAVE_BUTTON.x && x <= LEAVE_BUTTON.x + LEAVE_BUTTON.w
        && y >= LEAVE_BUTTON.y && y <= LEAVE_BUTTON.y + LEAVE_BUTTON.h;
}

export function drawLobbyScreen(view: LobbyView): void {
    const ctx = gameState.ctx;
    const w = gameState.canvas.width;
    const h = gameState.canvas.height;
    const cx = w / 2;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'yellow';
    ctx.font = `bold ${Math.round(unit * 1.3)}px monospace`;
    ctx.fillText('ONLINE CO-OP', cx, unit * 2.5);

    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(unit * 0.6)}px monospace`;
    ctx.fillText(view.role === 'host' ? 'YOUR LOBBY CODE' : 'LOBBY CODE', cx, unit * 5.5);

    // The code is the whole point of the screen, so it gets the largest type on
    // it — big enough to read across a room or off a phone held up to a camera.
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.round(unit * 2.4)}px monospace`;
    ctx.fillText(spaced(view.code), cx, unit * 8);

    if (view.role === 'host') {
        ctx.fillStyle = '#666';
        ctx.font = `${Math.round(unit * 0.55)}px monospace`;
        ctx.fillText('SHARE IT — UP TO 3 FRIENDS CAN JOIN', cx, unit * 10.3);
    }

    ctx.fillStyle = 'cyan';
    ctx.font = `bold ${Math.round(unit * 0.8)}px monospace`;
    ctx.fillText('PLAYERS', cx, unit * 13);

    for (let id = 1; id <= MAX_PLAYERS; id++) {
        const seated = view.roster.find(p => p.playerId === id) ?? null;
        const y = unit * (15 + (id - 1) * 2);
        drawRosterRow(ctx, cx, y, id, seated, id === view.selfPlayerId);
    }

    ctx.fillStyle = view.error !== null ? '#ff5555' : '#aaa';
    ctx.font = `${Math.round(unit * 0.65)}px monospace`;
    ctx.fillText(view.error ?? view.status, cx, unit * 24.5);

    if (view.error === null && view.role === 'host') {
        ctx.fillStyle = '#555';
        ctx.font = `${Math.round(unit * 0.5)}px monospace`;
        ctx.fillText('Starting a game together arrives with the', cx, unit * 26.4);
        ctx.fillText('next update — this is the lobby only.', cx, unit * 27.4);
    }

    drawLeaveButton(ctx);
}

function drawRosterRow(
    ctx: CanvasRenderingContext2D,
    cx: number,
    y: number,
    id: number,
    seated: PeerInfo | null,
    isSelf: boolean,
): void {
    const boxW = unit * 16;
    const boxH = unit * 1.6;

    ctx.fillStyle = seated !== null ? 'rgba(255,255,0,0.06)' : 'rgba(255,255,255,0.02)';
    ctx.fillRect(cx - boxW / 2, y - boxH / 2, boxW, boxH);

    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.round(unit * 0.75)}px monospace`;
    ctx.fillStyle = seated !== null ? 'yellow' : '#444';
    ctx.fillText(`P${id}`, cx - boxW / 2 + unit * 0.8, y);

    ctx.fillStyle = seated !== null ? 'white' : '#444';
    ctx.fillText(seated !== null ? seated.name : '- - -', cx - boxW / 2 + unit * 3.4, y);

    ctx.textAlign = 'right';
    ctx.font = `${Math.round(unit * 0.55)}px monospace`;
    ctx.fillStyle = isSelf ? 'cyan' : '#666';
    const label = isSelf ? 'YOU' : (seated !== null ? (id === 1 ? 'HOST' : 'READY') : 'WAITING');
    ctx.fillText(label, cx + boxW / 2 - unit * 0.8, y);

    ctx.textAlign = 'center';
}

function drawLeaveButton(ctx: CanvasRenderingContext2D): void {
    const x = LEAVE_BUTTON.x * unit;
    const y = LEAVE_BUTTON.y * unit;
    const w = LEAVE_BUTTON.w * unit;
    const h = LEAVE_BUTTON.h * unit;

    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.round(unit * 0.8)}px monospace`;
    ctx.fillText('LEAVE', x + w / 2, y + h / 2);

    ctx.fillStyle = '#555';
    ctx.font = `${Math.round(unit * 0.5)}px monospace`;
    ctx.fillText('TAP · ESC · B', x + w / 2, y + h + unit * 1.1);
}

/** `123456` reads as one number; `1 2 3 4 5 6` reads as digits to copy. */
function spaced(code: string): string {
    return code.split('').join(' ');
}

// ── Code entry ────────────────────────────────────────────────────────────────

export interface CodeEntryOptions {
    onSubmit: (code: string) => void;
    onCancel: () => void;
}

export interface CodeEntry {
    /** Show a working state and refuse further submits until cleared. */
    setBusy: (message: string | null) => void;
    setError: (message: string | null) => void;
    close: () => void;
}

/**
 * Six-digit code entry, following `showInitialsEntry`: a DOM overlay with a
 * transparent full-screen input, so a keyboard types straight into it and a tap
 * anywhere raises the mobile keypad.
 *
 * Gamepads get the arcade treatment instead — left/right to pick a slot,
 * up/down to spin the digit — since there is no text field a d-pad can drive.
 */
export function showCodeEntry(options: CodeEntryOptions): CodeEntry {
    const digits: string[] = Array(CODE_LENGTH).fill('');
    let cursor = 0;
    let busy = false;
    let closed = false;
    let showingError = false;

    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:2000',
        // Denser than the initials overlay: the menu behind this one is full of
        // text, and a code has to be read back digit by digit.
        'background:rgba(0,0,0,0.96)',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px',
        'padding-bottom:20vh',
        'font-family:monospace;color:white',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'ENTER LOBBY CODE';
    title.style.cssText = 'font-size:28px;font-weight:bold;color:yellow;letter-spacing:4px';

    // Transparent, full-overlay input: any tap opens the keypad. inputMode
    // numeric asks mobile for digits; the pattern keeps iOS from autofilling.
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = CODE_LENGTH;
    (input as HTMLInputElement & { autocomplete: string }).autocomplete = 'off';
    input.setAttribute('autocorrect', 'off');
    input.style.cssText = [
        'position:absolute;inset:0;width:100%;height:100%',
        'opacity:0.01;font-size:16px;cursor:text;z-index:0',
        'background:transparent;border:none;outline:none;color:transparent;caret-color:transparent',
    ].join(';');

    const slotsWrap = document.createElement('div');
    slotsWrap.style.cssText = 'position:relative;display:flex;gap:8px;cursor:text;padding:8px 12px';

    const slotEls: HTMLDivElement[] = [];
    for (let i = 0; i < CODE_LENGTH; i++) {
        const slot = document.createElement('div');
        // Fixed height so the row does not jump as digits land, and no
        // placeholder glyph — the underline alone marks an empty slot.
        slot.style.cssText = [
            'width:44px;height:60px',
            'display:flex;align-items:center;justify-content:center',
            'font-size:52px;font-weight:bold',
            'border-bottom:4px solid #666',
        ].join(';');
        slotsWrap.appendChild(slot);
        slotEls.push(slot);
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:18px;color:#666;letter-spacing:2px;text-align:center;line-height:1.6';
    hint.innerHTML = 'TAP ANYWHERE TO TYPE<br>CONTROLLER: ◄ ► SLOT, ▲ ▼ DIGIT, A JOIN';

    const message = document.createElement('div');
    message.style.cssText = 'font-size:20px;min-height:24px;text-align:center;letter-spacing:1px';

    const buttons = document.createElement('div');
    // Wraps rather than overflowing: two buttons at this size are wider than a
    // phone in portrait.
    buttons.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:16px;position:relative;z-index:1';

    const joinBtn = makeButton('JOIN');
    const cancelBtn = makeButton('CANCEL');
    buttons.append(joinBtn, cancelBtn);

    function currentCode(): string {
        return digits.join('');
    }

    function render(): void {
        for (let i = 0; i < CODE_LENGTH; i++) {
            const filled = digits[i] !== '';
            const active = i === cursor && !busy;
            slotEls[i].textContent = filled ? digits[i] : '';
            slotEls[i].style.color = 'yellow';
            slotEls[i].style.borderBottomColor = active ? 'white' : (filled ? 'yellow' : '#555');
        }
        const ready = isLobbyCode(currentCode()) && !busy;
        joinBtn.style.opacity = ready ? '1' : '0.35';
        joinBtn.style.cursor = ready ? 'pointer' : 'default';
        hint.style.visibility = busy ? 'hidden' : 'visible';
    }

    function submit(): void {
        if (busy || !isLobbyCode(currentCode())) return;
        options.onSubmit(currentCode());
    }

    function setDigitsFromInput(): void {
        const cleaned = input.value.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
        input.value = cleaned;
        for (let i = 0; i < CODE_LENGTH; i++) digits[i] = cleaned[i] ?? '';
        cursor = Math.min(cleaned.length, CODE_LENGTH - 1);
        render();
    }

    function spinDigit(delta: number): void {
        if (busy) return;
        const current = digits[cursor] === '' ? -1 : Number(digits[cursor]);
        // An empty slot spins to 0 going up and 9 going down.
        const next = current < 0 ? (delta > 0 ? 0 : 9) : (current + delta + 10) % 10;
        digits[cursor] = String(next);
        input.value = currentCode();
        render();
    }

    function moveCursor(delta: number): void {
        if (busy) return;
        cursor = Math.max(0, Math.min(CODE_LENGTH - 1, cursor + delta));
        render();
    }

    input.oninput = setDigitsFromInput;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); options.onCancel(); }
        else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCursor(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(1); }
        else if (e.key === 'ArrowUp')    { e.preventDefault(); spinDigit(1); }
        else if (e.key === 'ArrowDown')  { e.preventDefault(); spinDigit(-1); }
    };

    joinBtn.onclick = (e) => { e.stopPropagation(); submit(); };
    cancelBtn.onclick = (e) => { e.stopPropagation(); options.onCancel(); };

    // Gamepad: poll while the overlay is up. Rising edges only, so a held
    // d-pad moves one slot rather than racing across all six.
    let prev: boolean[] = [];
    function pollGamepad(): void {
        if (closed) return;
        const gp = (navigator.getGamepads ? navigator.getGamepads() : [])[0] ?? null;
        if (gp !== null) {
            const pressed = Array.from(gp.buttons, b => b.pressed);
            const rising = (i: number): boolean => (pressed[i] ?? false) && !(prev[i] ?? false);
            if (rising(14)) moveCursor(-1);
            if (rising(15)) moveCursor(1);
            if (rising(12)) spinDigit(1);
            if (rising(13)) spinDigit(-1);
            if (rising(0))  submit();
            if (rising(1))  options.onCancel();
            prev = pressed;
        } else {
            prev = [];
        }
        window.requestAnimationFrame(pollGamepad);
    }

    overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('click',      (e) => e.stopPropagation());

    overlay.append(title, slotsWrap, hint, message, buttons, input);
    document.body.appendChild(overlay);
    render();
    pollGamepad();
    setTimeout(() => input.focus(), 80);

    return {
        setBusy(text: string | null): void {
            busy = text !== null;
            if (text !== null) {
                showingError = false;
                message.style.color = '#aaa';
                message.textContent = text;
            } else if (!showingError) {
                message.textContent = '';
            }
            render();
        },
        setError(text: string | null): void {
            busy = false;
            showingError = text !== null;
            message.style.color = '#ff5555';
            message.textContent = text ?? '';
            render();
        },
        close(): void {
            if (closed) return;
            closed = true;
            overlay.remove();
        },
    };
}

function makeButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
        'font-family:monospace;font-size:26px;font-weight:bold',
        'background:#222;color:white;border:2px solid #888',
        'border-radius:8px;padding:14px 30px;cursor:pointer;letter-spacing:2px',
    ].join(';');
    return btn;
}
