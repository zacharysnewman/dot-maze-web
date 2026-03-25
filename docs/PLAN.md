# Implementation Plan

Each phase ends with the game in a **fully playable state** — just with fewer features than the previous phase had. Phases build on each other without breaking what exists.

Spec references point to the chapter docs rather than repeating their content.

---

## Current State

- Pac-Man moves, eats dots, score tracked
- Blinky chases using a basic distance heuristic
- Pinky / Inky / Clyde are stationary (empty move stubs)
- No collision, no lives lost, no game over, no HUD
- No mode switching, no frightened mode, no ghost release

---

## Phase 1 — Playable Game Loop

**Goal:** A complete, winnable/loseable game. Simple AI, no authentic ghost personalities yet — but every core loop works.

### Tasks

1. **All 4 ghosts move** — give Pinky, Inky, and Clyde the same basic distance-to-Pac-Man chase logic Blinky already has. They'll get their real personalities in Phase 5.
2. **Collision detection** — if Pac-Man and any ghost occupy the same tile, a life is lost.
3. **Death sequence** — on life lost: freeze briefly, reset Pac-Man and all ghosts to starting positions, resume.
4. **Game over** — when lives reach 0, stop the game and show a game over state.
5. **Level clear** — when all dots are eaten, advance to the next level (reset map and positions, increment level counter).
6. **HUD** — render current score, high score, lives remaining, and level number on screen.

### Spec References
- Collision tile-sharing rule and pass-through edge case → [10-maze-logic.md](./10-maze-logic.md)
- Starting positions for all actors → [08-ghost-house.md](./08-ghost-house.md)
- Dot counts and scoring → [01-basics.md](./01-basics.md)

### Functional After This Phase
A complete game of Pac-Man. Ghosts are unsophisticated but dangerous. You can win, lose, and advance levels.

---

## Phase 2 — Scatter / Chase Mode Switching

**Goal:** Ghosts alternate between chasing and retreating to corners on the correct timer schedule.

### Tasks

1. **Activate the mode timer** — `AI.modePatterns` is already correct; wire it up to a running timer that advances through the sequence per level group.
2. **Scatter targeting** — when in scatter mode, each ghost targets its fixed corner tile instead of Pac-Man.
3. **Forced direction reversal** — when the mode changes (chase↔scatter), force all ghosts to reverse. Does not apply on exit from frightened.
4. **Ghosts start in scatter** — at level start and after a death, ghosts should begin in scatter mode phase 1.
5. **Timer reset** — reset the scatter/chase timer on life lost and on level complete.

### Spec References
- Full timing table and level groups → [04-scatter-chase-timing.md](./04-scatter-chase-timing.md)
- Which transitions trigger reversals → [03-direction-reversal.md](./03-direction-reversal.md)
- Scatter corner target tiles (exact coords) → [02-ghost-modes.md](./02-ghost-modes.md) and [11-ghost-ai.md](./11-ghost-ai.md)
- Pathfinding to a target tile → [10-maze-logic.md](./10-maze-logic.md)

### Functional After This Phase
Ghosts retreat to corners periodically. The brief scatter window gives players a moment to collect dots safely — matches original arcade pacing.

---

## Phase 3 — Ghost House & Release

**Goal:** Ghosts emerge from the house on the correct schedule instead of being free from frame 1.

### Tasks

1. **Lock ghosts in house** — Pinky, Inky, and Clyde start inside and cannot exit until released. Blinky starts outside as always.
2. **In-house animation** — ghosts bounce up and down while waiting inside.
3. **Personal dot counters** — implement the per-ghost dot limits (Pinky=0, Inky=30 on L1, Clyde=60 on L1, etc.) that release each ghost in order.
4. **Global dot counter** — after a life is lost, disable personal counters and use the global counter (Pinky@7, Inky@17, Clyde@32).
5. **Idle timer** — if Pac-Man stops eating dots long enough (4 s on L1–4, 3 s on L5+), force-release the next ghost.
6. **Exit direction** — ghosts normally turn left on exit; if mode changed while they were inside, they turn right.

### Spec References
- Full release rules, dot limits by level, global counter, idle timer, exit direction → [08-ghost-house.md](./08-ghost-house.md)
- Level-grouped dot limits table → [A1-appendix-tables.md](./A1-appendix-tables.md) (Table 5)

### Functional After This Phase
Early levels feel easy — only Blinky threatens at first. Difficulty ramps naturally as ghosts emerge one by one. Matches original level-1 pacing exactly.

---

## Phase 4 — Frightened Mode

**Goal:** Eating an energizer makes ghosts vulnerable. Pac-Man can eat them for bonus points.

### Tasks

