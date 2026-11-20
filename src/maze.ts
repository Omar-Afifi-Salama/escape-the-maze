// Seeded hub-and-spoke maze generator.
//
// Layout (39x39 grid for 19 cells):
//   - 5x5 stone hub room in the center (player spawn)
//   - 4 wings carved by recursive backtracker, each with a theme:
//       West  (open entry)  -> red brick wing  -> RED key
//       North (red door)    -> blue stone wing -> BLUE key
//       East  (blue door)   -> moss wing       -> GOLD key
//       South (gold gate)   -> hazard wing     -> EXIT
//   - ~13% of dead ends are "braided" open so there are loops and shortcuts.
import type { SpriteKind } from "./sprite.js";
import { CONFIG } from "./config.js";

export const TILE = {
    FLOOR: 0,
    BORDER: 1,
    HUB: 2,
    RED: 3,
    BLUE: 4,
    MOSS: 5,
    HAZARD: 6,
    DOOR_RED: 20,
    DOOR_BLUE: 21,
    DOOR_GOLD: 22,
    EXIT: 30,
} as const;

// sprite texture ids (must match the Renderer's spriteTex map)
export const SPRITE_TEX = {
    TORCH: 100,
    KEY_RED: 101,
    KEY_BLUE: 102,
    KEY_GOLD: 103,
    HOURGLASS: 104,
    LANTERN_RED: 105,
    LANTERN_BLUE: 106,
    LANTERN_GREEN: 107,
    LANTERN_GOLD: 108,
    CRUMB: 109,
    PORTAL: 110,
} as const;

export interface MazeItem {
    x: number;
    y: number;
    kind: SpriteKind;
    texId: number;
}

export interface MazeDoor {
    x: number;
    y: number;
    tile: number;
}

export interface MazeStart {
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    planeX: number;
    planeY: number;
}

