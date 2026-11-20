import { Sprite } from "./sprite.js";
import type { MazeData } from "./maze.js";
import { TILE } from "./maze.js";

export interface DoorState {
    x: number;
    y: number;
    tile: number;
    open: number; // 0 closed .. 1 fully open
}

export class WorldMap {
    readonly TILE_SIZE = 10;
    readonly width: number;
    readonly height: number;
    readonly zone: Uint8Array; // wing id per tile, for minimap coloring
    readonly visited: Uint8Array; // 0 unknown, 1 floor visited, 2 wall seen
    readonly sprites: Sprite[] = [];
    readonly doors = new Map<number, DoorState>();
    private tiles: number[][];

    constructor(maze: MazeData) {
        this.width = maze.width;
        this.height = maze.height;
        this.tiles = maze.tiles;
        this.zone = maze.zone;
        this.visited = new Uint8Array(maze.width * maze.height);

        for (const door of maze.doors) {
            this.doors.set(door.y * maze.width + door.x, {
                x: door.x,
                y: door.y,
                tile: door.tile,
                open: 0,
            });
        }

        for (const item of maze.items) {
            this.sprites.push(new Sprite(item.x, item.y, item.texId, item.kind));
        }
    }

    getTile(x: number, y: number): number {
        return this.tiles[y]?.[x] ?? TILE.BORDER;
    }

    setTile(x: number, y: number, tile: number): void {
        const row = this.tiles[y];
        if (row) row[x] = tile;
    }

    static isDoorTile(tile: number): boolean {
        return tile >= TILE.DOOR_RED && tile <= TILE.DOOR_GOLD;
    }

    doorOpenAt(x: number, y: number): number {
        return this.doors.get(y * this.width + x)?.open ?? 0;
    }

    // doors stay solid until they are almost fully open
    isSolid(x: number, y: number): boolean {
        const tile = this.getTile(x, y);
        if (tile === TILE.FLOOR || tile === TILE.EXIT) return false;
        if (WorldMap.isDoorTile(tile)) return this.doorOpenAt(x, y) < 0.9;
        return true;
    }

    // mark the ground around the player as explored (fog of war)
    reveal(px: number, py: number, radius = 2.5): void {
        const cx = Math.floor(px);
        const cy = Math.floor(py);

        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                if (dx * dx + dy * dy > radius * radius) continue;
                const x = cx + dx;
                const y = cy + dy;
                const tile = this.getTile(x, y);
                const i = y * this.width + x;

                if (tile === TILE.FLOOR || tile === TILE.EXIT) {
                    this.visited[i] = 1;
                } else {
                    // nearby walls count as "seen" so the map reads as a maze
                    if (this.visited[i] === 0) this.visited[i] = 2;
                }
            }
        }
    }

    // a ray hit this wall or door, so it has been seen
    markSeen(x: number, y: number): void {
        const i = y * this.width + x;
        if (this.visited[i] === 0) this.visited[i] = 2;
    }
}

export class Player {
    moveSpeed = 3.5; // tiles per second

    posX: number;
    posY: number;
    dirX: number;
    dirY: number;
    planeX: number;
    planeY: number;

    constructor(
        start?: { x: number; y: number; dirX: number; dirY: number; planeX: number; planeY: number },
    ) {
        this.posX = start?.x ?? 2.5;
        this.posY = start?.y ?? 2.5;
        this.dirX = start?.dirX ?? 1; // facing along the x-axis (to the right)
        this.dirY = start?.dirY ?? 0;
        this.planeX = start?.planeX ?? 0;
        this.planeY = start?.planeY ?? 0.66; // 0.66 of 1 (dir) is 66 deg FOV
    }

    // FOV in degrees: the camera plane is perpendicular to dir with
    // length tan(fov / 2), so 2 * atan(len) = fov
    setFov(fovDeg: number) {
        const len = Math.tan((fovDeg / 2) * (Math.PI / 180));
        this.planeX = -this.dirY * len;
        this.planeY = this.dirX * len;
    }

    move(forward: number, strafe: number, dt: number, worldMap: WorldMap) {
        const moveX = this.dirX * forward + -this.dirY * strafe;
        const moveY = this.dirY * forward + this.dirX * strafe;

        let dx = moveX * this.moveSpeed * dt;
        let dy = moveY * this.moveSpeed * dt;

        // moving in a diagonal reduces your speed by root(2)
        // so you don't move 44% faster by moving in a diagonal
        if (forward !== 0 && strafe !== 0) {
            dx /= Math.sqrt(2);
            dy /= Math.sqrt(2);
        }

        const lookAheadX = Math.floor(this.posX + dx + Math.sign(dx) * 0.2);
        const lookAheadY = Math.floor(this.posY + dy + Math.sign(dy) * 0.2);

        const checkX = Math.floor(this.posX);
        const checkY = Math.floor(this.posY);

        if (!worldMap.isSolid(lookAheadX, checkY)) {
            this.posX += dx;
        }

        if (!worldMap.isSolid(checkX, lookAheadY)) {
            this.posY += dy;
        }
    }

    rotate(angle: number) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // updating player vector
        const oldDirX = this.dirX;
        const oldDirY = this.dirY;

        this.dirX = oldDirX * cos - oldDirY * sin;
        this.dirY = oldDirX * sin + oldDirY * cos;

        // updating plane;
        const oldPlaneX = this.planeX;
        const oldPlaneY = this.planeY;

        this.planeX = oldPlaneX * cos - oldPlaneY * sin;
        this.planeY = oldPlaneX * sin + oldPlaneY * cos;
    }
}
