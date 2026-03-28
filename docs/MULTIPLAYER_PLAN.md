# Multiplayer Implementation Plan

## Design Decisions (Resolved)

| Question | Decision |
|---|---|
| Ghost multi-target strategy | Each ghost targets the **nearest active player** |
| Energizer scope | Any player eats a power pellet → **all ghosts frightened** |
| Ghost eaten chain | **Shared** across all players (escalates globally) |
| Max player count | **Up to 4 players** |
| Lives pool size | **Same as single-player (3 lives)** — shared across all players |
| Lives pool behavior | Death plays animation, player sits out rest of level (no mid-level respawn); shared pool decrements by 1 per death (min 0); at 0, dead players are not revived at level start |
| Game over condition | Only when **all players are simultaneously inactive** (no active player remains) |
| Level clear | If **any player** clears the level, **all players who have lives remaining** are revived for the next level |
| Extra life at 10k | **One life added to the shared pool** (not per player); triggers once per game regardless of which player crosses 10k |
| Elroy trigger | **No change** — based on total dots remaining in the shared maze; works identically with multiple players |
| Inky's targeting (Blinky reference) | **Option A** — Inky finds his nearest Pacman and uses that actor for both the intermediate point and the Blinky vector; pincer behaviour is preserved against whoever Inky is closest to |
| Player visual differentiation | All players are **yellow Pac-Man**; differentiated by props (see Phase 7) |
| Score | **Shared combined score** — all players contribute to one score; not tracked per-player |
| High score entries | **Single entry** — one combined score, one set of initials |
| Input assignment | **Keyboard and touch are hardcoded to P1.** Controllers are assigned by connection order: gamepad[0] → P1, gamepad[1] → P2, gamepad[2] → P3, gamepad[3] → P4. P1 therefore accepts keyboard, touch, and gamepad[0] simultaneously. P2–P4 require a connected controller. |
| Mid-level player death | Players **do not respawn mid-level**. Death animation plays, then the player sits out for the remainder of the level. Ghosts and other players keep moving — no global freeze on individual death. |
| "READY!" screen | Only shown at **game start and level clear** — not after individual player deaths |
| Simultaneous death animations | Both animations **play concurrently** — no queuing |
| Fruit collection | **First-come-first-served** — fruit disappears on first contact; no shared award |

## Open Design Questions

All design questions resolved. No open items.

---

## Phase 1 — Input Abstraction ✅ COMPLETE

**Goal:** Replace the global `Input` static class with instantiable, player-owned input handlers that support keyboard and gamepad.

### `src/static/Input.ts` → `src/input/PlayerInput.ts`
- Define `PlayerInput` interface:
  ```ts
  interface PlayerInput {
    leftPressed: boolean
    rightPressed: boolean
    upPressed: boolean
    downPressed: boolean
    bufferedDir: Direction | null
    bufferedDirFramesLeft: number
    update(actor: IGameObject): void
    destroy(): void  // remove event listeners
  }
  ```

### `src/input/KeyboardPlayerInput.ts` *(new)*
- Implements `PlayerInput`
- Constructor accepts a fixed arrow-key mapping (always arrows — keyboard is P1 only)
- Registers its own `keydown`/`keyup` listeners on construction; `destroy()` removes them
- Moves walkability check (`tileValue > 2`) inside `update(actor)` rather than coupling to `gameState`
- Preserves 8-frame buffer behavior

### `src/input/TouchPlayerInput.ts` *(new)*
- Implements `PlayerInput` — wraps the existing swipe detection from `setupTouchControls()`
- Touch is P1 only; swipe fires into P1's buffer
- `destroy()` removes touch listeners

### `src/input/GamepadPlayerInput.ts` *(new)*
- Implements `PlayerInput`
- Constructor accepts a gamepad index (0–3)
- Each frame polls `navigator.getGamepads()[index]`
- Maps standard gamepad D-pad (buttons 12–15) and left analog stick (axes 0/1, deadzone 0.3) to direction flags
- Mirrors 8-frame buffer behavior of keyboard input
- Static helpers:
  - `GamepadPlayerInput.connectedIndices(): number[]` — returns indices of currently connected gamepads
  - Listens to `gamepadconnected` / `gamepaddisconnected` window events; exposes a callback for the player select UI to react

