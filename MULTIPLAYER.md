# MULTIPLAYER.md — Online Co-op

## Overview

Online co-op for 2–4 players who join by typing a short lobby code. One player
hosts, runs the real simulation, and everyone else sends inputs and draws what
the host reports. Co-op means nobody gains by cheating, so the host is trusted
absolutely and no validation is needed anywhere.

Local play is untouched: with no code entered the game runs exactly as it does
today, offline, with no network code on the path.

---

## Design decisions

### Host-authoritative, not lockstep or rollback

One player simulates; the rest render. This is forced by the existing code, not
chosen for simplicity:

| Constraint | Where | Consequence |
|---|---|---|
| Positions are floats advanced by wall-clock `deltaTime` | `Move.moveObject` (`src/static/Move.ts:156`) | Two machines running identical inputs diverge within seconds — **lockstep is out** |
| `Time.timers` holds closures | `src/object/Timer.ts` | Timer state cannot be serialised, so game state cannot be snapshotted and restored — **rollback is out** |
| Enemy AI is a seeded LCG | `AI.prngState` (`src/static/AI.ts:30`) | A single authoritative simulation reproduces exactly — **host-authoritative works** |

Death animations, level-clear sequencing and the dot-eating speed hiccup are all
scheduled as `Time.addTimer` closures. On the host that is fine; nothing else
ever needs to replay them.

### Peer-to-peer, not a game server

Trystero gives WebRTC matchmaking with no server to run: the lobby code *is* the
room ID, so code allocation, collision tables and TTLs simply do not exist. Game
traffic goes peer-to-peer and never touches a metered service, and the project
stays a pure static GitHub Pages deploy with no account, no deploy step and
nothing to keep alive.

The topology is a **star** — the three clients each connect to the host and to
nobody else — which keeps peer connections to three and avoids the mesh
scaling problems Trystero hits with many peers in one room.

**The cost:** no TURN server, so players behind symmetric NAT or a strict
corporate firewall (roughly 5–10% of connections) cannot connect at all, and
there is no free fix — TURN relays real bandwidth.

If that bites, Trystero also speaks to a self-hosted WebSocket relay. Swapping
strategies is an import change; a relay routes through a server and so sidesteps
NAT entirely. A Cloudflare Worker + Durable Object is the natural home (bills
inbound messages only, at 20:1, outbound free — about 11 hours of play per day
on the free tier). **Nothing below changes if the transport is swapped**: the
host-authoritative design and the wire format are transport-agnostic by
construction.

---

## Lobby codes

A 6-digit numeric code, or 4 characters from a 32-symbol alphabet excluding
`0`/`O` and `1`/`I`. Both give ~1M combinations. 4 digits (10k) is enough that
collisions are rare but small enough that a stranger can stumble in; cheating is
not a concern but an uninvited fifth player still is.

The code is the Trystero room ID directly:

```ts
const room = joinRoom({ appId: 'dot-maze' }, code);
```

The host generates a code and displays it. Clients type it. There is no
allocation step and no way to enumerate active codes — a joiner needs the code
and the app ID.

---

## Protocol

### Handshake

A joiner announces itself; the host replies with the level and an assigned slot.

```ts
// client → host
{ t: 'hello', protocol: PROTOCOL_VERSION }

// host → client
{ t: 'welcome', playerId: 2, level: LevelData, state: FullState }
// or
{ t: 'reject', reason: 'protocol' | 'full' | 'in-progress' }
```

**The protocol version is not optional.** `LevelData` changed shape recently
(`tunnelRow` + `tunnelSlowColMax`/`Min` collapsed into `tunnelSlowTiles`) and
`src/editor/LevelMigrate.ts` exists to absorb that. Migration only runs
forwards: an **older client handed a newer level shape has no recovery path**,
and GitHub Pages users hold stale tabs for a long time. Mismatches must be
refused with a "reload the page" message rather than half-working.

