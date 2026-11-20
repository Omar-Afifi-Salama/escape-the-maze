# Escape the Maze

A first-person raycasting maze-escape game rendered to an HTML canvas pixel buffer. Three stacked zones, color-coded keys and doors, fog-of-war minimap, breadcrumbs, and a torchlight-fog atmosphere.

## Run locally

```bash
npm install
npm run dev        # build + serve on http://localhost:5173
```

Or watch for changes while playing:

```bash
npm run watch      # recompile on save (terminal 1)
npm run serve      # http://localhost:5173 (terminal 2)
```

## Controls

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

## Modes

- **Timed / Untimed** — stopwatch vs countdown (hourglasses add time)
- **Difficulty** — easy / medium / hard change maze size, braiding, fog distance and timer

## Deploy to Vercel

The game is fully static — `npm run build` emits plain JS + HTML into `dist/`.

```bash
npm run deploy     # npx vercel --prod
```

Or connect the repo in the Vercel dashboard; `vercel.json` already sets the build command (`npm run build`) and output directory (`dist`). No framework, no server functions needed.

## Tech

- TypeScript, compiled with `tsc` to ES modules in `dist/`
- Software renderer: DDA raycasting walls, floor/ceiling casting, sprites with additive glow, fog via precomputed LUTs
- Procedural textures (no image assets), seeded maze generator
- Zero runtime dependencies; `scripts/serve.mjs` is a tiny static server for local play