### `src/input/CompositePlayerInput.ts` *(new)*
- Implements `PlayerInput` — wraps multiple `PlayerInput` instances and merges their state
- Used for P1, which simultaneously accepts keyboard, touch, and gamepad[0]
- `update(actor)` calls each sub-input's `update`, then ORs all pressed flags and uses the most recent buffered direction

### `src/Game.ts`
- Remove global `Input` import and `keydown`/`keyup` registration on window
- P1 gets `new CompositePlayerInput([keyboard, touch, gamepad0])`
- P2–P4 each get `new GamepadPlayerInput(1/2/3)`; only created if that gamepad index is connected
- Game loop: `for (const p of gameState.players) p.input.update(p.actor)` replaces `Input.update()`
- `destroy()` called on each input instance when returning to menu

### Functional after this phase
Single-player game works identically. Input is now routed through the new classes but P1 still responds to arrow keys and touch exactly as before. Controller support is live — plugging in a gamepad lets it drive P1 alongside the keyboard.

---

## Phase 2 — State Restructuring

**Goal:** Group all Pac-Man–specific state into a `PlayerState` object; move `lives` out of `Stats` into a shared pool on `gameState`; parameterize movement. All existing single-player behaviour is preserved — there is now just one player in a `players[]` array instead of a flat `gameState.pacman`.

### `src/types.ts`
Add:
```ts
export interface PlayerState {
  id: number               // 1–4
  actor: IGameObject
  input: PlayerInput
  frozen: boolean          // replaces gameState.pacmanFrozen (per-player ghost-eat freeze)
  dying: boolean           // replaces gameState.pacmanDying
  deathProgress: number    // replaces gameState.pacmanDeathProgress
  active: boolean          // false while sitting out mid-level
}
```

### `src/game-state.ts`
- Add `players: PlayerState[]`
- Add `sharedLives: number` — replaces `Stats.lives`
- Remove: `pacman`, `pacmanFrozen`, `pacmanDying`, `pacmanDeathProgress`
- Keep all ghost state, maze state, scatter/chase, frightened, elroy, and fruit as **shared**
- `frozen` flag remains global (level clear, ready screen)

### `src/static/Stats.ts`
- Remove `lives` static property — all references updated to `gameState.sharedLives`
- Keep `currentScore` as-is (single shared value, no change needed)
- Rename `extraLifeAwarded` → `extraLifeAwardedThisGame` for clarity; still adds 1 to `gameState.sharedLives` when score crosses 10,000, once per game

### `src/static/Move.ts`
- `Move.pacman()` → `Move.pacman(player: PlayerState)`
- Replace `gameState.pacman` → `player.actor`
- Replace `gameState.pacmanFrozen` → `player.frozen`
- `gameState.frozen` check remains (global freeze still applies)

### `src/Game.ts`
- `gameState.players = [singlePlayer]` at startup — all existing loops now iterate one element
- Game loop: `for (const p of gameState.players) { if (p.active && !p.dying) Move.pacman(p) }`
- All `Stats.lives` references updated to `gameState.sharedLives`

### Functional after this phase
Single-player game works identically to before. `players[]` has one entry. No behaviour change visible to the player.

---

## Phase 3 — Game Logic: Collision, Death & Dot Eating

**Goal:** Dot eating, collision, and death all operate on a specific player. The death model changes to support multiple players sitting out mid-level.

### `src/Game.ts` — `pacmanOnTileChanged`
Convert from free function to factory:
```ts
function makePacmanOnTileChanged(player: PlayerState) {
  return (x: number, y: number) => {
    // dot eating: player.stats.addToScore(10), player.actor.moveSpeed = 0
    // energizer: activateFrightened() is global — all ghosts turn blue regardless of which player ate it
    // dot counters: incrementDotCounters() still shared (fruit/house release is global)
    // level clear check: countRemainingDots() still shared maze
  }
}
```