Bump `PROTOCOL_VERSION` whenever `LevelData`, the snapshot format or the input
format changes.

### Client → host: input

Sent on change plus a heartbeat, so roughly 5–20 messages/second.

```ts
interface InputMsg {
    t: 'input';
    held: number;             // bitmask: 1=left 2=right 4=up 8=down
    buffered: Direction | null;
    seq: number;              // for prediction reconciliation
}
```

Held state matters as well as the buffered direction — holding into a wall until
a corridor opens is real behaviour in `KeyboardPlayerInput.update`, and sending
only "the direction I want" would lose it.

### Host → client: snapshot

20 Hz. Sent as JSON to start with — at ~400 bytes × 20 Hz × 3 clients that is
under 10 KB/s and will never need optimising. A binary encoding quantising
positions to ¹⁄₁₆ tile would reach ~90 bytes if it ever matters.

```ts
interface Snapshot {
    t: 'snap';
    tick: number;
    ack: number[];                    // last input seq seen per player
    players: Array<{
        id: number; x: number; y: number; dir: Direction;
        active: boolean; dying: boolean; deathProgress: number; frozen: boolean;
    }>;
    enemies: Array<{                  // always 4, in gameObjects order
        x: number; y: number; dir: Direction; mode: EnemyMode;
    }>;
    score: number; lives: number; level: number;
    frightenedRemaining: number;
    fruit: { x: number; y: number } | null;
    showReady: boolean; frozen: boolean; gameOver: boolean;
    eaten: number[];                  // tile indices (y*28+x) eaten since last ack
    events: NetEvent[];               // see below
}
```

`Levels.wrapsAt()` derives wrapping from the tile grid rather than a declared
field, so wrap behaviour needs no syncing — clients infer it from tiles they
already hold.

### Events

Sound is triggered inline inside game logic — `Sound.dot()` fires from
`makePlayerOnTileChanged` (`src/Game.ts:762`), `Sound.death()` from `loseLife`
(`src/Game.ts:702`). Clients never run that logic, so audio has to arrive as
data:

```ts
type NetEvent =
    | { e: 'dot' } | { e: 'power' } | { e: 'fruit' }
    | { e: 'eatEnemy'; chain: number }
    | { e: 'death'; playerId: number }
    | { e: 'levelClear' } | { e: 'extraLife' };
```

The ambient siren is derived, not sent: `updateAmbientSiren` already picks the
siren from enemy modes and `frightenedRemaining`, both of which are in every
snapshot, so clients can run it unchanged.

### Disconnects

| Event | Behaviour |
|---|---|
| Client drops | `active = false`, slot held 30 s for reconnect, freed at level clear |
| Client returns within 30 s | Re-seated into the same slot, full state resent |
| Host drops | Everyone returns to the menu — there is no host migration |
| Tab backgrounded | `rAF` stops and the snapshot buffer starves; pause on `visibilitychange` |

---

## What the codebase already provides

The game side of co-op is done. These are not changes to make — they are reasons
the change is small.

| Already true | Where |
|---|---|
| `players` is an array with per-player `active`/`dying`/`frozen` | `src/game-state.ts` |
| Collisions are resolved per player | `checkCollisions` (`src/Game.ts:741`) |
| Enemies target the nearest of N players | `AI.nearestPlayer` (`src/static/AI.ts:167`) |
| Shared life pool, sit-out-and-revive | `loseLife` (`src/Game.ts:702`) |
| Input is an interface of 4 booleans + a buffered direction | `src/input/PlayerInput.ts` |
| Arbitrary input sources compose | `CompositePlayerInput` |
| `start()` already takes `{ id, input }[]` | `ConfirmedSlot` (`src/Game.ts:17`) |
| Move and draw are injected per object | `GameObject` constructor |
| Canvas scale is CSS-only (`normalizedUnit()` returns `1`) | `src/static/Draw.ts:36` |
| DOM overlays over the canvas are an established pattern | `showInitialsEntry` (`src/Game.ts:558`) |

