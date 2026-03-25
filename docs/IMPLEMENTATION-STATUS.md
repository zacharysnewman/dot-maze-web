# Implementation Status

Consolidated view of what is and is not yet implemented in `Pacman.js`, measured against the original arcade specification documented in *The Pac-Man Dossier* by Jamey Pittman.

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Fully implemented and correct |
| ⚠️ | Partially implemented or approximated |
| ❌ | Not implemented |

---

## Core Engine

| Feature | Status | Notes / File |
|---|---|---|
| 60 FPS game loop (requestAnimationFrame) | ✅ | `Game.ts` |
| Canvas 28×36 tile grid (20 px tiles, 560×720) | ✅ | `constants.ts` |
| Delta-time scaled movement | ✅ | `Time.scaledDeltaTime` |
| Tile occupancy tracking (center point) | ✅ | `GameObject.roundedX/Y()` |
| `onTileChanged` callback | ✅ | `GameObject.checkTileUpdates()` |
| `onTileCentered` callback | ✅ | 0.1-tile threshold in `GameObject` |
| Keyboard input (arrow keys) | ✅ | `Input.ts` |
| Touch / swipe input | ✅ | `Game.ts` — min 40 px swipe, 8-frame turn buffer |
| Responsive canvas scaling | ✅ | `resizeCanvas()` in `Game.ts` |
| Timer system | ✅ | `Time.addTimer()` / `Timer.ts` |

---

## Pac-Man

| Feature | Status | Notes / File |
|---|---|---|
| Pac-Man movement | ✅ | `Move.pacman()` |
| Perpendicular axis alignment (lerp) | ✅ | Lerp factor 0.1 toward tile center |
| Tunnel teleport (left ↔ right) | ✅ | `Move.moveObject()` wraps on `undefined` tile |
| Dot collection (10 pts, 1-frame pause) | ✅ | `pacmanOnTileChanged()` — `0.01666s` timer ≈ 1 frame |
| Energizer collection (50 pts, 3-frame pause) | ✅ | `pacmanOnTileChanged()` — `0.05s` timer ≈ 3 frames |
| Score tracking | ✅ | `Stats.addToScore()` |
| Pac-Man animation (mouth open/close) | ✅ | `Draw.pacman()` — 8 frames at 30 fps |
| Direction facing in animation | ✅ | `dirMultiplier` rotates arc |
| Level-based speed (80% / 90% / 100%) | ❌ | `moveSpeed` hardcoded to `1.0` |
| Frightened speed boost | ❌ | |
| Cornering (pre-turn / post-turn) | ❌ | Direction only changes when tile ahead is clear |
| Input buffering for turns | ⚠️ | Touch: 8-frame retry buffer (`Input.BUFFER_FRAMES`); keyboard: held key retries every frame; no pre/post-turn pixel window yet |

---

## Ghosts — Shared

| Feature | Status | Notes / File |
|---|---|---|
| 4 ghosts rendered (correct colors) | ✅ | Red, hotpink, cyan, orange |
| Starting positions | ✅ | Blinky(13.5,14) Pinky(13.5,17) Inky(12,17) Clyde(15,17) |
| Ghost body rendering | ✅ | `Draw.drawGhostBody()` |
| Ghost eye rendering (static) | ✅ | `Draw.drawGhostEyes()` — pupils don't track direction |
| Ghost movement (Blinky) | ✅ | `Move.blinky()` + `AI.ghostTileCenter()` |
| Ghost movement (Pinky / Inky / Clyde) | ✅ | `Move.pinky/inky/sue()` — all use same chase-Pac-Man logic for now; authentic personalities in Phase 5 |
| No-reverse rule | ✅ | Opposite direction excluded in `AI.ghostTileCenter()` |
| Up/Left/Down/Right tie-break priority | ✅ | Push order in `AI.ghostTileCenter()` matches spec |
| Level-based ghost speed | ❌ | Fixed speed for all ghosts |
| Tunnel teleport for ghosts | ❌ | Only Pac-Man wraps |
| Tunnel speed penalty | ❌ | No zone detection |
| Red zone upward restriction | ❌ | No intersection-specific rules |
| Ghost eye direction tracking movement | ❌ | Pupils are static |
| Frightened appearance (blue body) | ✅ | `Draw.ghost()` — dark blue `#0000cc` in frightened mode |
| Frightened flash warning | ✅ | `Draw.ghost()` — alternates blue/white every 7 frames in flash window |
| Ghost collision with Pac-Man → life lost | ✅ | `checkCollisions()` in `Game.ts` — skips frightened and eyes ghosts |