### `src/Game.ts` — `checkCollisions()`
```ts
function checkCollisions(): void {
  for (const player of gameState.players) {
    if (!player.active || player.dying || player.frozen) continue
    const px = player.actor.roundedX()
    const py = player.actor.roundedY()
    for (const ghost of gameState.ghosts) {
      if (ghost.roundedX() !== px || ghost.roundedY() !== py) continue
      if (ghost.ghostMode === 'frightened') {
        eatGhost(ghost, player)  // score attributed to the player who ate it
      } else if (ghost.ghostMode !== 'eyes' && ghost.ghostMode !== 'house' && ghost.ghostMode !== 'exiting') {
        loseLife(player)
        return
      }
    }
  }
}
```

### `src/Game.ts` — `eatGhost(ghost, player)`
- `ghostEatenChain` stays on `gameState` — **shared**, escalates across all players globally
- `Stats.addToScore(score)` — goes to the shared score (no per-player attribution needed)
- `player.frozen = true` for 0.5s — only freezes that player; other players and ghosts keep moving

### `src/Game.ts` — `loseLife(player)`
- Sets `player.dying = true`, `player.deathProgress = 0`
- **No global `gameState.frozen`** — other players and all ghosts continue unaffected
- After death animation completes: `player.dying = false`, `player.active = false` — player sits out
- Check if any players are still active:
  - **Yes** — game continues; dead player sits out until next level start
  - **No (all players inactive):**
    - If `gameState.sharedLives > 0`: `sharedLives--`, reset all player positions, READY! sequence, resume — same level
    - If `gameState.sharedLives === 0`: `triggerGameOver()`

This means in **single-player**, dying behaves as before: death anim → READY! → same level (costs a life). In **multiplayer**, a player sits out while others continue; the lives pool is only consumed when everyone is down simultaneously.

### `src/Game.ts` — `levelClear()`
- `p.active = true`, `p.dying = false` for **all** players — level clear revives everyone regardless of lives pool
- Shared lives pool **not reset** on level clear — it carries over; it only resets to 3 at game start
- All player positions reset to start tile
- READY! sequence plays as normal

### `src/Game.ts` — `checkFruitCollision()`
- Loop over all active players; first player to collide eats the fruit (removed on first hit)

### `src/Game.ts` — `updateAmbientSiren()`
- Stop siren only on global `gameState.frozen` or `gameState.gameOver` — individual player deaths no longer set `gameState.frozen`, so siren keeps playing through them
- Individual `player.frozen` (ghost-eat pause) does not stop the siren
- Priority unchanged: `eyes` > `blue` > `normal`

### Functional after this phase
Single-player game works as before — die, READY!, same level, 3 lives. The only visible change is ghosts no longer freeze during the death animation (they keep moving while the anim plays).

---

## Phase 4 — Ghost AI Multi-Target

**Goal:** Ghost targeting picks the nearest active player rather than a hardcoded single Pacman. In single-player there is only one player so behaviour is identical to before.

### `src/static/AI.ts` — `ghostTileCenter(ghost)`
Add helper:
```ts
static nearestPlayer(ghost: IGameObject): IGameObject | null {
  let nearest: IGameObject | null = null
  let minDist = Infinity
  for (const player of gameState.players) {
    if (!player.active || player.dying) continue
    const d = getDistance(ghost.roundedX(), ghost.roundedY(), player.actor.roundedX(), player.actor.roundedY())
    if (d < minDist) { minDist = d; nearest = player.actor }
  }
  return nearest
}
```

All chase-mode targeting resolves the Pacman reference through `nearestPlayer()`:
- **Blinky:** `target = nearestPlayer(blinky).tile`
- **Pinky:** `tilesAheadOf(nearestPlayer(pinky), 4)`
- **Inky:** finds `nearestPlayer(inky)`, uses that actor for **both** the intermediate point (2 ahead) and the Blinky-vector calculation — pincer behaviour preserved against whoever Inky is closest to
- **Clyde:** proximity logic against `nearestPlayer(clyde)`
- Elroy scatter override: `nearestPlayer(blinky).tile`

### `src/static/AI.ts` — `tilesAheadOfPacman(n)` → `tilesAheadOf(actor, n)`
- Accept any `IGameObject` instead of always reading `gameState.pacman`
- Same upward overflow bug preserved

