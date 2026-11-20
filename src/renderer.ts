import { Screen } from "./screen.js";
import { WorldMap, Player } from "./world.js";
import {
    TEX_SIZE,
    brickWall,
    stoneWall,
    floorTiles,
    ceiling,
    torch,
    tint,
    mossWall,
    hazardWall,
    doorWall,
    keySprite,
    hourglassSprite,
    lanternSprite,
    crumbSprite,
    portalSprite,
    Textures,
} from "./textures.js";
import { TILE, SPRITE_TEX } from "./maze.js";

function abgr(r: number, g: number, b: number): number {
    return (0xff << 24) | (b << 16) | (g << 8) | r;
}

export class Renderer {
    // render style, cycled with T: 0 = textured + fog, 1 = custom textures
    // (commit 8ef0432 style, no fog), 2 = classic flat
    private static readonly MODES = [
        "textured + fog",
        "custom textures",
        "classic flat",
    ];
    private mode = 0;

    private screen: Screen;
    private worldMap: WorldMap;
    private player: Player;
    private zBuffer: number[];

    // fog: dark indigo by default, shifted toward red as the timer runs out
    private static readonly DEFAULT_MAX_VIEW_DIST = 14;
    private baseViewDist = Renderer.DEFAULT_MAX_VIEW_DIST;
    private maxViewDist = Renderer.DEFAULT_MAX_VIEW_DIST;
    private fogR = 15;
    private fogG = 18;
    private fogB = 35;
    private fogColor = abgr(15, 18, 35);
    private tensionQ = -1;

    // Precomputed fog LUT: [fog level (0..127) << 8 | channel value] -> fogged channel.
    // Brightness is quantized to 128 steps (< 1% apart) — visually indistinguishable
    // from the exact lerp, but ~3x cheaper in the per-pixel hot loops.
    private fogRLut = this.buildFogLut(this.fogR);
    private fogGLut = this.buildFogLut(this.fogG);
    private fogBLut = this.buildFogLut(this.fogB);

    private brickTex: Uint32Array;
    private stoneTex: Uint32Array;
    private floorTex: Uint32Array;
    private ceilTex: Uint32Array;
    private redWallTex: Uint32Array;
    private blueWallTex: Uint32Array;
    private mossTex: Uint32Array;
    private hazardTex: Uint32Array;
    private doorRedTex: Uint32Array;
    private doorBlueTex: Uint32Array;
    private doorGoldTex: Uint32Array;
    private torchTex: Uint32Array;
    private spriteTex = new Map<number, Uint32Array>();

    private customTextures = new Textures();

    constructor(screen: Screen, worldMap: WorldMap, player: Player) {
        this.screen = screen;
        this.worldMap = worldMap;
        this.player = player;
        this.zBuffer = new Array(screen.width).fill(Infinity);

        this.brickTex = brickWall();
        this.stoneTex = stoneWall();
        this.floorTex = floorTiles();
        this.ceilTex = ceiling();
        this.redWallTex = tint(this.brickTex, 1.0, 0.72, 0.65);
        this.blueWallTex = tint(this.stoneTex, 0.8, 0.9, 1.3);
        this.mossTex = mossWall();
        this.hazardTex = hazardWall();
        this.doorRedTex = doorWall(200, 60, 60);
        this.doorBlueTex = doorWall(60, 90, 200);
        this.doorGoldTex = doorWall(210, 170, 50);
        this.torchTex = torch();

        this.spriteTex.set(SPRITE_TEX.TORCH, this.torchTex);
        this.spriteTex.set(SPRITE_TEX.KEY_RED, keySprite(220, 60, 60));
        this.spriteTex.set(SPRITE_TEX.KEY_BLUE, keySprite(70, 100, 230));
        this.spriteTex.set(SPRITE_TEX.KEY_GOLD, keySprite(230, 190, 50));
        this.spriteTex.set(SPRITE_TEX.HOURGLASS, hourglassSprite());
        this.spriteTex.set(SPRITE_TEX.LANTERN_RED, lanternSprite(255, 110, 80));
        this.spriteTex.set(SPRITE_TEX.LANTERN_BLUE, lanternSprite(90, 140, 255));
        this.spriteTex.set(SPRITE_TEX.LANTERN_GREEN, lanternSprite(110, 235, 120));
        this.spriteTex.set(SPRITE_TEX.LANTERN_GOLD, lanternSprite(255, 210, 70));
        this.spriteTex.set(SPRITE_TEX.CRUMB, crumbSprite());
        this.spriteTex.set(SPRITE_TEX.PORTAL, portalSprite());
    }

