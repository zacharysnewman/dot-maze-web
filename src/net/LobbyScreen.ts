import { unit } from '../constants';
import { gameState } from '../game-state';
import { MAX_PLAYERS } from './Protocol';
import { qrCanvas } from './QrCode';
import type { PeerInfo } from './Protocol';

export interface LobbyView {
    role: 'host' | 'client';
    roster: PeerInfo[];
    selfPlayerId: number;
    /** The map everyone is about to play. Joiners learn it from the welcome. */
    mapName: string;
    status: string;
    error: string | null;
}

// Buttons, in tile units. Taps are hit-tested against these.
const LEAVE_BUTTON = { x: 9, y: 30, w: 10, h: 2.6 };
const START_BUTTON = { x: 8, y: 26.4, w: 12, h: 2.6 };
const MAP_BUTTON   = { x: 8, y: 22.5, w: 12, h: 1.9 };
const QR_BUTTON    = { x: 7, y: 7.2, w: 14, h: 2.6 };

interface Rect { x: number; y: number; w: number; h: number }

function hits(rect: Rect, canvasX: number, canvasY: number): boolean {
    const x = canvasX / unit;
    const y = canvasY / unit;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function hitsLeaveButton(canvasX: number, canvasY: number): boolean {
    return hits(LEAVE_BUTTON, canvasX, canvasY);
}

export function hitsStartButton(canvasX: number, canvasY: number): boolean {
    return hits(START_BUTTON, canvasX, canvasY);
}

export function hitsMapButton(canvasX: number, canvasY: number): boolean {
    return hits(MAP_BUTTON, canvasX, canvasY);
}

export function hitsQrButton(canvasX: number, canvasY: number): boolean {
    return hits(QR_BUTTON, canvasX, canvasY);
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
    ctx.fillText('LAN CO-OP', cx, unit * 2.5);

    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(unit * 0.6)}px monospace`;
    if (view.role === 'host') {
        // Scanning is the only way in, so the way to the code is the biggest
        // thing on the screen.
        ctx.fillText('EVERYONE ON THE SAME WI-FI', cx, unit * 5);
        ctx.fillText('SCANS YOUR CODE TO JOIN', cx, unit * 6);
        drawButton(ctx, QR_BUTTON, 'SHOW JOIN QR', 'yellow');
        ctx.fillStyle = '#666';
        ctx.font = `${Math.round(unit * 0.55)}px monospace`;
        ctx.fillText('UP TO 3 CAN JOIN', cx, unit * 10.6);
    } else {
        ctx.fillStyle = 'white';
        ctx.font = `bold ${Math.round(unit * 1)}px monospace`;
        ctx.fillText('YOU\'RE IN', cx, unit * 6.5);
    }

    ctx.fillStyle = 'cyan';
    ctx.font = `bold ${Math.round(unit * 0.8)}px monospace`;
    ctx.fillText('PLAYERS', cx, unit * 12.4);

    for (let id = 1; id <= MAX_PLAYERS; id++) {
        const seated = view.roster.find(p => p.playerId === id) ?? null;
        const y = unit * (14.2 + (id - 1) * 1.8);
        drawRosterRow(ctx, cx, y, id, seated, id === view.selfPlayerId);
    }

    // The map is part of the invitation: a joiner should know what they are
    // being asked to play before the host starts it.
    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(unit * 0.55)}px monospace`;
    ctx.fillText('MAP', cx, unit * 21);
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.round(unit * 0.75)}px monospace`;
    ctx.fillText(truncate(view.mapName, 26), cx, unit * 22);

    if (view.role === 'host') {
        drawButton(ctx, MAP_BUTTON, 'CHANGE MAP', '#aaa');
    }

    ctx.fillStyle = view.error !== null ? '#ff5555' : '#aaa';
    ctx.font = `${Math.round(unit * 0.65)}px monospace`;
    ctx.fillText(view.error ?? view.status, cx, unit * 25.3);

    if (view.role === 'host') {
        drawButton(ctx, START_BUTTON, 'START', 'yellow');
    }

    drawButton(ctx, LEAVE_BUTTON, 'LEAVE', 'white');

    ctx.fillStyle = '#555';
    ctx.font = `${Math.round(unit * 0.5)}px monospace`;
    ctx.fillText(
        view.role === 'host'
            ? 'START ENTER/A   QR Q/X   MAP M/Y   LEAVE ESC/B'
            : 'LEAVE  TAP/ESC/B',
        cx, unit * 33.4,
    );
}

/** Long map names are the author's business; the lobby only has one line. */
function truncate(text: string, max: number): string {
    const name = text.trim().length === 0 ? '(UNTITLED)' : text.trim().toUpperCase();
    return name.length <= max ? name : `${name.slice(0, max - 1)}\u2026`;
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

function drawButton(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    label: string,
    color: string,
): void {
    const x = rect.x * unit;
    const y = rect.y * unit;
    const w = rect.w * unit;
    const h = rect.h * unit;

    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color === 'yellow' ? 'yellow' : '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(unit * (h > 2 ? 0.8 : 0.65))}px monospace`;
    ctx.fillText(label, x + w / 2, y + h / 2);
}

