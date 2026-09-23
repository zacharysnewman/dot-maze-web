/**
 * A two-device connection test over the transport the game actually uses.
 *
 * `net-test.html` measures one device against public servers, which says what a
 * network looks like but not whether these two devices can reach each other.
 * This does the real thing: both devices join a room by code, and every stage
 * is reported separately, so a failure lands on a stage rather than on "it did
 * not work".
 *
 *   signalling  — the relays answered and the room was joined
 *   discovery   — the other device was seen, so both reached the same relay
 *   data        — a message did a round trip, so ICE completed
 *   route       — which candidate pair won, which is what says whether a relay
 *                 would have been needed
 *
 * Discovery without data is NAT traversal failing, which is what a TURN server
 * fixes. No discovery is signalling failing, which TURN would not fix at all.
 */
import { APP_ID, NET_ACTION, isLobbyCode, randomLobbyCode } from './Protocol';
import { joinGameRoom } from './Transport';
import { getRelaySockets } from 'trystero';
import type { Room } from 'trystero';

type Stage = 'signalling' | 'discovery' | 'data' | 'route';
type StageState = 'pending' | 'waiting' | 'ok' | 'fail';

interface PingMessage {
    t: 'ping' | 'pong';
    /** Sender's clock, echoed back untouched so only the sender's clock is read. */
    sent: number;
}

/** How long to wait for the other device before calling discovery failed. */
const DISCOVERY_TIMEOUT_MS = 25_000;
/** How long after discovery to wait for a round trip before calling it failed. */
const DATA_TIMEOUT_MS = 20_000;
/** How often to re-read the peer connection's stats while connected. */
const STATS_INTERVAL_MS = 1_000;
/** How often to re-read which signalling relays are actually open. */
const RELAY_INTERVAL_MS = 1_000;

const SOCKET_STATES = ['connecting', 'open', 'closing', 'closed'];

/**
 * Which signalling relays this device is actually connected to, read from the
 * library rather than inferred. Trystero moves on quietly when a relay refuses,
 * so "the room was joined" on its own says nothing about whether anyone can be
 * reached through it.
 */
function relayStatus(): { url: string; state: string; open: boolean }[] {
    let sockets: Record<string, { readyState: number }>;
    try {
        sockets = getRelaySockets() as Record<string, { readyState: number }>;
    } catch {
        return [];
    }
    if (sockets === undefined || sockets === null) return [];
    return Object.entries(sockets).map(([url, socket]) => ({
        url,
        state: SOCKET_STATES[socket.readyState] ?? String(socket.readyState),
        open: socket.readyState === 1,
    }));
}

const stageOrder: Stage[] = ['signalling', 'discovery', 'data', 'route'];

const stageTitles: Record<Stage, string> = {
    signalling: 'Signalling',
    discovery: 'Peer discovery',
    data: 'Data round trip',
    route: 'Connection route',
};

const stageDescriptions: Record<Stage, string> = {
    signalling: 'Reaching the relays that introduce the two devices',
    discovery: 'Seeing the other device in the room',
    data: 'Getting a message there and back',
    route: 'Which candidate pair the connection settled on',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className !== '') node.className = className;
    return node;
}

function requireElement(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (node === null) throw new Error(`missing element #${id}`);
    return node;
}

class StageView {
    private readonly detail: HTMLElement;
    private readonly state: HTMLElement;

    constructor(parent: HTMLElement, stage: Stage) {
        const card = el('div', 'card');
        const title = el('div', 'card-title');
        title.textContent = stageTitles[stage];
        const meta = el('div', 'card-meta');
        meta.textContent = stageDescriptions[stage];
        this.state = el('div', 'stage-state pending');
        this.state.textContent = 'not started';
        this.detail = el('div', 'stage-detail');
        card.append(title, meta, this.state, this.detail);
        parent.append(card);
    }

    set(state: StageState, label: string, detail = ''): void {
        this.state.className = `stage-state ${state}`;
        this.state.textContent = label;
        this.detail.innerHTML = detail;
    }
}

/** The selected candidate pair, which is the answer to "how did this connect". */
interface Route {
    localType: string;
    remoteType: string;
    protocol: string;
    localAddress: string;
    remoteAddress: string;
}

/** The stats fields this page reads, which the DOM lib does not declare. */
interface CandidateReport {
    type: string;
    candidateType?: string;
    protocol?: string;
    address?: string;
    port?: number;
    nominated?: boolean;
    selected?: boolean;
    state?: string;
    localCandidateId?: string;
    remoteCandidateId?: string;
}

