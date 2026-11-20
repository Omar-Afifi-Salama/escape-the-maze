// Central tuning knobs for the escape run.
export const CONFIG = {
    // maze: CELLS cells per full dimension -> (2*CELLS+1)^2 grid
    GRID_CELLS: 15,
    TIME_LIMIT: 300,
    HOURGLASS_BONUS: 15,
    DOOR_OPEN_DIST: 1.2,
    DOOR_OPEN_TIME: 0.6,
    PICKUP_DIST: 0.6,
    MAX_CRUMBS: 40,
    TENSION_TIME: 30,

    // feel
    MOVE_SPEED: 3.5, // tiles per second
    TURN_SPEED: 3.0, // radians per second
    FOV_MIN: 60,
    FOV_MAX: 110,
    FOV_DEFAULT: 80,

    // hud
    SHOW_MINIMAP: false,
} as const;

// per-difficulty maze + pacing parameters
export const DIFFICULTIES = {
    easy: { zoneCellsW: 11, zoneCellsH: 4, braid: 0.25, timeLimit: 360, viewDist: 16, hourglasses: 4 },
    medium: { zoneCellsW: 15, zoneCellsH: 5, braid: 0.12, timeLimit: 300, viewDist: 14, hourglasses: 3 },
    hard: { zoneCellsW: 19, zoneCellsH: 6, braid: 0.04, timeLimit: 300, viewDist: 11, hourglasses: 2 },
} as const;

export type Difficulty = keyof typeof DIFFICULTIES;