Two consequences worth stating outright:

**A remote player needs no game-logic changes.** `RemotePlayerInput` implements
`PlayerInput`, the host feeds it booleans off the wire, and `start()` seats it
like any other input. Nothing downstream knows the difference.

**A render-only client needs no sim/render split.** Because `GameObject` takes
`moveFunction` and `drawFunction` as separate constructor arguments, a client
constructs its actors with a no-op move function and no-op tile callbacks. Then
`update()` only draws, and the network layer writes `x`/`y`/`moveDir` straight
onto the actors before each frame.

Canvas scale being CSS-only matters for prediction: a phone and a desktop
advance positions identically, so a client can predict its own movement without
resolution-dependent drift.

---

## Architecture

### Files to add

| File | Purpose |
|---|---|
| `src/net/Protocol.ts` | `PROTOCOL_VERSION`, message types, snapshot encode/decode |
| `src/net/NetHost.ts` | Room hosting, peer seating, snapshot broadcast, input intake |
| `src/net/NetClient.ts` | Join, handshake, snapshot buffer, interpolation, apply-to-state |
| `src/net/RemotePlayerInput.ts` | `PlayerInput` fed from the wire |
| `src/net/LobbyScreen.ts` | Host and join screens, code entry, roster |

### Files to change

| File | Change |
|---|---|
| `src/input/PlayerInput.ts` | Extract the shared apply-direction + buffer-retry helper |
| `src/input/KeyboardPlayerInput.ts`, `GamepadPlayerInput.ts` | Use the helper |
| `src/Game.ts` | Menu entries for host/join; net hooks in `start`, `update`, `initializeLevel` |
| `src/static/Sound.ts` | Nothing structural — clients call it from `NetEvent`s |

The shared-helper extraction comes first. That apply-and-retry block is
duplicated between `KeyboardPlayerInput` and `GamepadPlayerInput` already;
`RemotePlayerInput` would make three copies. Pulling it out once pays for itself
immediately.

### Data flow

```
HOST                                        CLIENT
────                                        ──────
Menu → Host Online
  ↓
generate code, joinRoom(appId, code)
  ↓                                         Menu → Join Online → type code
show code + roster                          joinRoom(appId, code)
  ↓                                           ↓
onPeerJoin ←──────── {hello, protocol} ───────┘
  ↓
seat slot, new RemotePlayerInput()
  ├────── {welcome, playerId, level} ────────→ migrateLevel + build render-only
  ↓                                            actors, show lobby roster
host presses START
  ├────── {start} ───────────────────────────→
  ↓                                            ↓
start(slots) — unchanged                     netClientLoop() [rAF]
  ↓                                            ↓
update() [rAF, unchanged]                    apply interpolated snapshot to actors
  → input.update(actor)   ← RemotePlayerInput  → Draw.level() / go.update() (draw only)
  → Move / AI / collisions                     → Draw.hud() from synced score+lives
  → Draw / Sound                               → Sound from snapshot events
  ↓                                            ↓
every 3rd frame: broadcast snapshot ─────────→ push to buffer (render ~100 ms behind)
  ↑                                            ↓
  └───────────── {input, held, seq} ───────────┘
```

The host's `update()` loop is the one that exists today. The only additions are
feeding `RemotePlayerInput`s at the top and broadcasting a snapshot at the
bottom.

---

## Implementation phases

### Phase 1 — Plumbing

- Extract the shared input-apply helper; rewire Keyboard and Gamepad to it.
- `RemotePlayerInput` against that helper.
- `Protocol.ts`: version constant, message types, snapshot encode/decode.
- No UI, no transport. Verify by seating a `RemotePlayerInput` locally and
  driving it from the debug panel — the existing "Extra players" slider already
  injects phantom players and is the natural harness.

### Phase 2 — Transport and lobby