---

## Ghost AI — Modes

| Feature | Status | Notes / File |
|---|---|---|
| Scatter/chase timing constants | ✅ | `AI.modePatterns` matches spec exactly |
| Mode switching timer | ✅ | `updateScatterChaseMode()` in `Game.ts` — advances per `deltaTime` |
| Scatter mode (corner targeting) | ✅ | `AI.ghostTileCenter()` — uses `SCATTER_TARGETS` per color |
| Forced reversal on mode change | ✅ | Immediate direction flip on scatter↔chase transition |
| Scatter/chase timer pause in frightened | ✅ | Timer skips when any ghost has `ghostMode === 'frightened'` |
| Timer reset on life lost / level complete | ✅ | `resetScatterChaseTimer()` called from `resetPositions()` |
| Ghosts start in scatter on level begin | ✅ | `initializeLevel()` sets `ghost.ghostMode = 'scatter'` |

---

## Ghost AI — Individual Targeting

| Ghost | Chase Target | Status | Notes |
|---|---|---|---|
| Blinky | Pac-Man's current tile | ✅ | `AI.ghostTileCenter()` uses `pacman.roundedX/Y()` |
| Pinky | 4 tiles ahead of Pac-Man (with up-bug) | ⚠️ | Currently uses same logic as Blinky; authentic algorithm in Phase 5 |
| Inky | Doubled vector from Blinky to 2-ahead of Pac-Man (with up-bug) | ⚠️ | Currently uses same logic as Blinky; authentic algorithm in Phase 5 |
| Clyde | Pac-Man if ≥8 tiles away, else scatter corner | ⚠️ | Currently uses same logic as Blinky; authentic algorithm in Phase 5 |
| All — Scatter | Fixed corner target tile | ✅ | `SCATTER_TARGETS` in `AI.ts` — Blinky(26,0) Pinky(2,0) Inky(27,34) Clyde(0,34) |
| All — Frightened | PRNG random wandering | ✅ | `AI.ghostFrightenedMove()` — LCG PRNG, clockwise fallback |
| All — Eyes | Fixed ghost house return tile | ✅ | Targets (13,14); revival on arrival |
| Pinky/Inky upward overflow bug | ❌ | Should reproduce authentic ROM behavior |

---

## Ghost House & Release

| Feature | Status | Notes / File |
|---|---|---|
| Ghost house rendered (pink door) | ✅ | `Draw.cageGate()` |
| Ghosts locked inside house at start | ❌ | Ghosts move freely from frame 1 |
| Personal dot counter system | ❌ | |
| L1: Inky limit 30, Clyde limit 60 | ❌ | |
| L2: Clyde limit 50 | ❌ | |
| L3+: all exit immediately | ❌ | |
| Global dot counter after life lost | ❌ | |
| Idle timer (4 s / 3 s) | ❌ | |
| In-house bouncing animation | ❌ | |
| Ghost exit direction (left vs right) | ❌ | |
| Ghost eyes returning home | ✅ | Eyes mode targets (13,14); `makeGhostTileCentered()` revives on arrival |
| Ghost revived in house | ⚠️ | Revived at (13,14) outside house (Phase 3 not yet implemented) |

---

## Cruise Elroy

| Feature | Status | Notes |
|---|---|---|
| Dot count tracking | ❌ | |
| Elroy 1 speed boost | ❌ | |
| Elroy 2 speed boost | ❌ | |
| Elroy scatter override (keep chasing) | ❌ | |
| Elroy suspended after Pac-Man death | ❌ | |
| Elroy resumes when Clyde exits | ❌ | |

---

## Frightened Mode

