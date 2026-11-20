# Ray-Casting Graphics Engine

A software-rendered 3D engine written from scratch in TypeScript. Every pixel is computed on the CPU into a `Uint32Array` framebuffer and blitted to an HTML canvas with `putImageData` — no WebGL, no frameworks, no image assets. On top of the engine sits *Escape the Maze*, a first-person maze game used as its driving application.

## Architecture

```
src/
  main.ts        entry point: input, requestAnimationFrame loop
  game.ts        game state machine (menu/pause/play/won/lost), rules, pickups, doors
  hud.ts         2D-context overlays: timer, keycards, map overlay, end screens
  menu.ts        HTML menu layer (main menu, pause, settings, controls)
  settings.ts    persisted settings (FOV, render style)
  screen.ts      framebuffer: Uint32Array view over ImageData, pixel primitives
  renderer.ts    the engine: raycasting, floor/ceiling casting, sprites, fog, minimap
  world.ts       tile grid, visibility (fog of war), player movement/collision
  maze.ts        seeded maze generator (stacked zones, doors, item placement)
  textures.ts    procedural 64x64 textures, generated at startup
  sprite.ts      sprite kinds + screen-space anchoring (scale, v-offset)
  config.ts      tuning knobs and difficulty table
```

## The renderer

### Framebuffer

`Screen` owns one `ImageData` and exposes its raw memory as a `Uint32Array` (little-endian ABGR, alpha in the high byte). All drawing is integer pixel writes; primitives (`setPixel`, `drawRect`, `drawVLine`) are only used where bounds checks matter — hot loops index the array directly.

### Walls — DDA raycasting

One ray per framebuffer column. The classic grid-DDA walk steps cell by cell until a wall is hit, storing the perpendicular distance in a z-buffer. The wall slice is textured by taking the fractional hit coordinate along the wall face as the texture column, then stepping vertically through the 64×64 texture. A per-side darkening factor (0.65 on north/south faces) keeps corners readable.

### Floor and ceiling — row-based casting

For every row below the horizon the renderer computes the world-space distance of that row, then walks across the screen interpolating world coordinates between the leftmost and rightmost FOV rays. Each pixel samples the floor texture at the fractional world position; the row is mirrored above the horizon for the ceiling. Rows beyond the fog distance are skipped entirely — they were pre-cleared to the fog color.

### Sprites

Sprites are transformed into camera space with the inverse camera matrix, depth-sorted far-to-near, and drawn column-by-column with per-stripe z-buffer occlusion. Each sprite has a `scale` (fraction of wall height) and a `vOffset` (vertical anchor from wall top to floor line), so a keycard near the floor and a wall-mounted torch share the same pipeline.

### Fog and torchlight

Light falls off quadratically with distance (`(1 - d/maxDist)²`) — torchlight that keeps nearby walls bright while distant corridors plunge into darkness. Instead of black, fog lerps toward a color (deep indigo, shifting to dark red as the run timer runs out). The per-channel lerp is precomputed into a 128-level × 256-entry lookup table per color channel, quantizing brightness to steps under 1% apart — visually indistinguishable, and roughly 3× cheaper in the per-pixel hot loops. The LUTs are rebuilt only when the fog color changes (at most 17 times per run).

### Item glow

Key items, lanterns and the exit portal draw an additive radial halo around themselves: each affected pixel is brightened toward the glow color with a quadratic falloff, occluded per-stripe by the z-buffer so light never leaks through walls. Glowing sprites also keep a minimum fog brightness so they stay visible down a long corridor.

### Doors

Doors are ordinary solid wall cubes with their own textures. Unlocking removes the tile from the grid; collision treats any non-floor tile as solid.

### Render styles

Three complete pipelines selectable at runtime (**T**, or the settings menu):

0. **textured + fog** — the full pipeline described above
1. **custom textures** — unfogged floor/ceiling casting with a streamed texture registry (ids → textures) and bit-shift side darkening
2. **classic flat** — two-tone background with solid per-tile wall colors

All three share the same DDA raycast (`castRay`), which also fills the z-buffer and marks walls as seen for the fog-of-war minimap.

## Engine-adjacent systems

- **Fog-of-war minimap** — walking reveals ground in a radius and rays mark walls they touch; the minimap renders a scrolling player-centered window, and a full explored-map overlay (hold **M**/Tab) adds a vision cone built from the frame's ray distances.
- **Procedural textures** — bricks, stone, moss, hazard stripes, doors and sprites are generated with deterministic value noise at startup; there are no image assets.
- **Seeded maze generator** — mulberry32 RNG, recursive-backtracker carving with dead-end braiding, item placement via BFS distance maps; same seed → same maze.
- **Headless-testable** — the renderer only needs a `Uint32Array` and a two-method canvas stub, so whole runs can be simulated and pixel-verified in Node.

## The game on top

*Escape the Maze*: three stacked zones connected by colored doors. Find the red key in zone 1, climb to zone 2, then zone 3, and escape through the gated portal before the torchlight runs out — or play untimed.

| Key | Action |
| --- | --- |
| W A S D / ↑ ↓ | move |
| ← → | turn |
| E | drop breadcrumb |
| M / Tab (hold) | explored map + vision cone |
| Esc / P | pause |
| F | fullscreen |
| T | cycle render style |
| R | restart this seed |

Timed and untimed modes; easy/medium/hard change maze size, braiding, fog distance and timer.

## Running

```bash
npm install
npm run dev        # build + serve on http://localhost:5173
```

`npm run watch` recompiles on save; `npm run build` emits plain ES modules + HTML into `dist/`. Zero runtime dependencies.

## Performance

~4 ms/frame at 960×540 for the full textured pipeline in V8 (floor + ceiling casting, ~700k fogged pixel writes, sprites and halos included). The main levers, in order of impact: the fog LUT (vs per-pixel lerp math), direct framebuffer writes in hot loops, and skipping fully-fogged floor rows.