    toggleRenderMode(): string {
        this.mode = (this.mode + 1) % Renderer.MODES.length;
        return Renderer.MODES[this.mode]!;
    }

    setRenderMode(mode: number): void {
        const n = Renderer.MODES.length;
        this.mode = ((Math.round(mode) % n) + n) % n;
    }

    getRenderMode(): number {
        return this.mode;
    }

    // Torchlight falloff: quadratic so nearby walls stay bright while distant
    // corridors plunge into darkness
    private getBrightness(distance: number): number {
        const factor = Math.max(0, 1 - distance / this.maxViewDist);
        return factor * factor;
    }

    // base view distance per difficulty
    setViewDist(v: number): void {
        this.baseViewDist = v;
        if (this.tensionQ <= 0) this.maxViewDist = v;
    }

    // As the timer runs out: tighten the view distance and shift fog toward red
    setTension(t: number): void {
        const q = Math.round(Math.max(0, Math.min(1, t)) * 16) / 16;
        if (q === this.tensionQ) return;
        this.tensionQ = q;

        this.maxViewDist = Math.max(6, this.baseViewDist - 6 * q);
        this.fogR = Math.round(15 + (40 - 15) * q);
        this.fogG = Math.round(18 + (8 - 18) * q);
        this.fogB = Math.round(35 + (10 - 35) * q);
        this.fogColor = abgr(this.fogR, this.fogG, this.fogB);

        // rebuild the LUTs for the new fog color (at most 17x per run)
        this.fogRLut = this.buildFogLut(this.fogR);
        this.fogGLut = this.buildFogLut(this.fogG);
        this.fogBLut = this.buildFogLut(this.fogB);
    }

