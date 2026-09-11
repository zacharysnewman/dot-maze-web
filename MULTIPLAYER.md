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

Trystero's default entry point signals over public **nostr** relays (the other
strategies — MQTT, BitTorrent, Supabase, Firebase, IPFS — are separate imports,
each a one-line swap). Signalling is only how peers find each other; once a
connection is up, game traffic is direct.

The topology is a **star** — the three clients each connect to the host and to
nobody else — which keeps peer connections to three and avoids the mesh
scaling problems Trystero hits with many peers in one room.

**The cost:** no TURN server, so players behind symmetric NAT or a strict
corporate firewall (roughly 5–10% of connections) cannot connect at all, and
there is no free fix — TURN relays real bandwidth.

`?relay=<url>` on the game's URL points **signalling** at a relay of your own
instead of the public list — a private group's own relay, or a local one for
testing. That fixes flaky or blocked relays, not NAT: signalling is only how
peers find each other, and the connection is still direct.

For NAT itself, Trystero also speaks to a self-hosted WebSocket relay, which
routes the traffic through a server and so sidesteps NAT entirely. That is one
new implementation of the `Transport` interface and nothing else. A Cloudflare
Worker + Durable Object is the natural home (bills inbound messages only, at
20:1, outbound free — about 11 hours of play per day on the free tier).
**Nothing below changes if the transport is swapped**: the host-authoritative
design and the wire format are transport-agnostic by construction.

---

## Lobby codes

**Six digits**, `000000`–`999999`. A million combinations, and every input
device the game already supports can enter digits. 4 digits (10k) would collide
rarely enough, but is small enough that a stranger could stumble into a game —
cheating is not a concern, an uninvited fifth player still is.

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
{ t: 'hello', protocol: PROTOCOL_VERSION, name: 'ZSN' }

// host → client
{ t: 'welcome', protocol, playerId: 2, level: LevelData, roster: PeerInfo[],
  state: Snapshot | null }   // state is null while the room is still in the lobby
// or
{ t: 'reject', reason: 'protocol' | 'full' | 'in-progress' }
```

Two more host → client messages keep the lobby live: `{ t: 'roster', roster }`
when someone joins, leaves or reconnects, and `{ t: 'start', level }` when the
host presses START — it carries the level because the host may have picked a new
one since the welcome. Clients send `{ t: 'leave' }` on the way out.

**The protocol version is not optional.** `LevelData` changed shape recently
(`tunnelRow` + `tunnelSlowColMax`/`Min` collapsed into `tunnelSlowTiles`) and
`src/editor/LevelMigrate.ts` exists to absorb that. Migration only runs
forwards: an **older client handed a newer level shape has no recovery path**,
and GitHub Pages users hold stale tabs for a long time. Mismatches must be
refused with a "reload the page" message rather than half-working.

Bump `PROTOCOL_VERSION` whenever `LevelData`, the snapshot format or the input
format changes. It is at **2**: the handshake gained `clientId`, which is what
a held seat is keyed by.

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

20 Hz, JSON. A full four-player snapshot measures **887 bytes**, so a host with
three clients uploads ~52 KB/s (~420 kbit/s) and each client pulls ~17 KB/s.
Fine on broadband, tight on a weak uplink — the first lever if it bites is
eliding default-valued fields, then a binary encoding quantising positions to
¹⁄₁₆ tile, which would reach ~90 bytes.

Positions are rounded to one decimal on encode. They are pixel-space
(`tile × 20`), so that is ¹⁄₂₀₀ of a tile — far below anything visible.

```ts
interface Snapshot {
    t: 'snap';
    tick: number;
    ack: Record<number, number>;      // last input seq seen, per player id
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
    hostPhase: HostPhase;             // what screen the host is on
    eaten: number[];                  // tile indices (y*28+x) eaten since last ack
    events: NetEvent[];               // see below
}