export interface MazeData {
    width: number;
    height: number;
    tiles: number[][];
    zone: Uint8Array; // 0 hub, 1 red wing, 2 blue, 3 moss, 4 hazard
    start: MazeStart;
    doors: MazeDoor[];
    items: MazeItem[];
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface WingSpec {
    zone: number;
    theme: number;
    rect: { x0: number; x1: number; y0: number; y1: number };
    xs: number[]; // cell coords (odd grid coords)
    ys: number[];
    entry: [number, number]; // wing cell adjacent to the entry corridor
    entryPath: Array<[number, number]>; // tiles punched from the hub ring out
    doorTile?: number; // placed on the ring slot when the wing is locked
    prize: "red" | "blue" | "gold" | "exit";
    lanternTex: number;
}

function oddRange(a: number, b: number): number[] {
    const out: number[] = [];
    for (let i = a; i <= b; i += 2) out.push(i);
    return out;
}

const N = CONFIG.GRID_CELLS; // cells per full dimension
const G = N * 2 + 1; // grid size

const wings: WingSpec[] = [
    {
        // west: full-height strip, open entry, holds the red key
        zone: 1,
        theme: TILE.RED,
        rect: { x0: 1, x1: N - 5, y0: 1, y1: G - 2 },
        xs: oddRange(1, N - 6),
        ys: oddRange(1, G - 2),
        entry: [N - 6, N - 2],
        entryPath: [
            [N - 3, N - 2],
            [N - 4, N - 2],
            [N - 5, N - 2],
        ],
        prize: "red",
        lanternTex: SPRITE_TEX.LANTERN_RED,
    },
    {
        // north: middle strip behind the red door, holds the blue key
        zone: 2,
        theme: TILE.BLUE,
        rect: { x0: N - 4, x1: N + 4, y0: 1, y1: N - 5 },
        xs: oddRange(N - 4, N + 4),
        ys: oddRange(1, N - 6),
        entry: [N - 2, N - 6],
        entryPath: [
            [N - 2, N - 3],
            [N - 2, N - 4],
            [N - 2, N - 5],
        ],
        doorTile: TILE.DOOR_RED,
        prize: "blue",
        lanternTex: SPRITE_TEX.LANTERN_BLUE,
    },
    {
        // east: full-height strip behind the blue door, holds the gold key
        zone: 3,
        theme: TILE.MOSS,
        rect: { x0: N + 5, x1: G - 2, y0: 1, y1: G - 2 },
        xs: oddRange(N + 6, G - 2),
        ys: oddRange(1, G - 2),
        entry: [N + 6, N + 2],
        entryPath: [
            [N + 3, N + 2],
            [N + 4, N + 2],
            [N + 5, N + 2],
        ],
        doorTile: TILE.DOOR_BLUE,
        prize: "gold",
        lanternTex: SPRITE_TEX.LANTERN_GREEN,
    },
    {
        // south: middle strip behind the gold gate, holds the exit
        zone: 4,
        theme: TILE.HAZARD,
        rect: { x0: N - 4, x1: N + 4, y0: N + 5, y1: G - 2 },
        xs: oddRange(N - 4, N + 4),
        ys: oddRange(N + 6, G - 2),
        entry: [N + 2, N + 6],
        entryPath: [
            [N + 2, N + 3],
            [N + 2, N + 4],
            [N + 2, N + 5],
        ],
        doorTile: TILE.DOOR_GOLD,
        prize: "exit",
        lanternTex: SPRITE_TEX.LANTERN_GOLD,
    },
];

const DIRS: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

function key(x: number, y: number): string {
    return `${x},${y}`;
}

// carve one wing with a recursive backtracker, then braid some dead ends open
function carveWing(tiles: number[][], wing: WingSpec, rng: () => number): void {
    const inRegion = (cx: number, cy: number): boolean =>
        wing.xs.includes(cx) && wing.ys.includes(cy);

    const visited = new Set([key(wing.entry[0], wing.entry[1])]);
    tiles[wing.entry[1]]![wing.entry[0]] = TILE.FLOOR;

    const stack: Array<[number, number]> = [[wing.entry[0], wing.entry[1]]];

    while (stack.length > 0) {
        const [cx, cy] = stack[stack.length - 1]!;

        const options = DIRS.filter(
            ([dx, dy]) =>
                inRegion(cx + 2 * dx, cy + 2 * dy) &&
                !visited.has(key(cx + 2 * dx, cy + 2 * dy)),
        );

        if (options.length === 0) {
            stack.pop();
            continue;
        }

        const [dx, dy] = options[Math.floor(rng() * options.length)]!;
        const nx = cx + 2 * dx;
        const ny = cy + 2 * dy;

        tiles[cy + dy]![cx + dx] = TILE.FLOOR; // knock the wall between cells
        tiles[ny]![nx] = TILE.FLOOR;
        visited.add(key(nx, ny));
        stack.push([nx, ny]);
    }

    // braid: open ~13% of dead ends so the maze has loops, not one solution path
    for (const cx of wing.xs) {
        for (const cy of wing.ys) {
            const open = DIRS.filter(
                ([dx, dy]) =>
                    inRegion(cx + 2 * dx, cy + 2 * dy) &&
                    tiles[cy + dy]![cx + dx] === TILE.FLOOR,
            );
            if (open.length !== 1 || rng() >= 0.13) continue;

            const closed = DIRS.filter(
                ([dx, dy]) =>
                    inRegion(cx + 2 * dx, cy + 2 * dy) &&
                    tiles[cy + dy]![cx + dx] !== TILE.FLOOR,
            );
            if (closed.length === 0) continue;

            const [dx, dy] = closed[Math.floor(rng() * closed.length)]!;
            tiles[cy + dy]![cx + dx] = TILE.FLOOR;
        }
    }
}

// color the uncarved walls inside a wing and tag the zone map
function themeRegion(
    tiles: number[][],
    wing: WingSpec,
    zone: Uint8Array,
    grid: number,
): void {
    const { rect } = wing;
    for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
            const border =
                x === 0 || y === 0 || x === grid - 1 || y === grid - 1;
            if (!border && tiles[y]![x] === TILE.BORDER) {
                tiles[y]![x] = wing.theme;
            }
            zone[y * grid + x] = wing.zone;
        }
    }
}

// BFS distances from a cell, constrained to a region
function bfsDistances(
    tiles: number[][],
    rect: { x0: number; x1: number; y0: number; y1: number },
    sx: number,
    sy: number,
    grid: number,
): Map<number, number> {
    const dist = new Map<number, number>();
    dist.set(sy * grid + sx, 0);
    const queue: Array<[number, number]> = [[sx, sy]];

    while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        const d = dist.get(y * grid + x)!;

        for (const [dx, dy] of DIRS) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < rect.x0 || nx > rect.x1 || ny < rect.y0 || ny > rect.y1) {
                continue;
            }
            const t = tiles[ny]![nx]!;
            if (t !== TILE.FLOOR && t !== TILE.EXIT) continue;
            const i = ny * grid + nx;
            if (dist.has(i)) continue;
            dist.set(i, d + 1);
            queue.push([nx, ny]);
        }
    }

    return dist;
}

interface WingFeatures {
    deadEnds: Array<{ x: number; y: number; d: number }>;
    intersections: Array<{ x: number; y: number; d: number }>;
}

