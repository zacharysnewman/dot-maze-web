# Dot Maze Web

A web-based dot-maze game written in TypeScript. The maze, characters, and all visuals are drawn entirely with Canvas 2D stroke/fill calls — no sprites or images.

## Features

- **1–4 player co-op** — shared life pool, simultaneous play, players sit out on death and revive on level clear
- Keyboard, touch/swipe, and gamepad input — P1 accepts all three simultaneously
- **Online co-op** behind `?multiplayer` — see `MULTIPLAYER.md`
- All graphics procedurally drawn on canvas (no image assets)
- Web Audio API sound effects

## Controls

| Input | Action |
|---|---|
| Arrow keys | Move (P1) |
| Swipe | Move (P1, touch) |
| D-pad / left stick | Move (gamepad, P1–P4) |

Any connected pad works the start and player-select screens, whichever slot the
browser gives it, and any of its non-d-pad buttons confirms — pads that report a
non-standard mapping (a Joy-Con among them) put their buttons where they like.

## Dev Setup

```sh
npm install
npm run dev       # watch mode (esbuild)
npm run build     # type-check + production bundle
```

Open `index.html` in a browser after building. Append `?dev=true` to enable the
debug panel, and `?multiplayer` to show the online host/join entries on the
start menu.

## Project Structure

```
src/
  Game.ts            # main game loop, lifecycle, player select
  constants.ts       # tile grid, speeds, zone constants
  game-state.ts      # shared mutable game state
  types.ts           # shared interfaces
  input/             # PlayerInput, Keyboard, Touch, Gamepad, Composite, menu pad
  object/            # GameObject base class
  static/            # Draw, Move, AI, Sound, Stats, Time
MAP-EDITOR.md        # planned level editor spec
```

## Documentation

- `MAP-EDITOR.md` — level editor implementation plan
- `MULTIPLAYER.md` — online co-op implementation plan
