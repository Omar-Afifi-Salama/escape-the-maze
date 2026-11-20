import { Screen } from "./screen.js";
import { WorldMap, Player } from "./world.js";
import {
    TEX_SIZE,
    brickWall,
    stoneWall,
    floorTiles,
    ceiling,
    torch,
    Textures,
} from "./textures.js";

export class Renderer {
    // distance (in world units) at which fog reaches 100%
    private static readonly MAX_VIEW_DIST = 14;
    // deep indigo rgb(15, 18, 35) — also used as the clear color
    private static readonly FOG_COLOR = 0xff23120f;

    private screen: Screen;
    private worldMap: WorldMap;
    private player: Player;
    private zBuffer: number[];

    private brickTex: Uint32Array;
    private stoneTex: Uint32Array;
    private floorTex: Uint32Array;
    private ceilTex: Uint32Array;
    private torchTex: Uint32Array;

    // render style, cycled with T: 0 = textured + fog, 1 = custom textures
    // (commit 8ef0432 style, no fog), 2 = classic flat
    private static readonly MODES = [
        "textured + fog",
        "custom textures",
        "classic flat",
    ];
    private mode = 0;

    toggleRenderMode(): string {
        this.mode = (this.mode + 1) % Renderer.MODES.length;
        return Renderer.MODES[this.mode]!;
    }

    constructor(screen: Screen, worldMap: WorldMap, player: Player) {
        this.screen = screen;
        this.worldMap = worldMap;
        this.player = player;
        this.zBuffer = new Array(screen.width).fill(Infinity);

        this.brickTex = brickWall();
        this.stoneTex = stoneWall();
        this.floorTex = floorTiles();
        this.ceilTex = ceiling();
        this.torchTex = torch();
    }

    // Torchlight falloff: quadratic so nearby walls stay bright while distant
    // corridors plunge into darkness
    private getBrightness(distance: number): number {
        const factor = Math.max(0, 1 - distance / Renderer.MAX_VIEW_DIST);
        return factor * factor;
    }

    // Precomputed fog LUT: [fog level (0..127) << 8 | channel value] -> fogged channel.
    // Brightness is quantized to 128 steps (< 1% apart) — visually indistinguishable
    // from the exact lerp, but ~3x cheaper in the per-pixel hot loops.
    private fogRLut = Renderer.buildFogLut(15);
    private fogGLut = Renderer.buildFogLut(18);
    private fogBLut = Renderer.buildFogLut(35);

    private static buildFogLut(fogChannel: number): Uint8Array {
        const lut = new Uint8Array(128 * 256);

        for (let level = 0; level < 128; level++) {
            const b = level / 127;

            for (let c = 0; c < 256; c++) {
                lut[(level << 8) | c] = Math.round(c * b + fogChannel * (1 - b));
            }
        }

        return lut;
    }

    // Lerp each channel toward the fog color instead of black
    private applyFog(color: number, brightness: number): number {
        const base = ((brightness * 127.99) | 0) << 8;

        const r = this.fogRLut[base | (color & 0xff)]!;
        const g = this.fogGLut[base | ((color >>> 8) & 0xff)]!;
        const b = this.fogBLut[base | ((color >>> 16) & 0xff)]!;

        return (0xff << 24) | (b << 16) | (g << 8) | r;
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
        if (this.mode === 1) {
            this.renderSceneCustom();
        } else if (this.mode === 2) {
            this.renderSceneFlat();
        } else {
            this.renderSceneTextured();
        }

        this.drawSprites();
    }

    // shared DDA raycast for one screen column; also fills the z-buffer
    private castRay(x: number) {
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

        return { rayDirX, rayDirY, perpWallDist, side, hit };
    }

    // custom textures look from commit 8ef0432: pure black clear, unfogged
    // floor/ceiling casting with the light-fixture ceiling, walls sampled from
    // the streamed texture ids with bit-shift side darkening
    private customTextures = new Textures();