async function readRoute(pc: RTCPeerConnection): Promise<Route | null> {
    const reports = new Map<string, CandidateReport>();
    (await pc.getStats()).forEach((report: CandidateReport, id: string) => reports.set(id, report));

    let pair: CandidateReport | null = null;
    for (const report of reports.values()) {
        if (report.type !== 'candidate-pair') continue;
        // `selected` is the Firefox spelling; elsewhere the nominated pair in
        // state succeeded is the one carrying traffic.
        if (report.selected === true || (report.nominated === true && report.state === 'succeeded')) pair = report;
    }
    if (pair === null) return null;

    const local = reports.get(pair.localCandidateId ?? '');
    const remote = reports.get(pair.remoteCandidateId ?? '');

    const describe = (c: CandidateReport | undefined): string =>
        c === undefined ? 'unknown' : `${c.address ?? '?'}:${c.port ?? '?'}`;

    return {
        localType: local?.candidateType ?? 'unknown',
        remoteType: remote?.candidateType ?? 'unknown',
        protocol: local?.protocol ?? '?',
        localAddress: describe(local),
        remoteAddress: describe(remote),
    };
}

/**
 * What the winning candidate pair means for the game. A relay on either end is
 * the case that needs a TURN server the game does not ship.
 */
function explainRoute(route: Route): { text: string; state: StageState } {
    const relayed = route.localType === 'relay' || route.remoteType === 'relay';
    const family = route.localAddress.startsWith('[') ? 'IPv6' : 'IPv4';

    if (relayed) {
        return {
            state: 'ok',
            text: `Connected through a TURN relay over ${family}. A direct path was not available, so this pairing ` +
                `needs a relay configured — which is the case the game currently cannot serve.`,
        };
    }
    if (route.localType === 'host' && route.remoteType === 'host') {
        return {
            state: 'ok',
            text: `Connected directly over the local network (${family}), without involving NAT at all. This is the ` +
                `LAN case, and it says nothing about whether mobile data would work.`,
        };
    }
    return {
        state: 'ok',
        text: `Connected directly through NAT over ${family}, with no relay involved. Whatever the NAT here does, ` +
            `it did not stand in the way.`,
    };
}