| Feature | Status | Notes |
|---|---|---|
| Ghost frightened state triggered by energizer | ✅ | `activateFrightened()` called from `pacmanOnTileChanged()` |
| Ghost blue visual | ✅ | `Draw.ghost()` — `#0000cc` when `ghostMode === 'frightened'` |
| Ghost flash warning | ✅ | Alternates blue/white every 7 frames in flash window before expiry |
| Frightened speed reduction | ✅ | `ghost.moveSpeed = 0.5` on entering frightened |
| PRNG random wandering | ✅ | `AI.ghostFrightenedMove()` — LCG seeded per level/life |
| PRNG reset on new level / life lost | ✅ | `AI.resetPrng()` called from `resetPositions()` |
| Ghost eating collision | ✅ | `checkCollisions()` calls `eatGhost()` for frightened ghosts |
| Score chain 200→400→800→1,600 | ✅ | `gameState.ghostEatenChain` tracks count per energizer |
| Pac-Man freeze on ghost eat | ✅ | `gameState.pacmanFrozen = true` for 1 s; `Move.pacman()` checks flag |
| Ghost eyes return home | ✅ | Eyes mode at 1.5× speed, targeting (13,14) |
| Per-level duration table | ✅ | `FRIGHTENED_DURATION` / `FRIGHTENED_FLASH_COUNT` in `Draw.ts` |
| Red zone ignored in frightened | ❌ | Red zones not implemented |

---

## Lives & Game Flow

| Feature | Status | Notes / File |
|---|---|---|
| Lives initialised to 3 | ✅ | `Stats.lives = 3` |
| Life lost on ghost collision | ✅ | `loseLife()` in `Game.ts` |
| Ghost/Pac-Man reset on death | ✅ | `resetPositions()` in `Game.ts` — 1 s freeze then resume |
| Scatter/chase timer reset on death | ✅ | `resetScatterChaseTimer()` inside `resetPositions()` |
| PRNG seed reset on death | ✅ | `AI.resetPrng()` inside `resetPositions()` |
| Game over on 0 lives | ✅ | `gameState.gameOver` halts updates; overlay rendered |
| Level clear on all dots eaten | ✅ | `levelClear()` in `Game.ts` — 1.5 s freeze then map reset |
| Level counter increment | ✅ | `gameState.level++` on level clear |
| Extra life at 10,000 pts | ❌ | |
| Pass-through collision edge case | ❌ | |

---

## HUD & Display

| Feature | Status | Notes |
|---|---|---|
| Score display | ✅ | `Draw.hud()` — top-left |
| High score display | ✅ | `Draw.hud()` — top-center |
| Lives display | ✅ | `Draw.hud()` — Pac-Man icons along bottom |
| Level number display | ✅ | `Draw.hud()` — top-right as `L{n}` |
| Fruit / level history display | ❌ | Last 7 fruit symbols not rendered |
| Fruit sprite on screen | ❌ | |
| Ghost score display on eat | ✅ | `Draw.scorePopups()` — cyan score shown at capture location for 1 s |
| Ready! text | ❌ | |
| Game Over text | ✅ | `Draw.gameOverScreen()` — red overlay text |

---

## Audio

| Feature | Status | Notes |
|---|---|---|
| Any sound | ❌ | No audio implementation exists |

---

## Summary

| Category | Implemented | Total | % Done |
|---|---|---|---|
| Core engine | 10 | 10 | 100% |
| Pac-Man | 9 | 12 | 75% |
| Ghosts (shared) | 10 | 16 | 63% |
| Ghost AI — modes | 7 | 7 | 100% |
| Ghost AI — targeting | 4 | 8 | 50% |
| Ghost house & release | 3 | 12 | 25% |
| Cruise Elroy | 0 | 6 | 0% |
| Frightened mode | 11 | 12 | 92% |
| Lives & game flow | 8 | 10 | 80% |
| HUD & display | 6 | 9 | 67% |
| Audio | 0 | 1 | 0% |
| **Overall** | **68** | **103** | **~66%** |

---

## Phase Completion

| Phase | Status | Completed |
|---|---|---|
| Phase 1 — Playable Game Loop | ✅ Complete | All ghosts move, collision, HUD, lives, level clear |
| Phase 2 — Scatter/Chase Mode Switching | ✅ Complete | Timer, corner targeting, reversal, reset |
| Phase 3 — Ghost House & Release | ❌ Not started | |
| Phase 4 — Frightened Mode | ✅ Complete | Energizer trigger, blue visuals, flash, PRNG, eating, eyes, score chain |
| Phase 5 — Authentic Ghost AI | ❌ Not started | |
| Phase 6 — Speed System | ❌ Not started | |
| Phase 7 — Level Progression & Fruit | ❌ Not started | |
| Phase 8 — Cruise Elroy | ❌ Not started | |
| Phase 9 — Cornering & Input Polish | ❌ Not started | |
| Phase 10 — Polish & Edge Cases | ❌ Not started | |