/**
 * Drawn over the maze when snapshots stop arriving — a host who backgrounded
 * their tab, a lag spike, a connection going bad. Without it the game simply
 * freezes and looks broken.
 */
export function drawWaitingBanner(message: string, hint = 'ESC OR B TO LEAVE'): void {
    const ctx = gameState.ctx;
    const w = gameState.canvas.width;
    const y = unit * 17;

    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, y - unit * 1.6, w, unit * 3.2);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'yellow';
    ctx.font = `bold ${Math.round(unit * 0.9)}px monospace`;
    ctx.fillText(message, w / 2, y - unit * 0.4);

    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(unit * 0.55)}px monospace`;
    ctx.fillText(hint, w / 2, y + unit * 0.9);
}

/**
 * What a client sees once the host's game is over.
 *
 * The status line is the point. Without it, a client watching the host type
 * initials cannot tell a busy host from a dead connection.
 */
export function drawClientGameOver(score: number, status: string): void {
    const ctx = gameState.ctx;
    const w = gameState.canvas.width;
    const cx = w / 2;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, gameState.canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'red';
    ctx.font = `bold ${Math.round(unit * 1.6)}px monospace`;
    ctx.fillText('GAME OVER', cx, unit * 12);

    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.round(unit * 1)}px monospace`;
    ctx.fillText(`SCORE  ${score}`, cx, unit * 16);

    ctx.fillStyle = '#aaa';
    ctx.font = `${Math.round(unit * 0.65)}px monospace`;
    ctx.fillText(status, cx, unit * 21);

    drawButton(ctx, LEAVE_BUTTON, 'LEAVE', 'white');

    ctx.fillStyle = '#555';
    ctx.font = `${Math.round(unit * 0.5)}px monospace`;
    ctx.fillText('TAP - ESC - B', cx, unit * 33.4);
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

// ── QR screens ────────────────────────────────────────────────────────────────

/** Big enough to scan from arm's length off a laptop, and to fit a phone. */
function qrSizePx(): number {
    return Math.round(Math.min(window.innerWidth * 0.8, window.innerHeight * 0.5, 520) * (window.devicePixelRatio || 1));
}

function overlayBase(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.97)',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px',
        'font-family:monospace;color:white;padding:16px;box-sizing:border-box;overflow-y:auto',
    ].join(';');
    overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('click', (e) => e.stopPropagation());
    return overlay;
}

function textLine(size: number, color: string): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `font-size:${size}px;color:${color};letter-spacing:2px;text-align:center;max-width:92vw;line-height:1.45`;
    return el;
}

function qrHolder(): HTMLDivElement {
    const holder = document.createElement('div');
    holder.style.cssText = 'width:min(80vw,50vh,520px);aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:white;border-radius:8px';
    return holder;
}

function setQr(holder: HTMLDivElement, url: string | null): void {
    holder.replaceChildren();
    if (url === null) return;
    const canvas = qrCanvas(url, qrSizePx());
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    holder.appendChild(canvas);
}

/** Poll every pad for rising edges on a few buttons while an overlay is up. */
function padButtons(isOpen: () => boolean, handlers: Record<number, () => void>): void {
    let prev: boolean[] = [];
    const poll = (): void => {
        if (!isOpen()) return;
        const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
        const pressed: boolean[] = [];
        for (const pad of pads) pad?.buttons.forEach((b, i) => { pressed[i] = (pressed[i] ?? false) || b.pressed; });
        for (const [index, handler] of Object.entries(handlers)) {
            const i = Number(index);
            if ((pressed[i] ?? false) && !(prev[i] ?? false)) handler();
        }
        prev = pressed;
        window.requestAnimationFrame(poll);
    };
    poll();
}

export interface HostQrScreen {
    /** The link the QR code carries — updated as offers are used up; null while one is prepared. */
    setLink: (url: string | null) => void;
    setStatus: (text: string, isError?: boolean) => void;
    close: () => void;
}