class PeerTest {
    private readonly stages = new Map<Stage, StageView>();
    private readonly log: HTMLElement;
    private room: Room | null = null;
    private send: ((data: PingMessage, target?: string) => void) | null = null;
    private discovered = false;
    private joinErrors: string[] = [];
    private roundTripped = false;
    private timers: ReturnType<typeof setTimeout>[] = [];
    private statsTimer: ReturnType<typeof setInterval> | null = null;
    private relayTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly results: HTMLElement, log: HTMLElement) {
        this.log = log;
        for (const stage of stageOrder) this.stages.set(stage, new StageView(results, stage));
    }

    private stage(name: Stage): StageView {
        const view = this.stages.get(name);
        if (view === undefined) throw new Error(`unknown stage ${name}`);
        return view;
    }

    private write(message: string): void {
        const line = el('div', 'log-line');
        const at = new Date().toLocaleTimeString();
        line.textContent = `${at}  ${message}`;
        this.log.append(line);
        this.log.scrollTop = this.log.scrollHeight;
    }

    start(code: string): void {
        this.stop();
        this.discovered = false;
        this.roundTripped = false;
        this.joinErrors = [];

        this.stage('signalling').set('waiting', 'joining…');
        this.stage('discovery').set('waiting', `waiting up to ${DISCOVERY_TIMEOUT_MS / 1000}s…`);
        this.stage('data').set('pending', 'not started');
        this.stage('route').set('pending', 'not started');
        this.write(`joining room ${code} as app "${APP_ID}"`);

        let room: Room;
        try {
            // A relay that refuses the room is the difference between "nobody
            // else is here" and "we never got to ask", so it goes on the record.
            room = joinGameRoom(code, {
                onJoinError: details => {
                    this.write(`join error: ${details.error}`);
                    this.joinErrors.push(details.error);
                    if (!this.discovered) {
                        this.stage('signalling').set('fail', 'relay refused the room',
                            this.joinErrors.map(e => `<div class="cand fail">${e}</div>`).join(''));
                    }
                },
            });
        } catch (e) {
            this.stage('signalling').set('fail', 'failed', `<div class="cand fail">${String(e)}</div>`);
            return;
        }
        this.room = room;

        this.watchRelays();

        const action = room.makeAction<string>(NET_ACTION);
        this.send = (data, target) => {
            void action.send(JSON.stringify(data), target === undefined ? undefined : { target });
        };

        action.onMessage = (raw, context) => {
            const peerId = context.peerId;
            let data: PingMessage;
            try {
                data = JSON.parse(raw) as PingMessage;
            } catch {
                this.write(`unreadable message from ${peerId}`);
                return;
            }
            if (data.t === 'ping') {
                this.write(`ping from ${peerId}, replying`);
                this.send?.({ t: 'pong', sent: data.sent }, peerId);
                return;
            }
            const rtt = Math.round(performance.now() - data.sent);
            this.write(`pong from ${peerId} after ${rtt}ms`);
            if (!this.roundTripped) {
                this.roundTripped = true;
                this.stage('data').set('ok', `round trip in ${rtt}ms`,
                    '<div class="cand ok">A message reached the other device and came back, so ICE completed.</div>');
                this.watchRoute();
            }
        };

        room.onPeerJoin = (peerId) => {
            this.write(`peer joined: ${peerId}`);
            if (!this.discovered) {
                this.discovered = true;
                this.stage('discovery').set('ok', 'peer found',
                    '<div class="cand ok">Both devices reached the same relay, so signalling works. Anything failing ' +
                    'from here is the direct connection, not the introduction.</div>');
                this.stage('signalling').set('ok', 'relays answered');
                this.stage('data').set('waiting', 'pinging…');
            }
            this.write('sending ping');
            this.send?.({ t: 'ping', sent: performance.now() }, peerId);
            this.timers.push(setTimeout(() => this.failData(), DATA_TIMEOUT_MS));
        };

        room.onPeerLeave = (peerId) => this.write(`peer left: ${peerId}`);

        this.timers.push(setTimeout(() => this.failDiscovery(), DISCOVERY_TIMEOUT_MS));
    }

    /**
     * Report the relay sockets as they settle. All closed is the whole answer:
     * the two devices were never introduced, and no amount of NAT traversal or
     * TURN would change that.
     */
    private watchRelays(): void {
        const tick = (): void => {
            const relays = relayStatus();
            if (relays.length === 0) {
                this.stage('signalling').set('waiting', 'connecting…',
                    '<div class="cand muted">No relay sockets reported yet.</div>');
                return;
            }
            const open = relays.filter(r => r.open);
            const rows = relays.map(r =>
                `<div class="cand"><span class="${r.open ? 'ok' : 'fail'}">${r.state}</span> ${r.url}</div>`).join('');

            if (open.length > 0) {
                this.stage('signalling').set('ok', `${open.length} of ${relays.length} relays connected`, rows);
            } else if (relays.every(r => r.state === 'closed')) {
                this.stage('signalling').set('fail', 'no relay connected',
                    rows + '<div class="verdict fail">Every signalling relay is closed, so this device cannot be ' +
                    'introduced to anyone. This is not NAT and a TURN server would not help — the relays are blocked ' +
                    'or unreachable on this network. Try <code>?relay=</code> with a relay of your own.</div>');
            } else {
                this.stage('signalling').set('waiting', 'connecting…', rows);
            }
        };
        tick();
        this.relayTimer = setInterval(tick, RELAY_INTERVAL_MS);
    }

    private failDiscovery(): void {
        if (this.discovered) return;
        if (this.joinErrors.length > 0) {
            this.stage('discovery').set('fail', 'never got to look',
                '<div class="cand fail">The relays reported errors above, so the room was never properly joined. ' +
                'Fix signalling before reading anything into the connection itself.</div>');
            this.stage('data').set('fail', 'not reached');
            this.stage('route').set('fail', 'not reached');
            return;
        }
        // Whether any relay is open splits this cleanly: with none, the device
        // was never introduced to anybody; with some, the introduction worked
        // and the other device simply was not there to meet.
        const open = relayStatus().filter(r => r.open);
        this.stage('discovery').set('fail', 'no peer found', open.length === 0
            ? '<div class="cand fail">No signalling relay ever connected, so this device was never introduced to ' +
              'anyone. The relays are blocked or unreachable on this network — not a NAT problem, and not one a TURN ' +
              'server would fix. Try <code>?relay=</code> with a relay of your own.</div>'
            : `<div class="cand fail">${open.length} relay(s) connected but nobody else appeared. Signalling works, ` +
              'so either the other device is not in this room, or the two devices landed on different relays and ' +
              'never saw each other. Check both used the same code; if they did, put both on the same relay with ' +
              '<code>?relay=</code>.</div>');
        this.stage('data').set('fail', 'not reached');
        this.stage('route').set('fail', 'not reached');
    }

    private failData(): void {
        if (this.roundTripped || !this.discovered) return;
        this.stage('data').set('fail', 'no round trip',
            '<div class="cand fail">The other device was found but no message got through, so the peer connection ' +
            'never completed. This is NAT traversal failing — exactly the case a TURN relay exists to fix.</div>');
        void this.showRouteAttempt();
    }

    /** Poll the live connection, since the winning pair can change mid-call. */
    private watchRoute(): void {
        this.stage('route').set('waiting', 'reading stats…');
        const tick = (): void => { void this.showRouteAttempt(); };
        tick();
        this.statsTimer = setInterval(tick, STATS_INTERVAL_MS);
    }

    private async showRouteAttempt(): Promise<void> {
        const room = this.room;
        if (room === null) return;

        const peers = room.getPeers();
        const ids = Object.keys(peers);
        if (ids.length === 0) {
            this.stage('route').set('fail', 'no peer connection', '');
            return;
        }

        const sections: string[] = [];
        let best: { text: string; state: StageState } | null = null;

        for (const id of ids) {
            const pc = peers[id];
            const route = await readRoute(pc);
            if (route === null) {
                sections.push(
                    `<div class="cand"><b>${id}</b> — ice ${pc.iceConnectionState}, connection ${pc.connectionState}` +
                    `<br><span class="fail">no candidate pair selected</span></div>`);
                continue;
            }
            const meaning = explainRoute(route);
            best = meaning;
            sections.push(
                `<div class="cand"><b>${id}</b> — ice ${pc.iceConnectionState}, connection ${pc.connectionState}` +
                `<br><span class="typ-${route.localType}">${route.localType}</span> ${route.localAddress}` +
                ` &rarr; <span class="typ-${route.remoteType}">${route.remoteType}</span> ${route.remoteAddress}` +
                ` <span class="muted">${route.protocol}</span></div>`);
        }

        const verdict = best === null ? '' : `<div class="verdict ${best.state}">${best.text}</div>`;
        this.stage('route').set(best === null ? 'fail' : 'ok',
            best === null ? 'no route yet' : 'connected', sections.join('') + verdict);
    }

    stop(): void {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers = [];
        if (this.statsTimer !== null) { clearInterval(this.statsTimer); this.statsTimer = null; }
        if (this.relayTimer !== null) { clearInterval(this.relayTimer); this.relayTimer = null; }
        if (this.room !== null) {
            this.write('leaving room');
            void this.room.leave();
            this.room = null;
        }
        this.send = null;
    }
}

