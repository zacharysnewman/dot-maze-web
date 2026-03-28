// Web Audio API sound synthesis for Pac-Man game events.
// AudioContext is created on first call to init() which must be triggered
// by a user gesture (key press or touch) to satisfy browser autoplay policy.

export class Sound {
    static audioCtx: AudioContext | null = null;
    static dotToggle = false;

    // ── Menu music (HTMLAudioElement for MP3) ─────────────────────────────────

    private static menuAudio: HTMLAudioElement | null = null;
    private static menuPausedByVisibility = false;

    static initMenuMusic(): void {
        if (Sound.menuAudio) return;
        const audio = new Audio('assets/audio/menu-music.mp3');
        audio.loop = true;
        audio.volume = 0.5;
        Sound.menuAudio = audio;

        document.addEventListener('visibilitychange', () => {
            if (!Sound.menuAudio) return;
            if (document.hidden) {
                if (!Sound.menuAudio.paused) {
                    Sound.menuAudio.pause();
                    Sound.menuPausedByVisibility = true;
                }
            } else if (Sound.menuPausedByVisibility) {
                Sound.menuPausedByVisibility = false;
                Sound.menuAudio.play().catch(() => {/* autoplay blocked — no-op */});
            }
        });
    }

    // Must be called during or after a user gesture (browser autoplay policy)
    static playMenuMusic(): void {
        Sound.initMenuMusic();
        if (!Sound.menuAudio) return;
        Sound.menuAudio.currentTime = 0;
        Sound.menuAudio.play().catch(() => {/* autoplay blocked — no-op */});
    }

    static stopMenuMusic(): void {
        if (!Sound.menuAudio) return;
        Sound.menuAudio.pause();
        Sound.menuAudio.currentTime = 0;
    }

    // ── AudioContext init ─────────────────────────────────────────────────────

    // Call from the first user interaction handler
    static init(): void {
        if (Sound.audioCtx) return;
        try {
            Sound.audioCtx = new AudioContext();
        } catch {
            // Audio not available — all synth sound calls become no-ops
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private static tone(
        freq: number,
        duration: number,
        when = 0,
        type: OscillatorType = 'square',
        vol = 0.12,
    ): void {
        const ctx = Sound.audioCtx;
        if (!ctx) return;
        const startTime = ctx.currentTime + when;
        try {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(vol, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration + 0.01);
        } catch {
            // Ignore errors (e.g. context suspended)
        }
    }

    // ── Sound events ──────────────────────────────────────────────────────────

    // Alternating two-tone "waka-waka" on every dot eaten
    static dot(): void {
        Sound.dotToggle = !Sound.dotToggle;
        Sound.tone(Sound.dotToggle ? 220 : 180, 0.07);
    }

    // Short chord on energizer pickup
    static energizer(): void {
        Sound.tone(440, 0.25, 0,    'sine', 0.18);
        Sound.tone(554, 0.20, 0.05, 'sine', 0.12);
    }

    // Ascending arpeggio when a ghost is eaten
    static ghostEaten(): void {
        [392, 494, 587, 784].forEach((freq, i) => {
            Sound.tone(freq, 0.08, i * 0.07, 'square', 0.14);
        });
    }

    // Descending "death" melody when Pac-Man dies
    static death(): void {
        [480, 420, 360, 300, 240, 180].forEach((freq, i) => {
            Sound.tone(freq, 0.13, i * 0.10, 'square', 0.15);
        });
    }

    // Short victory jingle on level clear
    static levelClear(): void {
        [523, 659, 784, 1047].forEach((freq, i) => {
            Sound.tone(freq, 0.10, i * 0.09, 'sine', 0.14);
        });
    }

    // ── Intro chimes (play during READY! countdown) ───────────────────────────

    static introChimes(): void {
        // Rising C-major arpeggio that swells into the game start
        const melody: Array<[number, number, number, OscillatorType, number]> = [
            [262, 0.10, 0.00, 'sine', 0.12],  // C4
            [330, 0.10, 0.13, 'sine', 0.12],  // E4
            [392, 0.10, 0.26, 'sine', 0.13],  // G4
            [523, 0.13, 0.39, 'sine', 0.14],  // C5
            [659, 0.10, 0.55, 'sine', 0.13],  // E5
            [784, 0.10, 0.68, 'sine', 0.14],  // G5
            [1047,0.20, 0.81, 'sine', 0.16],  // C6 — peak
            [784, 0.08, 1.04, 'sine', 0.12],  // G5
            [880, 0.08, 1.14, 'sine', 0.12],  // A5
            [988, 0.08, 1.24, 'sine', 0.12],  // B5
            [1047,0.30, 1.34, 'sine', 0.18],  // C6 — final hold
        ];
        for (const [freq, dur, when, type, vol] of melody) {
            Sound.tone(freq, dur, when, type, vol);
        }
    }

    // ── Continuous ambient siren ───────────────────────────────────────────────
    // Three states:
    //   'normal' — ghosts active, no power pellet: medium pitch, slow woo-woo
    //   'eyes'   — ghost eaten, eyes returning:    high pitch,   faster woo-woo
    //   'blue'   — power pellet active (frightened): low pitch,  fastest woo-woo

    private static sirenOsc:   OscillatorNode | null = null;
    private static sirenLFO:   OscillatorNode | null = null;
    private static sirenGain:  GainNode       | null = null;
    static currentSirenState: 'normal' | 'eyes' | 'blue' | null = null;

    static startSiren(state: 'normal' | 'eyes' | 'blue'): void {
        if (Sound.currentSirenState === state) return;
        Sound.stopSiren();
        const ctx = Sound.audioCtx;
        if (!ctx) return;

        // carrier frequency, LFO depth (Hz swing), LFO rate (Hz), volume
        const cfg = {
            normal: { freq: 220, depth: 70,  rate: 1.5, vol: 0.025 },
            eyes:   { freq: 480, depth: 130, rate: 3.5, vol: 0.025 },
            blue:   { freq: 110, depth: 45,  rate: 6.0, vol: 0.025 },
        }[state];

        try {
            const osc     = ctx.createOscillator();
            const lfo     = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            const gain    = ctx.createGain();

            osc.type = 'square';
            osc.frequency.value = cfg.freq;

            lfo.type = 'sine';
            lfo.frequency.value = cfg.rate;
            lfoGain.gain.value  = cfg.depth;

            gain.gain.value = cfg.vol;

            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            osc.connect(gain);
            gain.connect(ctx.destination);

            lfo.start();
            osc.start();

            Sound.sirenOsc  = osc;
            Sound.sirenLFO  = lfo;
            Sound.sirenGain = gain;
            Sound.currentSirenState = state;
        } catch {
            // Ignore
        }
    }

    static stopSiren(): void {
        try { Sound.sirenOsc?.stop(); } catch { /* already stopped */ }
        try { Sound.sirenLFO?.stop(); } catch { /* already stopped */ }
        Sound.sirenOsc  = null;
        Sound.sirenLFO  = null;
        Sound.sirenGain = null;
        Sound.currentSirenState = null;
    }
}