### Functional after this phase
Single-player game works identically — `nearestPlayer()` with one active player always returns that player. No visible change.

---

## Phase 5 — Rendering Updates

**Goal:** Canvas correctly renders up to 4 Pacmen and their props. HUD reads from the shared lives pool.

### `src/static/Draw.ts` — `Draw.pacman(obj, player)`
- Draw function closes over player: `(obj) => Draw.pacman(obj, player)`
- All players are **yellow** — differentiated by props, not color
- After drawing the base Pac-Man circle, call `Draw.pacmanProp(obj, player.id)`
- Death anim reads `player.deathProgress` instead of `gameState.pacmanDeathProgress`
- Each player's death anim plays independently; props render during Phase 1 (mouth-opening) then vanish with the confetti burst — no special handling needed

### `src/static/Draw.ts` — `Draw.pacmanProp(obj, id)`
Props are drawn relative to the actor's pixel position and current `moveDir`.

**P1 — no prop** (standard Pac-Man)

**P2 — Backpack Man**
- A brown (`#8B5E3C`) rounded rectangle on the **back** of Pac-Man (opposite to `moveDir`)
- Size: ~`unit * 0.45` wide × `unit * 0.55` tall
- Positioned just outside the circle edge in the reverse direction
- Slightly rounded corners (`ctx.roundRect` or manual arc)

**P3 — Miss Pac-Man**
- A purple (`#b44fff`) bow always at **12 o'clock** (top of head), independent of `moveDir`
- Two small filled triangles/ellipses mirrored horizontally with a small circle in the center
- Bow sits just above the circle's top edge
- Purple chosen to avoid: red (Blinky), hotpink (Pinky), cyan (Inky), orange (Clyde), blue (frightened)

**P4 — Tic Tac Man**
- A white (`#f0f0f0`) pill/oval on the **back** of Pac-Man (same positioning logic as backpack)
- Oriented with its long axis perpendicular to the movement direction (stands upright relative to travel)
- Faint grey (`#aaaaaa`) 1px stroke so it reads against the black background
- Size: ~`unit * 0.25` wide × `unit * 0.45` tall

### `src/static/Draw.ts` — `Draw.ghost(obj)`
- Remove the `gameState.pacmanDying` visibility check entirely — ghosts are **always visible** during individual player deaths since the game keeps running
- Ghosts are only hidden if a global freeze is active (level clear flash, game over)

### `src/static/Draw.ts` — `Draw.hud(players, sharedLives)`
- Single shared lives row bottom-left (Pacman icons representing pool)
- Score layout adapts to player count (see Phase 3)
- Eliminated players: score shown dimmed, no icon in lives row

### `src/Game.ts` — game loop death progress
```ts
for (const p of gameState.players) {
  if (p.dying) {
    p.deathProgress = Math.min(p.deathProgress + Time.deltaTime / DEATH_ANIM_DURATION, 1.0)
  }
}
```

### `src/Game.ts` — `gameState.gameObjects`
- Contains all 4 ghost actors + all active player actors
- Order: player actors first (drawn under ghosts), then ghosts

### Functional after this phase
Single-player game works as before with P1's standard no-prop appearance. Props are ready for use when additional players are added in Phase 7.

---

## Phase 6 — Player Selection Menu

**Goal:** Screen between the start screen and gameplay showing player slots and connected controllers.

### Input assignment (fixed, not user-configurable)
- **P1** always exists: keyboard (arrows) + touch swipes + gamepad[0] if connected
- **P2** exists if gamepad[1] is connected
- **P3** exists if gamepad[2] is connected
- **P4** exists if gamepad[3] is connected
- Player count is derived from connected controllers; no manual join needed

### `src/Game.ts` — new `playerSelectLoop()` state
New game phase after tapping start:

**Layout (up to 4 slot cards, grayed out if no controller for that slot):**
```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│    P1    │ │    P2    │ │    P3    │ │    P4    │
│    ●     │ │    ●     │ │    —     │ │    —     │
│KEYS+PAD 1│ │  PAD 2   │ │ NO PAD   │ │ NO PAD   │
│  READY   │ │  READY   │ │          │ │          │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
              PRESS START / TAP TO PLAY
```