function main(): void {
    const results = requireElement('results');
    const logEl = requireElement('log');
    const codeInput = requireElement('code') as HTMLInputElement;
    const startBtn = requireElement('start-btn') as HTMLButtonElement;
    const stopBtn = requireElement('stop-btn') as HTMLButtonElement;
    const newCodeBtn = requireElement('new-code-btn') as HTMLButtonElement;
    const statusEl = requireElement('status');

    requireElement('env').innerHTML =
        `<b>page:</b> ${location.href}<br><b>agent:</b> ${navigator.userAgent}`;

    let test: PeerTest | null = null;

    const start = (): void => {
        const code = codeInput.value.trim();
        if (!isLobbyCode(code)) {
            statusEl.innerHTML = '<span class="fail">Enter the same 6-digit code on both devices.</span>';
            return;
        }
        results.innerHTML = '';
        logEl.innerHTML = '';
        test = new PeerTest(results, logEl);
        statusEl.innerHTML = '<span class="warn">Running — start the other device on the same code.</span>';
        startBtn.disabled = true;
        stopBtn.disabled = false;
        test.start(code);
    };

    const stop = (): void => {
        test?.stop();
        statusEl.textContent = 'Stopped.';
        startBtn.disabled = false;
        stopBtn.disabled = true;
    };

    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    newCodeBtn.addEventListener('click', () => { codeInput.value = randomLobbyCode(); });
    window.addEventListener('beforeunload', () => test?.stop());

    codeInput.value = new URLSearchParams(location.search).get('code') ?? '';
    stopBtn.disabled = true;
}

main();