    private buildFogLut(fogChannel: number): Uint8Array {
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

    private wallTexFor(id: number): Uint32Array {
        switch (id) {
            case TILE.HUB: return this.stoneTex;
            case TILE.RED: return this.redWallTex;
            case TILE.BLUE: return this.blueWallTex;
            case TILE.MOSS: return this.mossTex;
            case TILE.HAZARD: return this.hazardTex;
            case TILE.DOOR_RED: return this.doorRedTex;
            case TILE.DOOR_BLUE: return this.doorBlueTex;
            case TILE.DOOR_GOLD: return this.doorGoldTex;
            default: return this.brickTex;
        }
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

    // shared DDA raycast for one screen column; also fills the z-buffer and
    // marks walls seen on the minimap
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
        let perpWallDist = 30;
        let steps = 0;

        while (steps++ < 128) {
            if (sideDistX < sideDistY) {
                sideDistX += deltaDistX;
                mapX += stepX;
                side = 0;
            } else {
                sideDistY += deltaDistY;
                mapY += stepY;
                side = 1;
            }

            const tile = this.worldMap.getTile(mapX, mapY);
            if (tile === TILE.FLOOR || tile === TILE.EXIT) continue;

            hit = tile;
            perpWallDist =
                side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;
            break;
        }

        this.zBuffer[x] = perpWallDist;

        // seen walls appear on the minimap
        if (perpWallDist <= 6) this.worldMap.markSeen(mapX, mapY);

        return { rayDirX, rayDirY, perpWallDist, side, hit };
    }

    // classic flat look: two-tone background + per-tile solid colors
    private static flatColors = new Map<number, number>([
        [TILE.BORDER, abgr(136, 136, 136)],
        [TILE.HUB, abgr(176, 176, 176)],
        [TILE.RED, abgr(150, 70, 60)],
        [TILE.BLUE, abgr(70, 90, 150)],
        [TILE.MOSS, abgr(80, 120, 70)],
        [TILE.HAZARD, abgr(150, 130, 50)],
        [TILE.DOOR_RED, abgr(210, 60, 60)],
        [TILE.DOOR_BLUE, abgr(60, 90, 210)],
        [TILE.DOOR_GOLD, abgr(210, 170, 50)],
    ]);

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
            const { perpWallDist, side, hit } = this.castRay(x);

            const lineHeight = Math.floor(this.screen.height / perpWallDist);

            const drawStart = Math.floor(
                -lineHeight / 2 + this.screen.height / 2,
            );

            let color =
                Renderer.flatColors.get(hit) ?? abgr(136, 136, 136);
            if (side === 1) color = ((color >>> 1) & 0x7f7f7f7f) | 0xff000000;

            this.screen.drawVLine(x, drawStart, lineHeight, color);
        }
    }

    // textured look: floor/ceiling casting + textured, fogged walls
    private renderSceneTextured() {
        // clear to the fog color so skipped distant pixels blend seamlessly
        this.screen.pixels.fill(this.fogColor);

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

            // Skip the entire row if it's beyond max view dist (already cleared to fog!)
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

        for (let x = 0; x < w; x++) {
            const { rayDirX, rayDirY, perpWallDist, side, hit } = this.castRay(x);

            const lineHeight = h / perpWallDist;

            const drawStart = Math.max(0, Math.floor(-lineHeight / 2 + h / 2));
            const drawEnd = Math.min(h, Math.floor(lineHeight / 2 + h / 2));

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

            const wallTex = this.wallTexFor(hit);

            const texStep = TEX_SIZE / lineHeight;
            let texPos = (drawStart - h / 2 + lineHeight / 2) * texStep;

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

    // custom textures look from commit 8ef0432: pure black clear, unfogged
    // floor/ceiling casting, walls sampled from the streamed texture ids with
    // bit-shift side darkening
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
                const tx = Math.floor(64 * (floorX - Math.floor(floorX))) & 63;
                const ty = Math.floor(64 * (floorY - Math.floor(floorY))) & 63;

                floorX += floorStepX;
                floorY += floorStepY;

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

            const drawStart = Math.max(0, Math.floor(-lineHeight / 2 + h / 2));
            const drawEnd = Math.min(h, Math.floor(lineHeight / 2 + h / 2));

            const wallTex = this.customTextures.get(hit);
            const step = 64 / lineHeight;

            let texPos = (drawStart - h / 2 + lineHeight / 2) * step;

            for (let y = drawStart; y < drawEnd; y++) {
                const texY = Math.floor(texPos) & 63;
                texPos += step;

                let color = wallTex[texY * 64 + texX]!;

                if (side === 1) {
                    color = ((color >>> 1) & 0x7f7f7f7f) | 0xff000000;
                }

                pixels[y * w + x] = color;
            }
        }
    }

    drawSprites() {
        // far to near so closer sprites overdraw distant ones
        const sprites = this.worldMap.sprites
            .filter((s) => !s.collected)
            .map((s) => ({
                sprite: s,
                distSq:
                    (s.x - this.player.posX) ** 2 + (s.y - this.player.posY) ** 2,
            }))
            .sort((a, b) => b.distSq - a.distSq);

        const invDet = 1 / (this.player.planeX * this.player.dirY - this.player.dirX * this.player.planeY);

        const pixels = this.screen.pixels;
        const w = this.screen.width;
        const h = this.screen.height;

        for (const { sprite } of sprites) {
            const spriteX = sprite.x - this.player.posX;
            const spriteY = sprite.y - this.player.posY;

            // transform into camera space (depth = transformY)
            const transformX = invDet * (this.player.dirY * spriteX - this.player.dirX * spriteY);
            const transformY = invDet * (-this.player.planeY * spriteX + this.player.planeX * spriteY);
            if (transformY <= 0.15) continue; // behind or on top of the camera

            const brightness = this.mode === 0 ? this.getBrightness(transformY) : 1;
            if (brightness <= 0) continue;

            const tex = this.spriteTex.get(sprite.textureId) ?? this.torchTex;

            const fullH = h / transformY; // wall height in px at this depth
            const spriteH = Math.max(2, Math.floor(fullH * sprite.scale));
            const spriteW = spriteH; // square sprites

            const centerX = (w / 2) * (1 + transformX / transformY);
            // vOffset: -1 = top of wall, 0 = center, 1 = sitting on the floor
            const centerY = h / 2 + (fullH / 2) * sprite.vOffset;
            const vTop = centerY - spriteH / 2;
            const hLeft = centerX - spriteW / 2;

            const drawStartY = Math.max(0, Math.floor(vTop));
            const drawEndY = Math.min(h, Math.ceil(centerY + spriteH / 2));
            const drawStartX = Math.max(0, Math.floor(hLeft));
            const drawEndX = Math.min(w, Math.ceil(centerX + spriteW / 2));

            for (let stripe = drawStartX; stripe < drawEndX; stripe++) {
                // skip stripes hidden behind walls
                if (transformY >= (this.zBuffer[stripe] ?? Infinity)) continue;

                const texX = Math.floor(((stripe - hLeft) * TEX_SIZE) / spriteW);

                for (let y = drawStartY; y < drawEndY; y++) {
                    const texY = Math.floor(((y - vTop) * TEX_SIZE) / spriteH);

                    const color = tex[(texY & 63) * 64 + (texX & 63)]!;
                    if ((color >>> 24) === 0) continue; // transparent

                    // clamped coords — write directly to the buffer
                    pixels[y * w + stripe] = this.applyFog(color, brightness);
                }
            }
        }
    }

    // fog-of-war minimap: player-centered scrolling window over explored tiles
    drawMinimap() {
        const view = 15; // tiles shown across
        const scale = 10; // px per tile
        const size = view * scale;
        const ox = this.screen.width - size - 6;
        const oy = 6;
        const half = (view - 1) / 2;

        // panel
        this.screen.drawRect(ox - 2, oy - 2, size + 4, size + 4, 0xff101010);

        const cx = Math.floor(this.player.posX);
        const cy = Math.floor(this.player.posY);
        const world = this.worldMap;

        for (let row = cy - half; row <= cy + half; row++) {
            for (let col = cx - half; col <= cx + half; col++) {
                const seen = world.visited[row * world.width + col] ?? 0;
                if (seen === 0) continue;

                const tile = world.getTile(col, row);
                let color: number;

                if (WorldMap.isDoorTile(tile)) {
                    color =
                        tile === TILE.DOOR_RED
                            ? abgr(230, 60, 60)
                            : tile === TILE.DOOR_BLUE
                              ? abgr(60, 90, 230)
                              : abgr(230, 190, 50);
                } else if (tile === TILE.EXIT) {
                    color = abgr(60, 210, 100);
                } else {
                    const zone = world.zone[row * world.width + col] ?? 0;
                    color =
                        seen === 2
                            ? WALL_MINI[zone]!
                            : FLOOR_MINI[zone]!;
                }

                const sx = ox + (col - (cx - half)) * scale;
                const sy = oy + (row - (cy - half)) * scale;
                this.screen.drawRect(sx, sy, scale, scale, color);
            }
        }

        // breadcrumbs
        for (const s of world.sprites) {
            if (s.kind !== "crumb") continue;
            const dx = Math.round((s.x - (cx - half)) * scale);
            const dy = Math.round((s.y - (cy - half)) * scale);
            if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
            this.screen.drawRect(ox + dx - 2, oy + dy - 2, 4, 4, abgr(255, 190, 80));
        }

        // ray fan
        const maxConePixels = scale * 2.5;
        const centerX = ox + (this.player.posX - (cx - half)) * scale;
        const centerY = oy + (this.player.posY - (cy - half)) * scale;

        for (let x = 0; x < this.screen.width; x += 24) {
            const cameraX = (2 * x) / this.screen.width - 1;
            const rayDirX = this.player.dirX + this.player.planeX * cameraX;
            const rayDirY = this.player.dirY + this.player.planeY * cameraX;

            const rayLength = Math.hypot(rayDirX, rayDirY);
            const hitDistPixels =
                (this.zBuffer[x] ?? 0) * rayLength * scale;
            const clampedDist = Math.min(hitDistPixels, maxConePixels);

            const normX = rayDirX / rayLength;
            const normY = rayDirY / rayLength;

            for (let i = 0; i < clampedDist; i++) {
                const px = Math.floor(centerX + normX * i);
                const py = Math.floor(centerY + normY * i);
                this.screen.setPixel(px, py, 0xffaaaaaa);
            }
        }

        // player dot at the panel center
        this.screen.drawRect(
            Math.round(centerX) - 2,
            Math.round(centerY) - 2,
            5,
            5,
            0xff0000ff,
        );
    }
}

// minimap colors per zone (0 hub, 1 red, 2 blue, 3 moss, 4 hazard)
const FLOOR_MINI: Record<number, number> = {
    0: abgr(52, 52, 52),
    1: abgr(58, 28, 24),
    2: abgr(28, 34, 58),
    3: abgr(30, 48, 28),
    4: abgr(58, 48, 20),
};

const WALL_MINI: Record<number, number> = {
    0: abgr(150, 150, 150),
    1: abgr(170, 70, 60),
    2: abgr(70, 100, 180),
    3: abgr(70, 140, 60),
    4: abgr(180, 140, 50),
};