1. **Activate frightened state** — when Pac-Man eats an energizer, all ghosts enter frightened mode and reverse direction.
2. **Frightened visuals** — ghosts turn dark blue; flash white for the final 14 game cycles before returning to normal.
3. **Frightened movement** — ghosts use pseudo-random direction selection at intersections (no target tile). Red-zone upward restrictions are lifted.
4. **Frightened speed** — apply the reduced frightened speed from the speed table.
5. **Ghost eating** — if Pac-Man occupies the same tile as a frightened ghost: award score (200→400→800→1600 chain), show score briefly at capture location, freeze Pac-Man momentarily, send ghost eyes home.
6. **Ghost eyes return** — disembodied eyes navigate to the ghost house return tile at high speed, revive, and exit.
7. **Per-level duration** — use the frightened time and flash count table. At levels where duration is 0, ghosts still reverse but don't turn blue.
8. **Pause scatter/chase timer** — timer is paused while any ghost is frightened; resumes on return.

### Spec References
- Duration/flash table by level → [05-frightened-behavior.md](./05-frightened-behavior.md) and [A1-appendix-tables.md](./A1-appendix-tables.md) (Table 2)
- PRNG wandering, red-zone exception → [05-frightened-behavior.md](./05-frightened-behavior.md)
- Score chain → [01-basics.md](./01-basics.md)
- Scatter/chase timer pause rule → [04-scatter-chase-timing.md](./04-scatter-chase-timing.md)
- Ghost house return target tile → [08-ghost-house.md](./08-ghost-house.md)

### Functional After This Phase
Energizers are now a real strategic tool. The risk/reward of chasing frightened ghosts is present. The game plays like a recognisable version of Pac-Man.

---

## Phase 5 — Authentic Ghost AI

**Goal:** Each ghost gets its real targeting algorithm, giving them distinct personalities.

### Tasks