- P1 slot always active; shows `KEYBOARD` if no gamepad[0], `KEYS + PAD 1` if gamepad[0] connected
- P2–P4 slots show `PAD N` if connected, greyed-out `NO PAD` if not
- Controllers can be plugged in/out on this screen; slots update live via `gamepadconnected` / `gamepaddisconnected`
- Minimum 1 player (P1 always present); tap/press start with however many controllers are connected

### `src/static/Draw.ts` — `Draw.playerSelectScreen(slots)`
- New static method rendering slot cards
- Slot data type:
  ```ts
  interface PlayerSlot { id: number; active: boolean; inputLabel: string; color: string }
  ```

### Functional after this phase
Player count is determined before the game starts. 1P still works exactly as before (P1 only, no controllers needed). Plugging in 1–3 extra controllers enables 2P–4P.

---

## Phase 7 — Player Factory & Initialization

**Goal:** `initializeLevel()` and `start()` construct the correct number of player actors from the confirmed slots. All players spawn, move, eat, and die correctly.

### `src/Game.ts` — player factory
```ts
function createPlayer(id: number, startTile: { x: number; y: number }, input: PlayerInput): PlayerState {
  let playerState: PlayerState  // ref needed in closures below
  const actor = new GameObject(
    'yellow',
    startTile.x, startTile.y,
    0.667,
    () => Move.pacman(playerState),
    (obj) => Draw.pacman(obj, playerState),
    (x, y) => makePacmanOnTileChanged(playerState)(x, y),
    (_x, _y) => {},
  )
  playerState = { id, actor, input, frozen: false, dying: false, deathProgress: 0, active: true }
  return playerState
}
```

### Starting positions
All players start at the same tile `(13.5, 26)` — they pass through each other freely (no player-player collision). This is the simplest approach and matches the arcade feel.

### `src/Game.ts` — `initializeLevel()` and `start()`
- `start(slots)` receives confirmed slots from the player select screen
- `gameState.players = slots.map(s => createPlayer(s.id, START.pacman, s.input))`
- `gameState.sharedLives = 3`
- `gameState.gameObjects = [...gameState.players.map(p => p.actor), ...gameState.ghosts]`

### `src/object/GameObject.ts`
No structural changes required.

### Functional after this phase
Full multiplayer is now live — 1 to 4 players can play simultaneously, each controlled independently, sharing a life pool, sitting out on death and reviving on level clear. The only missing piece is the player select screen (Phase 6) wiring into `start()`, and the game over/menu flow (Phase 8).

---

## Phase 8 — Menu Flow & Game Over

**Goal:** Complete end-to-end flow: start screen → player select → gameplay → game over → start screen.

### Flow
```
startScreenLoop()
  └─ tap/click
       └─ playerSelectLoop()
            └─ start pressed (≥1 player present)
                 └─ start(slots)
                      └─ update() [game loop]
                           └─ all players inactive + sharedLives === 0
                                └─ triggerGameOver()
                                     └─ Draw.gameOverScreen()
                                          └─ initials entry if score qualifies
                                               └─ returningToMenu = true
                                                    └─ startScreenLoop()
```

### `src/Game.ts` — game over trigger
- After any death completes, if `gameState.players.every(p => !p.active) && gameState.sharedLives === 0`: `triggerGameOver()`
- Game continues as long as at least one player is active or lives remain for a reset

### `src/static/Draw.ts` — `Draw.gameOverScreen()`
- Unchanged from single-player: dark overlay, red `GAME OVER`, shared final score

### `src/Game.ts` — initials entry
- Unchanged from single-player: one prompt, one set of initials, `Stats.saveScore(initials, Stats.currentScore)`
- After entry (or skip if score doesn't qualify): `returningToMenu = true`

### `src/Game.ts` — wiring
- `gameStarted` flag set after player select, not immediately on first tap
- `start(slots)` constructs players from confirmed slots, initialises level, starts update loop
- `returningToMenu` path unchanged — cleans up inputs, stops siren, returns to `startScreenLoop()`

### Functional after this phase
Complete multiplayer game. Start screen → player select → 1–4P game → game over → back to start. All phases integrated.
