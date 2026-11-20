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
    BEST_KEY: "maze-escape-best",
} as const;
