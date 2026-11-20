import { Screen } from "./screen.js";
import { WorldMap, Player } from "./world.js";

export class Renderer {
    private screen: Screen;
    private worldMap: WorldMap;
    private player: Player;
    private zBuffer: number[];

    constructor(screen: Screen, worldMap: WorldMap, player: Player) {
        this.screen = screen;
        this.worldMap = worldMap;
        this.player = player;
        this.zBuffer = new Array(screen.width).fill(0);
    }

    drawMinimap() {
        const startX =
            this.screen.width +
            -1 * this.worldMap.width * this.worldMap.TILE_SIZE;
        const startY = 0;

        // background
        this.screen.drawRect(
            this.screen.width,
            startY,
            -1 * this.worldMap.width * this.worldMap.TILE_SIZE,
            startY + this.worldMap.height * this.worldMap.TILE_SIZE,
            0xff333333,
        );

        // tiles
        for (let row = 0; row < this.worldMap.height; row++) {
            for (let col = 0; col < this.worldMap.width; col++) {
                const tile = this.worldMap.getTile(col, row);

                if (tile === 0) continue;

                this.screen.drawRect(
                    startX + col * this.worldMap.TILE_SIZE,
                    startY + row * this.worldMap.TILE_SIZE,
                    this.worldMap.TILE_SIZE,
                    this.worldMap.TILE_SIZE,
                    0xff666666,
                );
            }
        }

        // player
        const centerX = startX + this.player.posX * this.worldMap.TILE_SIZE;
        const centerY = startY + this.player.posY * this.worldMap.TILE_SIZE;

        // player direction
        const maxConePixels = this.worldMap.TILE_SIZE * 4;

        // Sample every 8th screen column to draw ~80 rays across the FOV
        for (let x = 0; x < this.screen.width; x += 8) {
            const cameraX = (2 * x) / this.screen.width - 1;
            const rayDirX = this.player.dirX + this.player.planeX * cameraX;
            const rayDirY = this.player.dirY + this.player.planeY * cameraX;

            // perpWallDist is projected onto the camera plane; multiply by ray length
            // to get the true Euclidean distance along this angled ray
            const rayLength = Math.hypot(rayDirX, rayDirY);
            const hitDistPixels =
                (this.zBuffer[x] ?? 0) * rayLength * this.worldMap.TILE_SIZE;
            const clampedDist = Math.min(hitDistPixels, maxConePixels);

            // Normalize rayDir so stepping by i advances 1 pixel per iteration
            const normX = rayDirX / rayLength;
            const normY = rayDirY / rayLength;

            for (let i = 0; i < clampedDist; i++) {
                const px = Math.floor(centerX + normX * i);
                const py = Math.floor(centerY + normY * i);
                this.screen.setPixel(px, py, 0xffaaaaaa);
            }
        }

        // player dot — drawn after the ray fan so rays don't overwrite it;
        // odd size (5x5) gives an exact center pixel at (centerX, centerY)
        this.screen.drawRect(
            Math.round(centerX) - 2,
            Math.round(centerY) - 2,
            5,
            5,
            0xff0000ff,
        );
    }

    renderScene() {
        this.screen.pixels.fill(
            0xff1a1a1a,
            0,
            (this.screen.width * this.screen.height) / 2,
        );
        this.screen.pixels.fill(
            0xff3a3a3a,
            (this.screen.width * this.screen.height) / 2,
        );

        for (let x = 0; x < this.screen.width; x++) {
            const cameraX = (2 * x) / this.screen.width - 1;

            const rayDirX = this.player.dirX + this.player.planeX * cameraX;
            const rayDirY = this.player.dirY + this.player.planeY * cameraX;

            const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
            const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);

            let mapX = Math.floor(this.player.posX);
            let mapY = Math.floor(this.player.posY);

            let stepX;
            let sideDistX;
            if (rayDirX < 0) {
                stepX = -1;
                sideDistX = (this.player.posX - mapX) * deltaDistX;
            } else {
                stepX = 1;
                sideDistX = (mapX + 1.0 - this.player.posX) * deltaDistX;
            }

            let stepY;
            let sideDistY;
            if (rayDirY < 0) {
                stepY = -1;
                sideDistY = (this.player.posY - mapY) * deltaDistY;
            } else {
                stepY = 1;
                sideDistY = (mapY + 1.0 - this.player.posY) * deltaDistY;
            }

            let hit = 0;
            let side = 0;
            while (hit === 0) {
                if (sideDistX < sideDistY) {
                    sideDistX += deltaDistX;
                    mapX += stepX;
                    side = 0;
                } else {
                    sideDistY += deltaDistY;
                    mapY += stepY;
                    side = 1;
                }

                hit = this.worldMap.getTile(mapX, mapY);
            }

            const perpWallDist =
                side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;
            this.zBuffer[x] = perpWallDist;

            const lineHeight = Math.floor(this.screen.height / perpWallDist);

            const drawStart = Math.floor(
                -lineHeight / 2 + this.screen.height / 2,
            );
            // const drawEnd = Math.floor(lineHeight / 2 + this.screen.height / 2);

            this.screen.drawVLine(
                x,
                drawStart,
                lineHeight,
                side === 0 ? 0xff888888 : 0xff222222,
            );
        }
    }
}