// `gameOver`/`frozen`/`showReady` say how to draw the maze; `hostPhase` says
// which screen the client should be on, which is a different question once the
// host leaves the maze behind.
type HostPhase = 'playing' | 'gameover' | 'initials' | 'lobby';
```

`Levels.wrapsAt()` derives wrapping from the tile grid rather than a declared
field, so wrap behaviour needs no syncing — clients infer it from tiles they
already hold.

`eaten` is a delta, which cannot express "all the dots are back". It does not
have to: the host rebuilds its dot grid exactly when the level number changes,
so a client rebuilds on a change to `level` and applies deltas within one.

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
| Client goes quiet for 1 s | Held directions released — otherwise they run at a wall |
| Client goes quiet for 8 s | Seat held, player sat out. WebRTC needs 12 s+ to notice a closed tab |
| Client drops | Seat held 30 s, keyed by a `clientId` in localStorage |
| Client sees 6 s of silence | Stops waiting on WebRTC and rebuilds the connection itself, retrying for 28 s |
| Client returns within 30 s | Same slot, and the running game arrives in the `welcome` — including every tile eaten so far, since a delta means nothing to someone who missed the ones before it. They sit out until the next level or life, like any player who was not there |
| Host drops | Everyone returns to the menu — there is no host migration |
| Host goes quiet | Clients say so over the frozen maze and stop predicting |
| Tab backgrounded | Controls released on the way out, snapshot backlog dropped on the way back |

### The room outlives the game

Game over does not end the session. The host falls back to the lobby with the
code still live and the roster intact, and can start another game with everyone
already seated. Only the host closing the room or leaving ends it.

That makes the host's screen and the clients' screens diverge for the first
time, which is what `hostPhase` is for:

| `hostPhase` | Host sees | Clients see |
|---|---|---|
| `playing` | The maze | The maze |
| `gameover` | GAME OVER | GAME OVER |
| `initials` | Initials entry (`showInitialsEntry`) | GAME OVER + "waiting for host…" |
| `lobby` | Lobby: code, roster, START | "waiting for host to start a new game" |

The client game-over screen is **GAME OVER**, the final score, a host-status
line, and a **LEAVE** button. The status line is the point: without it a client
watching the host type initials has no way to tell a busy host from a hung
connection.

Clients never enter initials — the host saves the score (see Decisions), so
there is nothing for a client to type.

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
| `src/net/Transport.ts` | The one interface the net code needs from the network, and the Trystero implementation of it |
| `src/net/NetHost.ts` | Room hosting, peer seating, snapshot broadcast, input intake |
| `src/net/NetClient.ts` | Join, handshake, snapshot buffer, interpolation, apply-to-state |
| `src/net/RemotePlayerInput.ts` | `PlayerInput` fed from the wire |
| `src/net/InputSampler.ts` | Reads the local player on a machine that runs no simulation |
| `src/net/NetEvents.ts` | What the host did that a client cannot derive: sounds, and eaten tiles |
| `src/net/ClientGame.ts` | Render-only world: build it, write snapshots onto it, interpolate, predict, draw |
| `src/net/LobbyScreen.ts` | Host and join screens, code entry, roster |

### Files to change

| File | Change |
|---|---|
| `src/input/PlayerInput.ts` | Extract the shared apply-direction + buffer-retry helper |
| `src/input/KeyboardPlayerInput.ts`, `GamepadPlayerInput.ts`, `TouchPlayerInput.ts` | Use the helper |
| `src/Game.ts` | Menu entries for host/join; net hooks in `start`, `update`, `initializeLevel` |
| `src/static/Sound.ts` | Nothing structural — clients call it from `NetEvent`s |
| `src/static/Speeds.ts` | The speed table, moved out of `Game.ts` so a predicting client can use it |
| `src/editor/LibraryModal.ts` | The saved-maps list, extracted from the editor so the lobby can pick from it |

The shared-helper extraction comes first. The buffer-retry block was already
copied across `KeyboardPlayerInput`, `GamepadPlayerInput` and
`TouchPlayerInput`; `RemotePlayerInput` would have made a fourth. Pulling it out
once pays for itself immediately.

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

### Phase 1 — Plumbing ✅

- `applyPlayerInput` / `bufferDir` / `isDirOpen` extracted into
  `src/input/PlayerInput.ts`. Keyboard, Gamepad **and Touch** now call them —
  Touch was a third copy of the buffer-retry block, so the extraction paid for
  itself before `RemotePlayerInput` existed.
- `src/net/Protocol.ts`: `PROTOCOL_VERSION`, every message type, the held-direction
  bitmask, tile-index packing, and a codec that returns `null` on anything it
  cannot parse rather than throwing inside the render loop.
- `src/net/RemotePlayerInput.ts`: a `PlayerInput` fed by `receive(InputMsg)`.
  It drops stale and duplicate sequence numbers, and re-buffers a direction only
  when the sender newly buffered it — otherwise a held-into-a-wall turn resent
  every message would never expire.
- Phantom debug players are now seated with `RemotePlayerInput` instead of a
  dead gamepad, and a **Mirror P1 to extras (net)** checkbox runs player 1's
  input through `encodeMessage` → `decodeMessage` → `receive` each frame. That
  is the whole multiplayer input path exercised with no transport present.

**Verified:** held direction applies, held-into-a-wall is ignored, a buffered
turn waits at a wall and fires when the corridor opens, the buffer expires after
8 frames, stale sequence numbers are dropped, malformed payloads decode to
`null`, and a snapshot survives the round trip.

### Phase 2 — Transport and lobby ✅

- `trystero` added, behind `src/net/Transport.ts`. The net code asks the network
  for four things — send to one peer or all, peers joining, peers leaving, leave
  — so the relay escape hatch above is a second implementation of that interface
  and no change anywhere else. It is also what let the handshake be tested
  without a network at all.
- `NetHost` seats joiners (lowest free id, so a seat freed by a leaver is reused)
  and refuses them with `protocol`, `full` or `in-progress`. `NetClient` greets
  every peer it meets, since only a host answers a hello, and gives up after
  20 s — long enough for a slow relay handshake, short enough that a wrong code
  does not look like a hang.
- The menu gained `HOST ONLINE` / `JOIN ONLINE` below `START GAME`. It is a list
  now, navigable by arrows, d-pad or swipe — but `START GAME` is first and
  selected, so tap-tap-play reaches the same place it always did.
- Code entry follows `showInitialsEntry`: a transparent full-screen input, so a
  keyboard types into it and a tap raises the mobile keypad. Gamepads get the
  arcade treatment instead — left/right for the slot, up/down to spin the digit —
  since there is no text field a d-pad can drive.
- Names come from the initials the player last entered on the high-score screen
  (`Stats.loadInitials`), so nobody is asked to name themselves twice. Anyone who
  has never placed gets a tag generated once and kept.

**No START button yet** — the lobby says so rather than offering a control that
cannot work. It arrives with Phase 3, along with the game it starts.

**Verified:** three browser profiles joined one code over real WebRTC and each
saw the full roster; seats fill 2→3→4 and refuse a fifth; an older protocol
version is refused; a freed seat is reused; the host leaving tells everyone; a
code with no lobby behind it times out. Signalling ran against a local relay,
so the public relay list and real-world NAT traversal are the parts still
unproven.

### Phase 3 — Playable ✅

- The host broadcasts a snapshot every third frame and seats remote players
  through `start()` exactly like local ones. Clients send input on change with a
  10 Hz heartbeat behind it.
- The render-only client turned out to be as cheap as promised: no-op move
  functions, no-op tile callbacks, and the snapshot written straight onto
  `x`/`y`/`moveDir`. The whole draw path — maze, HUD, READY!, game over, the
  fruit counter, the death animation — is the host's, unchanged, reading a
  `gameState` the network filled in.
- `src/net/NetEvents.ts` collects what a client cannot derive: sounds fired
  inside host-only logic, and the tiles that lost their dots. Recording is off
  unless a host is running, so local play never fills a buffer nothing drains.
- `src/net/InputSampler.ts` reads the local player on a machine with no
  simulation. It runs `update()` against an actor standing in an imaginary open
  crossroads, which both polls the gamepad — whose held flags only refresh
  inside `update()` — and consumes a buffered turn so it is reported once, on
  the frame it was asked for.
- Game over returns the host to its lobby with the code live and the roster
  intact, and a second game starts with everyone still seated. Clients follow
  the host's `hostPhase` through it.

**Two things fell out of building it.** The client builds its player list from
the first snapshot rather than the lobby roster — the snapshot is the authority
on who is playing, and a roster read at START can already be stale. And the
dot grid needs no epoch field: the host rebuilds it exactly when the level
number changes, which every snapshot already carries, so a client rebuilds on
that and applies `eaten` within a level.

**Verified** in two browsers on one lobby code: both draw the same maze, score
and HUD; a client's arrow keys eat dots on the host; game over shows GAME OVER
on both, then the client waits on "WAITING FOR THE HOST..." with a LEAVE button
while the host types initials, then both land back in the lobby and a second
game starts. Local play was re-checked offline and is untouched.

It feels floaty, as predicted — the local player lags a full round trip — and
remote motion is visibly steppy at 20 Hz. Both are Phase 4's problem.

### Phase 4 — Feel ✅

- **Interpolation.** The client draws 100 ms behind the newest snapshot,
  blending positions between the two that straddle that moment. Discrete state
  — score, modes, eaten dots, sounds — is applied as its snapshot comes into
  view rather than as it arrives, so a dot sounds at the moment it visibly
  goes. A tunnel wrap is a teleport, not a movement, so a jump over eight tiles
  is taken whole instead of sliding back across the maze.
- **Prediction.** The local player is driven by a `RemotePlayerInput` fed the
  same messages the host is sent, so prediction and authority interpret a
  buffered turn through identical code. It runs `Move.player` locally against
  the real maze, and the speed table moved to `src/static/Speeds.ts` so both
  sides compute the same number from what a snapshot already carries.
- **Reconciliation** compares the host's position against where the prediction
  *was* when the acknowledged input went out, not against where it is now —
  those are a round trip apart. Past a tile it shifts by the error rather than
  jumping to the host's position, which would undo every step since; past four
  tiles (a death, a teleport, a new level) it gives up and snaps.
- **Presence beats WebRTC.** A closed tab takes WebRTC twelve seconds or more
  to report, which is far too long to leave someone standing in a maze full of
  enemies. Silence is the faster signal: a second without input lets go of
  their controls, eight seconds holds their seat and sits them out. Seats are
  held for 30 s and keyed by a `clientId` in localStorage, so a player who
  reloads lands back in the same slot and gets the running game in their
  `welcome` — straight into the maze, no lobby in between.
- **Sitting out is the existing mechanic.** A player who drops is sat out
  exactly as a dead one is, and the revive paths bring them back at the next
  level or life. Those paths now skip anyone still absent: reviving an empty
  chair feeds the shared life pool to nobody.
- **A hidden tab** lets go of its controls on the way out, so nobody's avatar
  keeps running while they are away, and throws away the backlog on the way
  back instead of replaying it in fast forward.
- **When the host goes quiet** — a lag spike, a backgrounded tab — clients say
  so over the frozen maze rather than looking broken, and stop predicting into
  a world nobody is correcting.

**Verified** in two browsers: the local player answers its own keyboard in
under 120 ms where a round trip plus interpolation would be 150; enemies move
on more than 70% of frames rather than every third; a closed tab is sat out in
seconds rather than on WebRTC's schedule; a reload lands back in the running
game; and a 3.5-second stall on the host raises the waiting banner and clears
it when the host recovers.

**Automatic reconnection** landed after Phase 5 — see below.

### Phase 5 — Custom levels ✅

The editor is the most actively developed part of the project, so "play my maze
together" is the payoff — and it is now two taps from the lobby.

- The library modal moved to `src/editor/LibraryModal.ts` and is genuinely
  shared. Same list, same cards, different buttons: the editor loads,
  play-tests and deletes; a host picks what everyone is about to play. The
  editor's own behaviour is unchanged.
- **CHANGE MAP** sits on the host's lobby screen, so the map can be swapped
  between games as well as before the first one — the room outlives a game, and
  so does the choice. The picker leads with the classic maze and lists every
  saved map with its dot and power counts.
- **A level that cannot be played is refused at the picker**, with the
  validator's reasons, rather than failing once four people have joined a game
  built on it. Budgets are checked against the tile set the map was authored
  under.
- The lobby shows the map name to everyone, and a host changing it tells the
  clients waiting in the lobby. That rides on the existing `roster` message as
  an additive field, so no protocol bump: a client that ignores it simply shows
  the map it was welcomed with.
- Clients migrate an incoming level (`migrateLevel`) and do not re-validate it.
  The host already did, and in co-op the host is trusted — version skew, the
  one case where that would not hold, is refused at the handshake.

**Verified:** the picker lists saved maps beside the stock one; a map walled in
end to end is refused with reasons and the picker stays open; picking a good one
renames the map on the host's lobby and on a waiting client's; and starting
plays it — a map with its top rows stripped of dots renders that way on both
machines. The editor's own library modal was re-checked: save, list, load, and
the three buttons it has always had.

### Automatic reconnection ✅

Phase 4 held a seat for 30 seconds but made the player type the code again to
claim it. Now the client claims it by itself.

- **Silence is the trigger**, as it is on the host: six seconds without a
  snapshot and the client stops waiting for WebRTC to admit the connection is
  dead — it takes twelve seconds or more, which would burn most of the seat
  hold. A dropped peer reported by the transport starts the same loop.
- **Each attempt is a fresh room join**, five seconds apart, for twenty-eight
  seconds in total — just inside the host's thirty, so a reconnection cannot
  succeed into a seat that has already been freed. Then it gives up and returns
  to the menu.
- The screen says `RECONNECTING...` with the time left, over the frozen maze,
  and ESC or B leaves immediately rather than waiting it out.
- **The welcome now carries every tile eaten so far**, not the delta since the
  last snapshot. A returning player who was sent a delta would watch the maze
  fill back up with dots that are long gone. Building it no longer drains the
  event buffer either — that was quietly stealing sounds from everyone else's
  next snapshot.

**Verified** in two browsers: a host stalled for nine seconds leaves the client
saying `RECONNECTING...`, and it is back in the game by itself, with the dots
it missed still eaten and enemies moving again; a host that closes for good
leaves the client trying, and on the menu once the window runs out.

---

## Decisions

| Question | Decision | Why |
|---|---|---|
| Code format | **6 digits** | ~1M combinations; enterable on every input device the game supports |
| Who saves the high score? | **Host only** | `Stats` is per-device localStorage — a shared score saved by four players is four identical rows on four devices |
| Joining mid-game | **At the next level**. Mid-level joining is out of scope | `initializeLevel` builds the actor list once; see below |
| Host leaves | **Everyone to the menu** | Host migration needs serialisable timers — the same wall that blocks rollback |
| Client screen at game over | **GAME OVER + host status + LEAVE** | A client cannot otherwise distinguish a host typing initials from a dead connection |
| Host picks the level | **Yes**, from the library before hosting | The editor is the most active part of the project; playing a friend's maze together is the payoff |

### Mid-level joining, dropped

A joiner waits for the next level, and that is where it stays. `initializeLevel`
(`src/Game.ts:810`) builds `players` and `gameObjects` in one pass and nothing
appends to them mid-level; supporting it would mean deciding where a latecomer
appears, whether they are briefly invulnerable, and how that interacts with the
death-and-revive path. Waiting out one level costs a minute and nothing else.

The same rule covers a player who drops and comes back: they sit out exactly as
a dead player does, and the existing revive paths bring them in at the next
level or life. That is why reconnection needed no spawn logic of its own.

Nothing in the wire format forbids it if it is ever wanted: `players` is
variable-length, the client rebuilds its player list from every snapshot, and a
welcome already carries everything a latecomer needs.

---

## Risks

| Risk | Mitigation |
|---|---|
| NAT traversal fails without TURN (~5–10%) | Documented limitation; escape hatch is a self-hosted relay, which the design already supports |
| Public tracker flakiness or slow joins | Show a "connecting…" state; Trystero can try multiple strategies |
| Version skew between cached tabs | `PROTOCOL_VERSION` in the handshake, refuse with a reload prompt |
| Merge conflicts with editor work | Net code lives in `src/net/`; only `Game.ts` is shared. Land in small merges rather than one long-lived branch |
| Trystero costs every player ~137 KB of bundle, offline play included | Acceptable gzipped; if it matters, a dynamic `import()` of `src/net/` keeps it off the local-play path, at the cost of an esbuild splitting step |

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

All five phases are done, and so is automatic reconnection. What is left is the
relay fallback, if NAT traversal proves too lossy in real use.

| Feature | Status |
|---|---|
| Shared input-apply helper extracted | ✅ Complete — Keyboard, Gamepad and Touch |
| `RemotePlayerInput` | ✅ Complete — driven by the debug loopback |
| Protocol types, version, snapshot codec | ✅ Complete |
| Trystero transport, host + client | ✅ Complete — behind a `Transport` seam |
| Lobby screens and code entry | ✅ Complete |
| Snapshot broadcast and apply | ✅ Complete |
| Event-driven client audio | ✅ Complete |
| Interpolation | ✅ Complete — 100 ms behind |
| Client-side prediction | ✅ Complete — for the local player only |
| Disconnect / reconnect / host-left | ✅ Complete — manual rejoin, seat held 30 s |
| Client game-over screen with host status | ✅ Complete |
| Waiting banner when the host goes quiet | ✅ Complete |
| Lobby code in the HUD during an online game | ✅ Complete — the lobby is the only other place it appears |
| Marker over your own player online | ✅ Complete — the props say which slot, this says which is yours |
| Automatic reconnection (client retries by itself) | ✅ Complete — 28 s of retries against a 30 s seat hold |
| Room survives game over, host restarts from the lobby | ✅ Complete |
| Host picks a library level before hosting | ✅ Complete — and between games, not only before the first |
| Mid-level joining | ❌ Out of scope — joiners and returners wait for the next level |
| WebSocket relay fallback | ⬜ Deferred — only if NAT failures prove common |
| Host migration | ❌ Out of scope — blocked by non-serialisable timers |
| Anti-cheat / server validation | ❌ Out of scope — co-op, host is trusted |
