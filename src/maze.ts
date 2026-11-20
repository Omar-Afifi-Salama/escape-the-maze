// Seeded stacked-zone maze generator.
//
// Layout: three full-width zones stacked bottom to top, separated by solid
// wall rows with one door each. The player starts in Zone 1 (red brick),
// climbs to Zone 2 (blue stone) through the red door, then Zone 3 (hazard)
// through the blue door. Zone 3 holds the gold key and the exit behind a
// gold gate — a goal inside the last zone too.
//
//   ┌──── Zone 3 (hazard) ────┐  gold key, exit gate
//   ├──────[ BLUE DOOR ]──────┤
//   │      Zone 2 (blue)      │  blue key
//   ├──────[ RED DOOR ]───────┤
//   │      Zone 1 (red) start │  red key
//   └─────────────────────────┘
import type { SpriteKind } from "./sprite.js";
import { DIFFICULTIES, type Difficulty } from "./config.js";

export const TILE = {
    FLOOR: 0,
    BORDER: 1,
    HUB: 2, // kept for texture-registry compatibility; unused in this layout
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
    zone: Uint8Array; // 0 unused, 1 red zone, 2 blue zone, 4 hazard zone
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

interface Band {
    zone: number; // minimap zone id
    theme: number; // wall tile id
    y0: number; // band top row (inclusive)
    y1: number; // band bottom row (inclusive)
    ys: number[]; // cell rows (odd)
    entry: [number, number]; // cell the band is carved from
}

interface ZoneFeatures {
    deadEnds: Array<{ x: number; y: number; d: number }>;
    intersections: Array<{ x: number; y: number; d: number }>;
}

const DIRS: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

function key(x: number, y: number): string {
    return `${x},${y}`;
}

function oddRange(a: number, b: number): number[] {
    const out: number[] = [];
    for (let i = a; i <= b; i += 2) out.push(i);
    return out;
}

// carve one band with a recursive backtracker, then braid some dead ends open
function carveBand(
    tiles: number[][],
    band: Band,
    rng: () => number,
    braid: number,
    width: number,
): void {
    const xs = oddRange(1, width - 2);
    const inBand = (cx: number, cy: number): boolean =>
        xs.includes(cx) && band.ys.includes(cy);

    const visited = new Set([key(band.entry[0], band.entry[1])]);
    tiles[band.entry[1]]![band.entry[0]] = TILE.FLOOR;

    const stack: Array<[number, number]> = [[band.entry[0], band.entry[1]]];

    while (stack.length > 0) {
        const [cx, cy] = stack[stack.length - 1]!;

        const options = DIRS.filter(
            ([dx, dy]) =>
                inBand(cx + 2 * dx, cy + 2 * dy) &&
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

    // braid: open a fraction of dead ends so the maze has loops
    for (const cx of xs) {
        for (const cy of band.ys) {
            const open = DIRS.filter(
                ([dx, dy]) =>
                    inBand(cx + 2 * dx, cy + 2 * dy) &&
                    tiles[cy + dy]![cx + dx] === TILE.FLOOR,
            );
            if (open.length !== 1 || rng() >= braid) continue;

            const closed = DIRS.filter(
                ([dx, dy]) =>
                    inBand(cx + 2 * dx, cy + 2 * dy) &&
                    tiles[cy + dy]![cx + dx] !== TILE.FLOOR,
            );
            if (closed.length === 0) continue;

            const [dx, dy] = closed[Math.floor(rng() * closed.length)]!;
            tiles[cy + dy]![cx + dx] = TILE.FLOOR;
        }
    }
}

// color the uncarved walls inside a band and tag the zone map
function themeBand(
    tiles: number[][],
    band: Band,
    zone: Uint8Array,
    width: number,
    height: number,
): void {
    for (let y = band.y0; y <= band.y1; y++) {
        for (let x = 0; x <= width - 1; x++) {
            const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
            if (!border && tiles[y]![x] === TILE.BORDER) {
                tiles[y]![x] = band.theme;
            }
            zone[y * width + x] = band.zone;
        }
    }
}

// BFS distances from a tile, constrained to a band
function bfsDistances(
    tiles: number[][],
    band: Band,
    sx: number,
    sy: number,
    width: number,
): Map<number, number> {
    const dist = new Map<number, number>();
    dist.set(sy * width + sx, 0);
    const queue: Array<[number, number]> = [[sx, sy]];

    while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        const d = dist.get(y * width + x)!;

        for (const [dx, dy] of DIRS) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 1 || nx > width - 2 || ny < band.y0 + 1 || ny > band.y1 - 1) {
                continue;
            }
            const t = tiles[ny]![nx]!;
            if (t !== TILE.FLOOR && t !== TILE.EXIT) continue;
            const i = ny * width + nx;
            if (dist.has(i)) continue;
            dist.set(i, d + 1);
            queue.push([nx, ny]);
        }
    }

    return dist;
}

