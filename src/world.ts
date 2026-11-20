export class WorldMap {
    readonly TILE_SIZE = 10;
    readonly width: number;
    readonly height: number;
    private tiles: number[][];

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.tiles = this.init(width, height);
    }

    init(width: number, height: number): number[][] {
        const output: number[][] = [];

        for (let y = 0; y < height; y++) {
            output.push([]);

            for (let x = 0; x < width; x++) {
                if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                    output[y]![x] = 1;
                } else {
                    output[y]![x] = Math.random() < 0.8 ? 0 : 2;
                }
            }
        }

        return output;
    }

    getTile(x: number, y: number): number {
        return this.tiles[y]?.[x] ?? 1;
    }
}

export class Player {
    private readonly movementSpeed = 3;

    posX: number;
    posY: number;
    dirX: number;
    dirY: number;
    planeX: number;
    planeY: number;

    constructor() {
        this.posX = 2.5;
        this.posY = 2.5;
        this.dirX = 1; // facing along the x-axis (to the right)
        this.dirY = 0;
        this.planeX = 0;
        this.planeY = 0.66; // 0.66 of 1 (dir) is 66 deg FOV
    }

    move(forward: number, strafe: number, dt: number, worldMap: WorldMap) {
        const moveX = this.dirX * forward + -this.dirY * strafe;
        const moveY = this.dirY * forward + this.dirX * strafe;

        let dx = moveX * this.movementSpeed * dt;
        let dy = moveY * this.movementSpeed * dt;

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

        if (worldMap.getTile(lookAheadX, checkY) === 0) {
            this.posX += dx;
        }

        if (worldMap.getTile(checkX, lookAheadY) === 0) {
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
