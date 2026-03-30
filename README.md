# Pokmon Web

A web-based Pac-Man clone written in TypeScript. The maze, characters, and all visuals are drawn entirely with Canvas 2D stroke/fill calls — no sprites or images. Gameplay faithfully reproduces the original arcade, including authentic ghost AI, speed tables, scatter/chase timing, the ghost house release system, Cruise Elroy, and frightened mode.

## Features

- Authentic single-player Pac-Man (based on *The Pac-Man Dossier* by Jamey Pittman)
- **1–4 player co-op** — shared life pool, simultaneous play, players sit out on death and revive on level clear
- Keyboard, touch/swipe, and gamepad input — P1 accepts all three simultaneously
- All graphics procedurally drawn on canvas (no image assets)
- Web Audio API sound effects

## Controls

| Input | Action |
|---|---|
| Arrow keys | Move (P1) |
| Swipe | Move (P1, touch) |
| D-pad / left stick | Move (gamepad, P1–P4) |

## Dev Setup

```sh
npm install
npm run dev       # watch mode (esbuild)
npm run build     # type-check + production bundle
```

Open `index.html` in a browser after building. Append `?dev=true` to enable the debug panel.

## Project Structure

```
src/
  Game.ts            # main game loop, lifecycle, player select
  constants.ts       # tile grid, speeds, zone constants
  game-state.ts      # shared mutable game state
  types.ts           # shared interfaces
  input/             # PlayerInput, Keyboard, Touch, Gamepad, Composite
  object/            # GameObject base class
  static/            # Draw, Move, AI, Sound, Stats, Time
docs/                # Pac-Man Dossier reference chapters + implementation status
MAP-EDITOR.md        # planned level editor spec
```

## Documentation

- `docs/IMPLEMENTATION-STATUS.md` — feature-by-feature implementation checklist
- `docs/INDEX.md` — Pac-Man Dossier chapter index and quick-reference tables
- `MAP-EDITOR.md` — level editor implementation plan