    private renderSceneCustom() {
        this.screen.pixels.fill(0xff000000);

        const floorTex = this.customTextures.get(10);
        const ceilTex = this.customTextures.get(11);

        const rayDirX0 = this.player.dirX - this.player.planeX;
        const rayDirY0 = this.player.dirY - this.player.planeY;

        const rayDirX1 = this.player.dirX + this.player.planeX;
        const rayDirY1 = this.player.dirY + this.player.planeY;

        const pixels = this.screen.pixels;
        const w = this.screen.width;
        const h = this.screen.height;

        for (let y = Math.floor(h / 2) + 1; y < h - 1; y++) {
            const p = Math.floor(y - h / 2);
            const rowDistance = (0.5 * h) / p;

            const floorStepX = (rowDistance * (rayDirX1 - rayDirX0)) / w;
            const floorStepY = (rowDistance * (rayDirY1 - rayDirY0)) / w;

            let floorX = this.player.posX + rowDistance * rayDirX0;
            let floorY = this.player.posY + rowDistance * rayDirY0;

            const floorRow = y * w;
            const ceilRow = (h - y - 1) * w;

            for (let x = 0; x < w; x++) {
                // Grab the fractional part of (floorX, floorY) and map to 0..63
                const tx = Math.floor(64 * (floorX - Math.floor(floorX))) & 63;
                const ty = Math.floor(64 * (floorY - Math.floor(floorY))) & 63;

                // Advance world coordinates one pixel to the right
                floorX += floorStepX;
                floorY += floorStepY;

                // Draw the floor pixel AND its mirrored ceiling pixel above the horizon
                pixels[floorRow + x] = floorTex[ty * 64 + tx]!;
                pixels[ceilRow + x] = ceilTex[ty * 64 + tx]!;
            }
        }

        for (let x = 0; x < w; x++) {
            const { rayDirX, rayDirY, perpWallDist, side, hit } = this.castRay(x);

            let wallX =
                side === 0
                    ? this.player.posY + perpWallDist * rayDirY
                    : this.player.posX + perpWallDist * rayDirX;
            wallX -= Math.floor(wallX);

            let texX = Math.floor(wallX * 64);

            if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) {
                texX = 64 - texX - 1;
            }

            const lineHeight = Math.floor(h / perpWallDist);

            // Clamp start/end so we never loop over off-screen pixels when very close to a wall
            const drawStart = Math.max(0, Math.floor(-lineHeight / 2 + h / 2));
            const drawEnd = Math.min(h, Math.floor(lineHeight / 2 + h / 2));

            const wallTex = this.customTextures.get(hit);
            // How many texture pixels to advance for each 1 screen pixel downward
            const step = 64 / lineHeight;

            // Starting Y coordinate inside the 64x64 texture (accounts for off-screen clipping)
            let texPos = (drawStart - h / 2 + lineHeight / 2) * step;

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

                // clamped coords — write directly to the buffer
                pixels[y * w + x] = color;
            }
        }
    }

    // classic flat look: two-tone background + solid gray walls
    private renderSceneFlat() {
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
            const { perpWallDist, side } = this.castRay(x);

            const lineHeight = Math.floor(this.screen.height / perpWallDist);

            const drawStart = Math.floor(
                -lineHeight / 2 + this.screen.height / 2,
            );

            this.screen.drawVLine(
                x,
                drawStart,
                lineHeight,
                side === 0 ? 0xff888888 : 0xff222222,
            );
        }
    }

    // textured look: floor/ceiling casting + textured, fogged walls
    private renderSceneTextured() {
        // clear to the fog color so skipped distant pixels blend seamlessly
        this.screen.pixels.fill(Renderer.FOG_COLOR);

        // leftmost / rightmost rays of the FOV, for the floor-casting pass
        const rayDirX0 = this.player.dirX - this.player.planeX;
        const rayDirY0 = this.player.dirY - this.player.planeY;
        const rayDirX1 = this.player.dirX + this.player.planeX;
        const rayDirY1 = this.player.dirY + this.player.planeY;

        // floor + ceiling casting
        const pixels = this.screen.pixels;
        const w = this.screen.width;
        const h = this.screen.height;

        for (
            let y = Math.floor(this.screen.height / 2) + 1;
            y < this.screen.height;
            y++
        ) {
            const p = Math.floor(y - this.screen.height / 2);
            const rowDistance = (0.5 * this.screen.height) / p;
            const brightness = this.getBrightness(rowDistance);

            // Skip the entire row if it's beyond MAX_VIEW_DIST (already cleared to fog!)
            if (brightness <= 0) continue;

            const floorStepX =
                (rowDistance * (rayDirX1 - rayDirX0)) / this.screen.width;
            const floorStepY =
                (rowDistance * (rayDirY1 - rayDirY0)) / this.screen.width;

            let floorX = this.player.posX + rowDistance * rayDirX0;
            let floorY = this.player.posY + rowDistance * rayDirY0;

            // rows are in-bounds by construction — write directly to the buffer
            const floorRow = y * w;
            const ceilRow = (h - y - 1) * w;

            for (let x = 0; x < w; x++) {
                const tx = Math.floor(TEX_SIZE * (floorX - Math.floor(floorX))) & 63;
                const ty = Math.floor(TEX_SIZE * (floorY - Math.floor(floorY))) & 63;

                floorX += floorStepX;
                floorY += floorStepY;

                pixels[floorRow + x] = this.applyFog(this.floorTex[ty * 64 + tx]!, brightness);
                pixels[ceilRow + x] = this.applyFog(this.ceilTex[ty * 64 + tx]!, brightness);
            }
        }

        for (let x = 0; x < this.screen.width; x++) {
            const { rayDirX, rayDirY, perpWallDist, side, hit } = this.castRay(x);

            const lineHeight = this.screen.height / perpWallDist;

            const drawStart = Math.max(
                0,
                Math.floor(-lineHeight / 2 + this.screen.height / 2),
            );
            const drawEnd = Math.min(
                this.screen.height,
                Math.floor(lineHeight / 2 + this.screen.height / 2),
            );

            // where along the wall face (0..1) the ray hit
            let wallX =
                side === 0
                    ? this.player.posY + perpWallDist * rayDirY
                    : this.player.posX + perpWallDist * rayDirX;
            wallX -= Math.floor(wallX);

            let texX = Math.floor(wallX * TEX_SIZE);
            // keep the texture oriented consistently on each face
            if (side === 0 && rayDirX > 0) texX = TEX_SIZE - 1 - texX;
            if (side === 1 && rayDirY < 0) texX = TEX_SIZE - 1 - texX;

            const wallTex = hit === 2 ? this.stoneTex : this.brickTex;

            const texStep = TEX_SIZE / lineHeight;
            let texPos = (drawStart - this.screen.height / 2 + lineHeight / 2) * texStep;

            const sideMultiplier = side === 1 ? 0.65 : 1.0;
            const wallBrightness = this.getBrightness(perpWallDist) * sideMultiplier;

            if (wallBrightness > 0) {
                for (let y = drawStart; y < drawEnd; y++) {
                    const texY = Math.floor(texPos) & 63;
                    texPos += texStep;

                    const rawColor = wallTex[texY * 64 + texX]!;
                    // y is clamped — write directly to the buffer
                    pixels[y * w + x] = this.applyFog(rawColor, wallBrightness);
                }
            }
        }
    }

    drawSprites() {
        // far to near so closer sprites overdraw distant ones
        const sprites = [...this.worldMap.sprites]
            .map((s) => ({
                sprite: s,
                distSq:
                    (s.x - this.player.posX) ** 2 + (s.y - this.player.posY) ** 2,
            }))
            .sort((a, b) => b.distSq - a.distSq);

        const invDet = 1 / (this.player.planeX * this.player.dirY - this.player.dirX * this.player.planeY);

        for (const { sprite } of sprites) {
            const spriteX = sprite.x - this.player.posX;
            const spriteY = sprite.y - this.player.posY;

            // transform into camera space (depth = transformY)
            const transformX = invDet * (this.player.dirY * spriteX - this.player.dirX * spriteY);
            const transformY = invDet * (-this.player.planeY * spriteX + this.player.planeX * spriteY);
            if (transformY <= 0.05) continue; // behind the camera

            const spriteBrightness = this.mode === 0
                ? this.getBrightness(transformY)
                : 1;
            if (spriteBrightness <= 0) continue;

            const spriteScreenX = Math.floor(
                (this.screen.width / 2) * (1 + transformX / transformY),
            );
            const spriteH = Math.abs(Math.floor(this.screen.height / transformY));
            const spriteW = spriteH; // square sprite

            const vOffset = -spriteH / 2 + this.screen.height / 2;
            const drawStartY = Math.max(0, Math.floor(vOffset));
            const drawEndY = Math.min(
                this.screen.height,
                Math.floor(spriteH / 2 + this.screen.height / 2),
            );
            const hOffset = spriteScreenX - spriteW / 2;
            const drawStartX = Math.max(0, Math.floor(hOffset));
            const drawEndX = Math.min(
                this.screen.width,
                Math.ceil(spriteScreenX + spriteW / 2),
            );

            for (let stripe = drawStartX; stripe < drawEndX; stripe++) {
                // skip stripes hidden behind walls
                if (transformY >= (this.zBuffer[stripe] ?? Infinity)) continue;

                const texX = Math.floor(((stripe - hOffset) * TEX_SIZE) / spriteW);

                for (let y = drawStartY; y < drawEndY; y++) {
                    const texY = Math.floor(((y - vOffset) * TEX_SIZE) / spriteH);

                    const color = this.torchTex[(texY & 63) * 64 + (texX & 63)]!;
                    if ((color >>> 24) === 0) continue; // transparent

                    // clamped coords — write directly to the buffer
                    this.screen.pixels[y * this.screen.width + stripe] =
                        this.applyFog(color, spriteBrightness);
                }
            }
        }
    }
}
