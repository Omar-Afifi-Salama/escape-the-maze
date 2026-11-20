import { Screen } from "./screen.js";
import { Textures } from "./textures.js";
import { WorldMap, Player } from "./world.js";

export class Renderer {
    private screen: Screen;
    private worldMap: WorldMap;
    private player: Player;
    private zBuffer: number[];
    private textures: Textures;

    constructor(screen: Screen, worldMap: WorldMap, player: Player) {
        this.screen = screen;
        this.worldMap = worldMap;
        this.player = player;
        this.zBuffer = new Array(screen.width).fill(0);
        this.textures = new Textures();
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
        // this.screen.pixels.fill(
        //     0xff1a1a1a,
        //     0,
        //     (this.screen.width * this.screen.height) / 2,
        // );
        // this.screen.pixels.fill(
        //     0xff3a3a3a,
        //     (this.screen.width * this.screen.height) / 2,
        // );
        this.screen.pixels.fill(0xff000000);

        const floorTex = this.textures.get(10);
        const ceilTex = this.textures.get(11);

        const rayDirX0 = this.player.dirX - this.player.planeX;
        const rayDirY0 = this.player.dirY - this.player.planeY;

        const rayDirX1 = this.player.dirX + this.player.planeX;
        const rayDirY1 = this.player.dirY + this.player.planeY;

        for (
            let y = Math.floor(this.screen.height / 2) + 1;
            y < this.screen.height - 1;
            y++
        ) {
            const p = Math.floor(y - this.screen.height / 2);
            const rowDistance = (0.5 * this.screen.height) / p;

            const floorStepX =
                (rowDistance * (rayDirX1 - rayDirX0)) / this.screen.width;
            const floorStepY =
                (rowDistance * (rayDirY1 - rayDirY0)) / this.screen.width;

            let floorX = this.player.posX + rowDistance * rayDirX0;
            let floorY = this.player.posY + rowDistance * rayDirY0;

            for (let x = 0; x < this.screen.width; x++) {
                // 1. Grab the fractional part of (floorX, floorY) and map to 0..63
                const tx = Math.floor(64 * (floorX - Math.floor(floorX))) & 63;
                const ty = Math.floor(64 * (floorY - Math.floor(floorY))) & 63;

                // 2. Advance world coordinates one pixel to the right
                floorX += floorStepX;
                floorY += floorStepY;

                // 4. Draw the floor pixel AND its mirrored ceiling pixel above the horizon
                this.screen.setPixel(x, y, floorTex[ty * 64 + tx]!);
                this.screen.setPixel(
                    x,
                    this.screen.height - y - 1,
                    ceilTex[ty * 64 + tx]!,
                );
            }
        }

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

            let wallX =
                side === 0
                    ? this.player.posY + perpWallDist * rayDirY
                    : this.player.posX + perpWallDist * rayDirX;
            wallX -= Math.floor(wallX);

            let texX = Math.floor(wallX * 64);

            if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) {
                texX = 64 - texX - 1;
            }

            const lineHeight = Math.floor(this.screen.height / perpWallDist);

            // Clamp start/end so we never loop over off-screen pixels when very close to a wall
            const drawStart = Math.max(
                0,
                Math.floor(-lineHeight / 2 + this.screen.height / 2),
            );
            const drawEnd = Math.min(
                this.screen.height,
                Math.floor(lineHeight / 2 + this.screen.height / 2),
            );

            const wallTex = this.textures.get(hit);
            // How many texture pixels to advance for each 1 screen pixel downward
            const step = 64 / lineHeight;

            // Starting Y coordinate inside the 64x64 texture (accounts for off-screen clipping)
            let texPos =
                (drawStart - this.screen.height / 2 + lineHeight / 2) * step;

            for (let y = drawStart; y < drawEnd; y++) {
                // Convert float texPos to an integer row (0 - 63)
                const texY = Math.floor(texPos) & 63;
                texPos += step;

                // Sample the pixel from our 64x64 texture
                let color = wallTex[texY * 64 + texX]!;

                // Darken North/South walls (side === 1) so corners stay distinct
                if (side === 1) {
                    color = ((color >>> 1) & 0x7f7f7f7f) | 0xff000000;
                }

                this.screen.setPixel(x, y, color);
            }
        }
    }
}