function analyzeWing(
    tiles: number[][],
    wing: WingSpec,
    grid: number,
): WingFeatures {
    const dist = bfsDistances(tiles, wing.rect, wing.entry[0], wing.entry[1], grid);
    const deadEnds: WingFeatures["deadEnds"] = [];
    const intersections: WingFeatures["intersections"] = [];

    for (const cy of wing.ys) {
        for (const cx of wing.xs) {
            if (tiles[cy]![cx] !== TILE.FLOOR) continue;
            const d = dist.get(cy * grid + cx);
            if (d === undefined) continue;

            let open = 0;
            for (const [dx, dy] of DIRS) {
                if (tiles[cy + dy]![cx + dx] === TILE.FLOOR) open++;
            }

            if (open === 1) deadEnds.push({ x: cx, y: cy, d });
            if (open >= 3) intersections.push({ x: cx, y: cy, d });
        }
    }

    deadEnds.sort((a, b) => b.d - a.d);
    intersections.sort((a, b) => b.d - a.d);
    return { deadEnds, intersections };
}

export function generateMaze(seed: number): MazeData {
    const rng = mulberry32(seed);
    const grid = G;

    const tiles: number[][] = [];
    for (let y = 0; y < grid; y++) {
        tiles.push(new Array<number>(grid).fill(TILE.BORDER));
    }
    const zone = new Uint8Array(grid * grid);

    // hub room + its wall ring
    const hub0 = N - 2;
    const hub1 = N + 2;
    for (let y = hub0 - 1; y <= hub1 + 1; y++) {
        for (let x = hub0 - 1; x <= hub1 + 1; x++) {
            const ring =
                x === hub0 - 1 || x === hub1 + 1 || y === hub0 - 1 || y === hub1 + 1;
            tiles[y]![x] = ring ? TILE.HUB : TILE.FLOOR;
        }
    }

    const doors: MazeDoor[] = [];
    const items: MazeItem[] = [];
    const occupied = new Set<string>();

    for (const wing of wings) {
        carveWing(tiles, wing, rng);
        themeRegion(tiles, wing, zone, grid);

        // punch the entry corridor; the ring slot becomes a door when locked
        wing.entryPath.forEach(([x, y], i) => {
            if (wing.doorTile !== undefined && i === 0) {
                tiles[y]![x] = wing.doorTile;
                doors.push({ x, y, tile: wing.doorTile });
            } else {
                tiles[y]![x] = TILE.FLOOR;
            }
            occupied.add(key(x, y));
        });

        const { deadEnds, intersections } = analyzeWing(tiles, wing, grid);

        // main prize on the farthest dead end
        const prize = deadEnds[0] ?? { x: wing.entry[0], y: wing.entry[1], d: 0 };
        if (wing.prize === "exit") {
            tiles[prize.y]![prize.x] = TILE.EXIT;
            items.push({
                x: prize.x + 0.5,
                y: prize.y + 0.5,
                kind: "portal",
                texId: SPRITE_TEX.PORTAL,
            });
        } else {
            const texId =
                wing.prize === "red"
                    ? SPRITE_TEX.KEY_RED
                    : wing.prize === "blue"
                      ? SPRITE_TEX.KEY_BLUE
                      : SPRITE_TEX.KEY_GOLD;
            items.push({
                x: prize.x + 0.5,
                y: prize.y + 0.5,
                kind: "key",
                texId,
            });
        }
        occupied.add(key(prize.x, prize.y));

        // hourglass on the second-farthest dead end, if it's deep enough
        const hg = deadEnds[1];
        if (hg && hg.d >= 8) {
            items.push({
                x: hg.x + 0.5,
                y: hg.y + 0.5,
                kind: "hourglass",
                texId: SPRITE_TEX.HOURGLASS,
            });
            occupied.add(key(hg.x, hg.y));
        }

        // lanterns mark the big intersections (mental anchors)
        for (const spot of intersections) {
            if (spot.d < 5 || items.length > 40) continue;
            if (occupied.has(key(spot.x, spot.y))) continue;
            items.push({
                x: spot.x + 0.5,
                y: spot.y + 0.5,
                kind: "lantern",
                texId: wing.lanternTex,
            });
            occupied.add(key(spot.x, spot.y));
            if (rng() < 0.5) break; // 1-2 per wing
        }
    }

    // a light sprinkle of torches along plain corridors
    let torches = 0;
    for (const wing of wings) {
        if (torches >= 18) break;
        for (const cy of wing.ys) {
            if (torches >= 18) break;
            for (const cx of wing.xs) {
                if (torches >= 18) break;
                if (tiles[cy]![cx] !== TILE.FLOOR) continue;
                if (occupied.has(key(cx, cy))) continue;
                if (rng() >= 0.045) continue;
                items.push({
                    x: cx + 0.5,
                    y: cy + 0.5,
                    kind: "torch",
                    texId: SPRITE_TEX.TORCH,
                });
                occupied.add(key(cx, cy));
                torches++;
            }
        }
    }

        const start: MazeStart = {
            x: N + 0.5,
            y: N + 0.5,
            dirX: -1, // facing the open west wing
            dirY: 0,
            planeX: 0,
            planeY: -0.66,
        };

        return {
            width: grid,
            height: grid,
            tiles,
            zone,
            start,
            doors,
            items,
        };
    }
