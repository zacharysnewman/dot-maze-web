# Dot Maze Web

A web-based dot-maze game written in TypeScript. The maze, characters, and all visuals are drawn entirely with Canvas 2D stroke/fill calls — no sprites or images.

## Features

- **1–4 player co-op** — shared life pool, simultaneous play, players sit out on death and revive on level clear
- Keyboard, touch/swipe, and gamepad input — P1 accepts all three simultaneously
- **LAN co-op** — one machine runs `npm run lan`, everyone on the network plays; see below and `MULTIPLAYER.md`
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

## LAN Co-op

Multiplayer is LAN only. One computer on the network runs the LAN server, which
serves the game and carries the players' messages:

```sh
npm install
npm run lan       # builds, then serves on port 8080 (PORT=9000 npm run lan to change)
```

It prints the addresses to open, e.g. `http://192.168.1.20:8080`. On that
computer open `http://localhost:8080` and pick **HOST LAN GAME**; the host's
lobby shows the address for everyone else. On the other devices (phones,
laptops, anything with a browser on the same Wi-Fi) open that address and pick
**JOIN LAN GAME** — with one game on the network it joins by itself, no code
needed. Up to four players.

The host/join entries only appear when the page comes from the LAN server; the
public static site is single-machine play only.

If other devices can't load the page, the server machine's firewall is usually
the cause (allow Node on private networks), or the Wi-Fi is a guest network that
keeps devices apart.

## Dev Setup

```sh
npm install
npm run dev       # watch mode (esbuild)
npm run build     # type-check + production bundle
```

Open `index.html` in a browser after building. Append `?dev=true` to enable the
debug panel.

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
  net/               # co-op: protocol, host, client, lobby, WebSocket transport
server/
  lan-server.js      # LAN server: serves the game and relays messages
MAP-EDITOR.md        # planned level editor spec
```

## Documentation

- `MAP-EDITOR.md` — level editor implementation plan
- `MULTIPLAYER.md` — LAN co-op design and implementation notes