function analyzeBand(
    tiles: number[][],
    band: Band,
    width: number,
): ZoneFeatures {
    const dist = bfsDistances(tiles, band, band.entry[0], band.entry[1], width);
    const deadEnds: ZoneFeatures["deadEnds"] = [];
    const intersections: ZoneFeatures["intersections"] = [];

    for (const cy of band.ys) {
        for (let cx = 1; cx <= width - 2; cx++) {
            if (tiles[cy]![cx] !== TILE.FLOOR) continue;
            const d = dist.get(cy * width + cx);
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

export function generateMaze(
    seed: number,
    difficulty: Difficulty = "medium",
    hourglassesWanted = 3,
): MazeData {
    const spec = DIFFICULTIES[difficulty];
    const rng = mulberry32(seed);

    const width = 2 * spec.zoneCellsW + 1;
    const bandHeight = 2 * spec.zoneCellsH + 1;
    const height = 3 * bandHeight + 2;

    const tiles: number[][] = [];
    for (let y = 0; y < height; y++) {
        tiles.push(new Array<number>(width).fill(TILE.BORDER));
    }
    const zone = new Uint8Array(width * height);

    // bands, top to bottom: zone3 (hazard), zone2 (blue), zone1 (red)
    const bands: Band[] = [
        {
            zone: 4,
            theme: TILE.HAZARD,
            y0: 0,
            y1: bandHeight - 1,
            ys: oddRange(1, bandHeight - 2),
            entry: [1, 1], // placeholder, re-carved below
        },
        {
            zone: 2,
            theme: TILE.BLUE,
            y0: bandHeight + 1,
            y1: 2 * bandHeight,
            ys: oddRange(bandHeight + 2, 2 * bandHeight - 1),
            entry: [1, 1],
        },
        {
            zone: 1,
            theme: TILE.RED,
            y0: 2 * bandHeight + 2,
            y1: 3 * bandHeight + 1,
            ys: oddRange(2 * bandHeight + 3, 3 * bandHeight),
            entry: [1, 1],
        },
    ];

    // start cell: center of the bottom band (snapped to an odd cell row)
    const startCol: number = spec.zoneCellsW; // odd center column
    const yMid = 2 * bandHeight + 2 + spec.zoneCellsH;
    const startCell: [number, number] = [
        startCol,
        yMid % 2 === 1 ? yMid : yMid + 1,
    ];

    // carve every band from a central cell so the whole band is connected
    bands[2]!.entry = startCell;
    bands[1]!.entry = [startCol, 2 * bandHeight - 1];
    bands[0]!.entry = [startCol, bandHeight - 2];

    for (const band of bands) {
        carveBand(tiles, band, rng, spec.braid, width);
        themeBand(tiles, band, zone, width, height);
    }

    const doors: MazeDoor[] = [];
    const items: MazeItem[] = [];
    const occupied = new Set<string>();

    // helper: place an item at a tile center
    const place = (t: { x: number; y: number }, kind: SpriteKind, texId: number) => {
        items.push({ x: t.x + 0.5, y: t.y + 0.5, kind, texId });
        occupied.add(key(t.x, t.y));
    };

    // --- zone 1: red key on the farthest dead end from the start ---
    const z1 = bands[2]!;
    const z1Feat = analyzeBand(tiles, z1, width);
    const z1Dist = bfsDistances(tiles, z1, startCell[0], startCell[1], width);
    const redKey = z1Feat.deadEnds[0] ?? { x: startCell[0], y: startCell[1], d: 0 };
    place(redKey, "key", SPRITE_TEX.KEY_RED);

    // --- red door: column as far from the red key as possible ---
    const z1FromKey = bfsDistances(tiles, z1, redKey.x, redKey.y, width);
    let dx1 = startCol;
    let bestD = -1;
    for (let dx = 1; dx <= width - 2; dx += 2) {
        const d = z1FromKey.get((2 * bandHeight + 3) * width + dx) ?? -1;
        if (d > bestD) {
            bestD = d;
            dx1 = dx;
        }
    }
    tiles[2 * bandHeight + 1]![dx1] = TILE.DOOR_RED;
    doors.push({ x: dx1, y: 2 * bandHeight + 1, tile: TILE.DOOR_RED });
    tiles[2 * bandHeight]![dx1] = TILE.FLOOR;
    tiles[2 * bandHeight + 2]![dx1] = TILE.FLOOR;

    // --- zone 2: blue key on the farthest dead end from the red door ---
    const z2 = bands[1]!;
    const z2Entry: [number, number] = [dx1, 2 * bandHeight - 1];
    const z2Feat = analyzeBand(tiles, z2, width);
    const z2Dist = bfsDistances(tiles, z2, z2Entry[0], z2Entry[1], width);
    const blueKey =
        z2Feat.deadEnds.find((e) => !occupied.has(key(e.x, e.y))) ??
        { x: z2Entry[0], y: z2Entry[1], d: 0 };
    place(blueKey, "key", SPRITE_TEX.KEY_BLUE);

    // --- blue door: far from the blue key ---
    const z2FromKey = bfsDistances(tiles, z2, blueKey.x, blueKey.y, width);
    let dx2 = startCol;
    bestD = -1;
    for (let dx = 1; dx <= width - 2; dx += 2) {
        const d = z2FromKey.get((bandHeight + 2) * width + dx) ?? -1;
        if (d > bestD) {
            bestD = d;
            dx2 = dx;
        }
    }
    tiles[bandHeight]![dx2] = TILE.DOOR_BLUE;
    doors.push({ x: dx2, y: bandHeight, tile: TILE.DOOR_BLUE });
    tiles[bandHeight - 1]![dx2] = TILE.FLOOR;
    tiles[bandHeight + 1]![dx2] = TILE.FLOOR;

    // --- zone 3: gold key on the farthest dead end from the blue door ---
    const z3 = bands[0]!;
    const z3Entry: [number, number] = [dx2, bandHeight - 2];
    const z3Feat = analyzeBand(tiles, z3, width);
    const z3Dist = bfsDistances(tiles, z3, z3Entry[0], z3Entry[1], width);
    const goldKey =
        z3Feat.deadEnds.find((e) => !occupied.has(key(e.x, e.y))) ??
        { x: z3Entry[0], y: z3Entry[1], d: 0 };
    place(goldKey, "key", SPRITE_TEX.KEY_GOLD);

    // --- exit: farthest dead end from the gold key, gated by the gold door ---
    const z3FromKey = bfsDistances(tiles, z3, goldKey.x, goldKey.y, width);
    const exitSpot =
        z3Feat.deadEnds.find(
            (e) =>
                !occupied.has(key(e.x, e.y)) &&
                (z3FromKey.get(e.y * width + e.x) ?? 0) >= 6,
        ) ??
        z3Feat.deadEnds.find((e) => !occupied.has(key(e.x, e.y))) ??
        null;

    if (exitSpot) {
        // its single open neighbour becomes the gold gate
        const nb = DIRS.map(
            ([dx, dy]) => ({ x: exitSpot.x + dx, y: exitSpot.y + dy }),
        ).find((n) => tiles[n.y]![n.x] === TILE.FLOOR)!;
        tiles[nb.y]![nb.x] = TILE.DOOR_GOLD;
        doors.push({ x: nb.x, y: nb.y, tile: TILE.DOOR_GOLD });
        tiles[exitSpot.y]![exitSpot.x] = TILE.EXIT;
        place(exitSpot, "portal", SPRITE_TEX.PORTAL);
    }

    const zonesWithFeat: Array<[Band, ZoneFeatures, Map<number, number>]> = [
        [z1, z1Feat, z1Dist],
        [z2, z2Feat, z2Dist],
        [z3, z3Feat, z3Dist],
    ];

    // --- hourglasses on mid-distance dead ends ---
    const hgCandidates: Array<{ x: number; y: number }> = [];
    for (const [band, feat, dist] of zonesWithFeat) {
        const maxD = Math.max(...dist.values());
        for (const e of feat.deadEnds) {
            if (!occupied.has(key(e.x, e.y)) && e.d >= 8 && e.d <= maxD * 0.9) {
                hgCandidates.push(e);
            }
        }
    }
    // pseudo-shuffle so different seeds pick different spots
    hgCandidates.sort(() => rng() - 0.5);
    for (const spot of hgCandidates) {
        if (items.filter((i) => i.kind === "hourglass").length >= hourglassesWanted) break;
        if (occupied.has(key(spot.x, spot.y))) continue;
        place(spot, "hourglass", SPRITE_TEX.HOURGLASS);
    }

    // --- lanterns at big intersections (mental anchors) ---
    for (const [band, feat] of zonesWithFeat) {
        let count = 0;
        for (const spot of feat.intersections) {
            if (count >= 2 || spot.d < 5) continue;
            if (occupied.has(key(spot.x, spot.y))) continue;
            place(spot, "lantern", band.zone === 1 ? SPRITE_TEX.LANTERN_RED
                : band.zone === 2 ? SPRITE_TEX.LANTERN_BLUE : SPRITE_TEX.LANTERN_GOLD);
            count++;
        }
    }

    // --- a light sprinkle of torches ---
    let torches = 0;
    for (const [band] of zonesWithFeat) {
        for (const cy of band.ys) {
            if (torches >= 12) break;
            for (let cx = 1; cx <= width - 2; cx++) {
                if (torches >= 12) break;
                if (tiles[cy]![cx] !== TILE.FLOOR) continue;
                if (occupied.has(key(cx, cy))) continue;
                if (rng() >= 0.03) continue;
                place({ x: cx, y: cy }, "torch", SPRITE_TEX.TORCH);
                torches++;
            }
        }
    }

    return {
        width,
        height,
        tiles,
        zone,
        start: {
            x: startCell[0] + 0.5,
            y: startCell[1] + 0.5,
            dirX: 0, // facing the next zone up
            dirY: -1,
            planeX: 0.66,
            planeY: 0,
        },
        doors,
        items,
    };
}