- `npm i trystero`.
- `NetHost` / `NetClient`: join, handshake, version check, roster.
- Lobby screens: host shows the code and who has joined; join takes a code.
  Code entry reuses the `showInitialsEntry` overlay pattern for keyboards, with
  canvas-drawn digit selection for gamepad and touch.
- Menu gains `HOST ONLINE` / `JOIN ONLINE` next to the existing flow.

**Done when** two browsers reach a shared lobby by code and see each other's
names. No gameplay yet.

### Phase 3 — Playable

- Host broadcasts snapshots at 20 Hz; client applies them directly, no
  interpolation.
- Client sends inputs; host feeds `RemotePlayerInput`.
- Client builds render-only actors and draws HUD from synced values.
- Events drive client audio.

**Done when** two people finish a level together. It will feel floaty — the
local player lags a full round trip — and remote motion will be visibly steppy
at 20 Hz. Both are Phase 4's problem.

### Phase 4 — Feel

- Interpolation: buffer two snapshots, render ~100 ms behind.
- Client-side prediction for the local player only — run `Move.player` locally,
  reconcile against `ack`, snap when divergence exceeds one tile.
- Disconnect, reconnect, host-left handling.
- `visibilitychange` pause.

### Phase 5 — Custom levels

The editor is the most actively developed part of the project, so "play my maze
together" is worth real attention. The host already sends `LevelData` in the
`welcome` message; this phase is picking a level from the library before hosting
and confirming `migrateLevel` runs on the receiving side.

---

## Open decisions

| Question | Options | Leaning |
|---|---|---|
| Code format | 4 digits / 6 digits / 4 base-32 chars | 6 digits — typable, ~1M space |
| Who saves the high score? | Host only / everyone / nobody | Host only — `Stats` is per-device localStorage and a shared score saved four times is four identical rows |
| Can players join mid-game? | Yes, next level / no | Next level — `initializeLevel` builds the actor list once |
| Host leaves | Everyone to menu / migrate host | Everyone to menu — migration needs serialisable timers, which is the same wall that blocks rollback |

---

## Risks

| Risk | Mitigation |
|---|---|
| NAT traversal fails without TURN (~5–10%) | Documented limitation; escape hatch is a self-hosted relay, which the design already supports |
| Public tracker flakiness or slow joins | Show a "connecting…" state; Trystero can try multiple strategies |
| Version skew between cached tabs | `PROTOCOL_VERSION` in the handshake, refuse with a reload prompt |
| Merge conflicts with editor work | Net code lives in `src/net/`; only `Game.ts` is shared. Land in small merges rather than one long-lived branch |

### Performance note

Two linear scans sit in the per-frame path and the host will be encoding
snapshots on those same frames:

- `isEnemyInTunnel` scans `tunnelSlowTiles` per enemy per frame (`src/Game.ts:163`)
- `Levels.wrapsAt()` is called per actor per frame in `Move.moveObject`, plus in
  `AI` and `canEnemyMoveDir`

At 12 tiles × 4 enemies × 60 Hz this costs nothing today. If it is ever touched,
build a `Set` of `"x,y"` keys once at level load. Not a blocker.

---

## Implementation Status

| Feature | Status |
|---|---|
| Shared input-apply helper extracted | ⬜ Planned |
| `RemotePlayerInput` | ⬜ Planned |
| Protocol types, version, snapshot codec | ⬜ Planned |
| Trystero transport, host + client | ⬜ Planned |
| Lobby screens and code entry | ⬜ Planned |
| Snapshot broadcast and apply | ⬜ Planned |
| Event-driven client audio | ⬜ Planned |
| Interpolation | ⬜ Planned |
| Client-side prediction | ⬜ Planned |
| Disconnect / reconnect / host-left | ⬜ Planned |
| Custom level sync from the library | ⬜ Planned |
| WebSocket relay fallback | ⬜ Deferred — only if NAT failures prove common |
| Host migration | ❌ Out of scope — blocked by non-serialisable timers |
| Anti-cheat / server validation | ❌ Out of scope — co-op, host is trusted |