export interface HostQrOptions {
    link: string | null;
    status: string;
    onScanReply: () => void;
    onClose: () => void;
}

/**
 * The host's invitation: one QR code that works either way. Scanned with
 * internet, the joiner is in by itself. Scanned without, the joiner's screen
 * shows a reply code, and SCAN REPLY reads it here without leaving the game.
 */
export function showHostQr(options: HostQrOptions): HostQrScreen {
    let closed = false;
    const overlay = overlayBase();

    const title = textLine(26, 'yellow');
    title.style.fontWeight = 'bold';
    title.textContent = 'SCAN TO JOIN';

    const holder = qrHolder();
    setQr(holder, options.link);

    const status = textLine(18, '#aaa');
    status.textContent = options.status;

    const help = textLine(15, '#777');
    help.innerHTML = 'SCAN WITH A PHONE CAMERA, OR JOIN LAN GAME IN THE GAME.<br>THEN TAP SCAN REPLY AND SCAN THE CODE ON THEIR SCREEN.';

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:14px';
    const scanBtn = makeButton('SCAN REPLY');
    const doneBtn = makeButton('DONE');
    buttons.append(scanBtn, doneBtn);
    scanBtn.onclick = (e) => { e.stopPropagation(); options.onScanReply(); };
    doneBtn.onclick = (e) => { e.stopPropagation(); options.onClose(); };

    const keys = (e: KeyboardEvent): void => {
        if (document.body.lastElementChild !== overlay) return; // the scanner is on top
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'q' || e.key === 'Q') { e.preventDefault(); e.stopPropagation(); options.onClose(); }
        else if (e.key === 's' || e.key === 'S') { e.preventDefault(); e.stopPropagation(); options.onScanReply(); }
    };
    window.addEventListener('keydown', keys, true);
    padButtons(() => !closed, {
        0: () => { if (document.body.lastElementChild === overlay) options.onClose(); },
        1: () => { if (document.body.lastElementChild === overlay) options.onClose(); },
        2: () => { if (document.body.lastElementChild === overlay) options.onScanReply(); },
    });

    overlay.append(title, holder, status, help, buttons);
    document.body.appendChild(overlay);

    return {
        setLink: (url) => { if (!closed) setQr(holder, url); },
        setStatus: (text, isError = false) => {
            status.textContent = text;
            status.style.color = isError ? '#ff5555' : '#aaa';
        },
        close: () => {
            if (closed) return;
            closed = true;
            window.removeEventListener('keydown', keys, true);
            overlay.remove();
        },
    };
}

export interface JoiningScreen {
    setBusy: (message: string | null) => void;
    setError: (message: string | null) => void;
    /** Show the reply code for the host to scan. */
    showReply: (url: string) => void;
    close: () => void;
}

/**
 * What a joiner sees after scanning the host's code: the reply code for the
 * host to scan back, and how that is going.
 */
export function showJoiningScreen(onCancel: () => void): JoiningScreen {
    let closed = false;
    const overlay = overlayBase();

    const title = textLine(26, 'yellow');
    title.style.fontWeight = 'bold';
    title.textContent = 'JOINING';

    const message = textLine(19, '#aaa');
    message.textContent = 'GETTING READY...';

    const replyWrap = document.createElement('div');
    replyWrap.style.cssText = 'display:none;flex-direction:column;align-items:center;gap:10px';
    const replyHint = textLine(16, '#ccc');
    replyHint.innerHTML = 'SHOW THIS TO THE HOST.<br>THEY TAP SCAN REPLY ON THEIR QR SCREEN.';
    const holder = qrHolder();
    replyWrap.append(replyHint, holder);

    const cancel = makeButton('CANCEL');
    cancel.onclick = (e) => { e.stopPropagation(); onCancel(); };
    const keys = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
    };
    window.addEventListener('keydown', keys, true);
    padButtons(() => !closed, { 1: onCancel });

    overlay.append(title, message, replyWrap, cancel);
    document.body.appendChild(overlay);

    return {
        setBusy: (text) => {
            if (text === null) return;
            message.style.color = '#aaa';
            message.textContent = text;
        },
        setError: (text) => {
            message.style.color = '#ff5555';
            message.textContent = text ?? '';
            replyWrap.style.display = 'none';
        },
        showReply: (url) => {
            setQr(holder, url);
            replyWrap.style.display = 'flex';
        },
        close: () => {
            if (closed) return;
            closed = true;
            window.removeEventListener('keydown', keys, true);
            overlay.remove();
        },
    };
}