1. **Blinky** — already correct (targets Pac-Man's current tile). No changes needed.
2. **Pinky** — target 4 tiles ahead of Pac-Man in his movement direction. Reproduce the upward overflow bug (facing up → offset is 4 up **and** 4 left).
3. **Inky** — compute the intermediate tile (2 ahead of Pac-Man, same up-bug), draw the vector from Blinky's tile, double it.
4. **Clyde** — if Euclidean distance to Pac-Man ≥ 8 tiles: target Pac-Man. If < 8 tiles: target scatter corner (0, 34).

### Spec References
- Full algorithm for each ghost, up-bug details, worked examples → [11-ghost-ai.md](./11-ghost-ai.md)
- Pathfinding algorithm (Euclidean distance, tie-break priority) → [10-maze-logic.md](./10-maze-logic.md)

### Functional After This Phase
Ghosts have their authentic personalities. Blinky pursues directly, Pinky ambushes ahead, Inky is erratic, Clyde shies away. The game now matches the feel of the original arcade.

---

## Phase 6 — Speed System

**Goal:** All actors move at correct speeds for the current level and state.

### Tasks

1. **Speed lookup** — replace the hardcoded `moveSpeed = 1.0` with a lookup into the speed table (indexed by level and actor state: normal / frightened / tunnel).
2. **Pac-Man level speeds** — 80% on L1, 90% on L2–4, 100% on L5–20, 90% on L21+.
3. **Ghost level speeds** — 75% on L1, 85% on L2–4, 95% on L5+.
4. **Ghost tunnel teleport** — extend the existing Pac-Man tunnel teleport logic to ghosts.
5. **Ghost tunnel speed penalty** — detect when a ghost is inside the tunnel zone and apply the reduced tunnel speed.
6. **Pac-Man frightened speed boost** — Pac-Man also speeds up (90%→95%→100%) on levels 1–4 when ghosts are frightened.

### Spec References
- Full speed table, dot-eating pauses (already implemented), tunnel columns → [06-speed.md](./06-speed.md)
- Tunnel zones (pink zones) → [09-maze-zones.md](./09-maze-zones.md)
- Complete numeric table → [A1-appendix-tables.md](./A1-appendix-tables.md) (Tables 1)

### Functional After This Phase
Each level feels progressively harder as speeds tighten. The tunnel becomes a genuine escape route since Pac-Man passes through at full speed while ghosts slow down.

---

## Phase 7 — Level Progression & Fruit

**Goal:** Difficulty scales correctly across levels; bonus fruit appears and scores.

### Tasks

1. **Per-level frightened duration** — pass the current level into the frightened timer so duration and flash count come from the table rather than a constant.
2. **Fruit spawning** — spawn the correct fruit sprite below the ghost house after 70 dots eaten; spawn again after 170 dots. Remove after 9–10 seconds if not eaten.
3. **Fruit scoring** — award the correct points for the current level when Pac-Man eats the fruit.
4. **Extra life** — award one extra life when score first crosses 10,000.
5. **Fruit / level counter display** — show the last 7 fruit symbols along the bottom of the screen.

### Spec References
- Fruit type and points by level, appearance triggers, visibility duration → [01-basics.md](./01-basics.md) and [A1-appendix-tables.md](./A1-appendix-tables.md) (Tables 6, 7)
- Frightened duration by level → [A1-appendix-tables.md](./A1-appendix-tables.md) (Table 2)

### Functional After This Phase
The game has a complete difficulty curve. Fruit rewards attentive players. Higher levels feel distinctly harder — shorter frightened windows, faster ghosts.

---

## Phase 8 — Cruise Elroy

**Goal:** Blinky speeds up and keeps chasing during scatter when few dots remain.

### Tasks

1. **Track remaining dots** — maintain a live count of uneaten dots.
2. **Elroy 1 trigger** — when dot count ≤ Elroy-1 threshold for the current level, increase Blinky's speed and override his scatter target to keep chasing Pac-Man.
3. **Elroy 2 trigger** — when dot count ≤ Elroy-2 threshold (half of Elroy-1), increase Blinky's speed again.
4. **Elroy suspended on death** — disable Elroy until Clyde begins moving toward the ghost house exit.
5. **Elroy resumes** — once Clyde starts his exit movement, restore Elroy based on the current dot count.

### Spec References
- Elroy thresholds and speeds by level, suspension/resume rules → [06-speed.md](./06-speed.md) and [A1-appendix-tables.md](./A1-appendix-tables.md) (Table 4)

### Functional After This Phase
Late-level endgame pressure is authentic. Players can no longer coast on the last few dots — Blinky accelerates and refuses to scatter, matching the original arcade tension.

---

## Phase 9 — Cornering & Input Polish

**Goal:** Pac-Man navigates turns with the pre-turn/post-turn window of the original arcade.

### Tasks

1. **Input buffering** — queue the next desired direction so a turn executes as soon as it becomes legal rather than being dropped if the wall check fails at the exact moment of input.
2. **Pre-turn window** — allow Pac-Man to begin turning up to 3–4 pixels before reaching the tile center.
3. **Post-turn window** — allow Pac-Man to complete a turn up to 3–4 pixels after passing the tile center.
4. **Red zone upward restriction** — at the four ghost-house-adjacent intersections, disallow upward turns for ghosts in chase/scatter mode.

### Spec References
- Pre/post-turn pixel counts by approach direction, diagonal speed during corner → [07-cornering.md](./07-cornering.md)
- Red zone locations and rules → [09-maze-zones.md](./09-maze-zones.md)

### Functional After This Phase
Pac-Man feels responsive and snappy at corners. Skilled players can corner properly. Ghost red-zone behaviour matches the original.

---

## Phase 10 — Polish & Edge Cases

**Goal:** Remaining authenticity details and presentation quality.

### Tasks

1. **Ghost eye direction** — pupils point in the ghost's current movement direction.
2. **Pass-through collision edge case** — (optional/low priority) two actors swapping tiles in the same frame do not register as a collision.
3. **Sound effects** — dot eating, energizer, ghost eaten, death, level clear.
4. **Ready! / Game Over text** — brief pause with "READY!" at level start; "GAME OVER" on last life lost.
5. **Stuck-ghost exploit** (optional) — faithfully reproduce the global-counter flaw allowing Pinky/Inky/Clyde to be kept inside indefinitely.

### Spec References
- Pass-through bug explanation → [10-maze-logic.md](./10-maze-logic.md)
- Stuck-ghost exploit mechanics → [08-ghost-house.md](./08-ghost-house.md)

### Functional After This Phase
The game is a complete, authentic reproduction of the original arcade Pac-Man.

---

## Phase Summary

| Phase | Key Deliverable | Game State After |
|---|---|---|
| 1 | All ghosts move, collision, HUD, game loop | Complete playable game — simple AI |
| 2 | Scatter/chase mode switching | Ghosts retreat and return on timer |
| 3 | Ghost house lock + release system | Authentic ghost emergence timing |
| 4 | Frightened mode + ghost eating | Energizers are strategically useful |
| 5 | Authentic per-ghost AI | Distinct ghost personalities |
| 6 | Level-based speed system | Difficulty scales with speed |
| 7 | Level progression + fruit | Full difficulty curve and rewards |
| 8 | Cruise Elroy | Late-level endgame pressure |
| 9 | Cornering + red zones | Authentic Pac-Man feel at turns |
| 10 | Polish and edge cases | Complete arcade reproduction |
