# Chapter 9 — Maze Zones (Areas to Exploit)

> Source: *The Pac-Man Dossier* by Jamey Pittman (pacman.holenet.info)

---

## Overview

There are four special **zones** in the maze where ghost behavior is constrained by specific conditions. Understanding these zones is essential for advanced play.

---

## Red Zones — No Upward Turns

There are **two red zones** in the maze, one on each side of the ghost house. Ghosts inside a red zone are **forbidden from making upward turns**.

- A ghost entering a red zone may only travel **left-to-right** or **right-to-left** until it exits
- Only Pac-Man has access to the **four upward-facing tunnel entrances** within these zones
- Ghosts can still enter these tunnels **from the other end** (approaching downward)
- Red zone restrictions apply during **scatter and chase modes**
- Red zone restrictions are **ignored during frightened mode** — ghosts may turn upward freely

### Red Zone Tile Locations (approximate, on 28×36 grid)

The two red zones are the horizontal corridors that run left and right from the ghost house, at approximately **rows 14 and 26** (the two T-intersections on either side of the ghost house). These correspond to the four intersections where, in the original arcade, upward exits are blocked for ghosts.

---

## Pink Zones — Tunnel Speed Penalty

There are **two pink zones** — the left and right halves of the **side tunnel** that connects the two edges of the maze.

- Any ghost entering a tunnel zone suffers an **immediate speed reduction** (roughly halved) until it exits
- This slow-down is **always enforced** — there are no exceptions for mode or level
- **Pac-Man is immune** to the tunnel speed penalty — his speed is unchanged in the tunnel
- See [Chapter 6 — Speed](./06-speed.md) for exact tunnel speed percentages by level

---

## Summary Table

| Zone | Color | Effect | Modes Active | Ghost Immune? | Pac-Man Immune? |
|---|---|---|---|---|---|
| No-upward-turn corridors | Red | Ghosts cannot turn up | Chase, Scatter | Frightened only | N/A (Pac-Man can always turn up) |
| Side tunnels | Pink | Ghost speed cut ~50% | All modes | Never | Yes — always |

---

## Exploiting These Zones

**Red zones:** Because ghosts cannot turn up, Pac-Man can pass through the four upward entrances in these corridors without fear of a ghost following him up. Skilled players use these as escape routes.

**Pink zones (tunnels):** A ghost entering the tunnel is dramatically slowed. Pac-Man can use the tunnel to escape a chase and build distance since he passes through at full speed while the ghost crawls.

---

## Implementation Status

| Feature | Status | Notes |
|---|---|---|
| Tunnel teleport (Pac-Man) | ✅ Implemented | `Move.moveObject()` wraps x position at grid edges |
| Tunnel teleport (ghosts) | ✅ Implemented | `AI.ts` treats off-grid as passable on tunnel row; ghosts wrap |
| Tunnel speed penalty (ghosts) | ✅ Implemented | `updateGhostTunnelSpeeds()` in `Game.ts` — 40% L1, 45% L2–4, 50% L5+ |
| Red zone upward-turn restriction | ❌ Not implemented | No intersection-specific turn rules |
| Red zone ignored in frightened | ❌ Not implemented | Depends on red zone implementation |
