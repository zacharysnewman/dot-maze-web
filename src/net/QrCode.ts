import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

/**
 * QR codes, both ways: drawn for another device to scan, and read through this
 * device's camera without leaving the game.
 *
 * Every code the game shows is a link, so a phone's own camera app can open it
 * too; the in-game scanner exists so nobody has to leave a running game —
 * which on a host would freeze it for everyone — and because a laptop has no
 * camera app that reads QR codes at all.
 */

/**
 * A QR code as a canvas, black on white with the four-module quiet zone
 * scanners need. Error correction L: a code shown on a screen does not get
 * scuffed, and the lowest level keeps the modules as large as possible.
 */
export function qrCanvas(text: string, sizePx: number): HTMLCanvasElement {
    const qr = qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    const modules = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.max(1, Math.floor(sizePx / (modules + quiet * 2)));
    const size = cell * (modules + quiet * 2);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'black';
    for (let r = 0; r < modules; r++) {
        for (let c = 0; c < modules; c++) {
            if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
        }
    }
    // Crisp modules when the browser scales the canvas to fit.
    canvas.style.imageRendering = 'pixelated';
    return canvas;
}

// ── Scanner ───────────────────────────────────────────────────────────────────

export interface QrScannerOptions {
    title: string;
    hint: string;
    /** A code was read. Return true to close the scanner, false to keep looking. */
    onResult: (text: string) => boolean;
    onCancel: () => void;
}

export interface QrScanner {
    /** Say something under the camera view — why a code was refused, say. */
    setMessage: (text: string, isError?: boolean) => void;
    close: () => void;
}

/** How often a frame is examined. Fast enough to feel instant, light on a phone. */
const SCAN_INTERVAL_MS = 120;
/** jsQR gets a frame no wider than this; a code filling the view needs far less. */
const SCAN_WIDTH = 640;

interface NativeDetector {
    detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

/**
 * The browser's own QR reader where there is one (Chrome on Android, and most
 * Chromium browsers), since it is faster and better in poor light; jsQR where
 * there is not (Safari, Firefox).
 */
async function nativeDetector(): Promise<NativeDetector | null> {
    const Ctor = (window as unknown as {
        BarcodeDetector?: {
            new (options: { formats: string[] }): NativeDetector;
            getSupportedFormats?: () => Promise<string[]>;
        };
    }).BarcodeDetector;
    if (Ctor === undefined) return null;
    try {
        const formats = await Ctor.getSupportedFormats?.() ?? ['qr_code'];
        return formats.includes('qr_code') ? new Ctor({ formats: ['qr_code'] }) : null;
    } catch {
        return null;
    }
}

/**
 * A full-screen camera view that reads QR codes. Asks for the camera the first
 * time; the rear one on a phone, since the code is on someone else's screen.
 */
export function showQrScanner(options: QrScannerOptions): QrScanner {
    let closed = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:2100;background:#000',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px',
        'font-family:monospace;color:white;padding:16px;box-sizing:border-box',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = options.title;
    title.style.cssText = 'font-size:26px;font-weight:bold;color:yellow;letter-spacing:3px;text-align:center';

    const frame = document.createElement('div');
    frame.style.cssText = 'position:relative;width:min(80vw,60vh);aspect-ratio:1;border:3px solid yellow;border-radius:12px;overflow:hidden;background:#111';

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.style.cssText = 'width:100%;height:100%;object-fit:cover';
    frame.appendChild(video);

    const hint = document.createElement('div');
    hint.textContent = options.hint;
    hint.style.cssText = 'font-size:17px;color:#aaa;letter-spacing:1px;text-align:center;max-width:90vw;line-height:1.5';

    const message = document.createElement('div');
    message.style.cssText = 'font-size:18px;min-height:22px;text-align:center;max-width:90vw;line-height:1.5';

    const cancel = document.createElement('button');
    cancel.textContent = 'CANCEL';
    cancel.style.cssText = [
        'font-family:monospace;font-size:24px;font-weight:bold',
        'background:#222;color:white;border:2px solid #888',
        'border-radius:8px;padding:12px 28px;cursor:pointer;letter-spacing:2px',
    ].join(';');
    cancel.onclick = (e) => { e.stopPropagation(); options.onCancel(); };

    overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('click', (e) => e.stopPropagation());
    overlay.append(title, frame, hint, message, cancel);
    document.body.appendChild(overlay);

    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); options.onCancel(); }
    };
    window.addEventListener('keydown', onKey, true);

    let prevB = false;
    const pollPad = (): void => {
        if (closed) return;
        const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
        const b = pads.some(p => p?.buttons[1]?.pressed === true);
        if (b && !prevB) options.onCancel();
        prevB = b;
        window.requestAnimationFrame(pollPad);
    };
    pollPad();

    const setMessage = (text: string, isError = false): void => {
        message.textContent = text;
        message.style.color = isError ? '#ff5555' : '#aaa';
    };

    const scratch = document.createElement('canvas');
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;

    const readFrame = (detector: NativeDetector | null): Promise<string | null> => {
        if (video.readyState < 2 || video.videoWidth === 0) return Promise.resolve(null);
        if (detector !== null) {
            return detector.detect(video)
                .then(found => found[0]?.rawValue ?? null)
                .catch(() => null);
        }
        const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
        scratch.width = Math.round(video.videoWidth * scale);
        scratch.height = Math.round(video.videoHeight * scale);
        scratchCtx.drawImage(video, 0, 0, scratch.width, scratch.height);
        const image = scratchCtx.getImageData(0, 0, scratch.width, scratch.height);
        return Promise.resolve(jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null);
    };

    const start = async (): Promise<void> => {
        if (navigator.mediaDevices?.getUserMedia === undefined) {
            setMessage('THIS BROWSER CANNOT USE THE CAMERA HERE', true);
            return;
        }
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false,
            });
        } catch (err) {
            const name = (err as { name?: string }).name;
            setMessage(name === 'NotAllowedError'
                ? 'CAMERA BLOCKED - ALLOW IT IN THE BROWSER SETTINGS'
                : 'NO CAMERA FOUND', true);
            return;
        }
        if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        const detector = await nativeDetector();

        const tick = async (): Promise<void> => {
            if (closed) return;
            const text = await readFrame(detector);
            if (closed) return;
            if (text !== null && options.onResult(text)) return;
            timer = setTimeout(() => { void tick(); }, SCAN_INTERVAL_MS);
        };
        void tick();
    };
    void start();

    return {
        setMessage,
        close(): void {
            if (closed) return;
            closed = true;
            if (timer !== null) clearTimeout(timer);
            stream?.getTracks().forEach(t => t.stop());
            window.removeEventListener('keydown', onKey, true);
            overlay.remove();
        },
    };
}
