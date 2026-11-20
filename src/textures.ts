// Procedural 64x64 textures packed as ABGR (little-endian RGBA),
// matching Screen's Uint32Array pixel format.

export const TEX_SIZE = 64;

function rgb(r: number, g: number, b: number): number {
    return (0xff << 24) | (b << 16) | (g << 8) | r;
}

// Deterministic per-pixel noise in [0, 1) so textures don't look flat
function noise(x: number, y: number): number {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
}

function makeTexture(fill: (x: number, y: number) => number): Uint32Array {
    const tex = new Uint32Array(TEX_SIZE * TEX_SIZE);
    for (let y = 0; y < TEX_SIZE; y++) {
        for (let x = 0; x < TEX_SIZE; x++) {
            tex[y * TEX_SIZE + x] = fill(x, y);
        }
    }
    return tex;
}

// Outer border walls: red bricks with light mortar
export function brickWall(): Uint32Array {
    return makeTexture((x, y) => {
        const row = Math.floor(y / 16);
        const bx = (x + (row % 2 === 0 ? 0 : 16)) % 32;
        const mortar = y % 16 >= 14 || bx >= 30;

        const n = noise(x, y) * 14;
        if (mortar) return rgb(160 + n, 152 + n, 142 + n);

        const shade = row % 2 === 0 ? 0 : 8;
        return rgb(138 - shade + n, 60 - shade * 0.5 + n, 50 - shade * 0.5 + n);
    });
}

// Interior obstacles: stone blocks with beveled edges
export function stoneWall(): Uint32Array {
    return makeTexture((x, y) => {
        const bx = x % 32;
        const by = y % 32;
        const n = noise(x, y) * 14;

        const top = by < 2 || bx < 2 ? 16 : 0; // lit bevel
        const bottom = by > 29 || bx > 29 ? -18 : 0; // shadowed bevel

        return rgb(94 + n + top + bottom, 96 + n + top + bottom, 102 + n + top + bottom);
    });
}

// Floor: large checker slabs with grout lines
export function floorTiles(): Uint32Array {
    return makeTexture((x, y) => {
        if (x % 32 < 1 || y % 32 < 1) return rgb(46, 44, 42);

        const checker = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
        const base = checker ? 86 : 72;
        const n = noise(x, y) * 10;
        return rgb(base + n, base - 4 + n, base - 8 + n);
    });
}

// Ceiling: dark wooden planks
export function ceiling(): Uint32Array {
    return makeTexture((x, y) => {
        const row = Math.floor(y / 16);
        const gap = y % 16 >= 15;
        const n = noise(x, y) * 8;

        if (gap) return rgb(36 + n, 27 + n, 21 + n);

        const tone = ((row * 37) % 12) - 6; // per-plank tone variation
        return rgb(58 + tone + n, 44 + tone * 0.8 + n, 34 + tone * 0.6 + n);
    });
}

// Wall-mounted torch sprite. Transparent background (alpha 0) so the top and
// bottom of the column don't render; the flame sits in the upper-middle so the
// sprite reads as mounted on the wall when drawn at full column height.
export function torch(): Uint32Array {
    return makeTexture((x, y) => {
        const dx = (x - 32) / 9;
        const dy = (y - 30) / 12;
        const d = dx * dx + dy * dy;

        // flame
        if (d <= 1) {
            const flicker = noise(x, y) * 30;
            if (d < 0.3) return rgb(255, 235 - flicker, 130);
            if (d < 0.65) return rgb(255 - flicker, 165 - flicker * 0.5, 45);
            return rgb(205 - flicker, 85 - flicker * 0.4, 28);
        }

        // handle / bracket
        if (x >= 30 && x <= 33 && y >= 42 && y <= 58) return rgb(72, 50, 36);
        if (x >= 27 && x <= 36 && y >= 56 && y <= 60) return rgb(48, 45, 44);

        return 0; // transparent
    });
}

// Recolor a packed ABGR texture by multiplying each channel.
export function tint(
    tex: Uint32Array,
    fr: number,
    fg: number,
    fb: number,
): Uint32Array {
    const out = new Uint32Array(tex.length);
    for (let i = 0; i < tex.length; i++) {
        const c = tex[i]!;
        if (c >>> 24 === 0) continue; // keep transparent pixels

        const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
        const r = cl((c & 0xff) * fr);
        const g = cl(((c >>> 8) & 0xff) * fg);
        const b = cl(((c >>> 16) & 0xff) * fb);
        out[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }
    return out;
}

// Mossy stone: green blotches over a stone base
export function mossWall(): Uint32Array {
    return makeTexture((x, y) => {
        const blotch = Math.sin(x * 0.42) * Math.cos(y * 0.33);
        const n = noise(x, y) * 12;
        const base = blotch > 0.25 ? [56, 96, 46] : [92, 98, 88];
        return rgb(base[0]! + n, base[1]! + n, base[2]! + n);
    });
}

// Hazard stripes: black/yellow diagonals
export function hazardWall(): Uint32Array {
    return makeTexture((x, y) => {
        const stripe = (x + y) % 24 < 10;
        const n = noise(x, y) * 16;
        return stripe
            ? rgb(196 + n, 164 + n, 36)
            : rgb(38 + n, 36 + n, 34 + n);
    });
}

// Door with a colored banner and keycard slot
export function doorWall(r: number, g: number, b: number): Uint32Array {
    return makeTexture((x, y) => {
        const n = noise(x, y) * 8;
        // dark frame
        if (x < 3 || x > 60 || y < 3 || y > 60) return rgb(48, 44, 42);
        // vertical planks
        if (x % 12 === 0) return rgb(58, 50, 44);
        // colored banner band
        if (y >= 26 && y <= 38) return rgb(r + n, g + n, b + n);
        // keycard slot
        if (x >= 44 && x <= 52 && y >= 46 && y <= 50) return rgb(24, 22, 22);
        // door body
        return rgb(96 + n, 78 + n, 58 + n);
    });
}

// Keycard sprite: colored card with a white stripe and chip
export function keySprite(r: number, g: number, b: number): Uint32Array {
    return makeTexture((x, y) => {
        if (x < 16 || x > 48 || y < 20 || y > 44) return 0;
        if (y >= 26 && y <= 29) return rgb(250, 250, 250);
        if (x >= 22 && x <= 32 && y >= 34 && y <= 40) return rgb(235, 235, 235);
        const n = noise(x, y) * 14;
        return rgb(r + n, g + n, b + n);
    });
}

// Hourglass sprite
export function hourglassSprite(): Uint32Array {
    return makeTexture((x, y) => {
        // wooden caps
        if (y >= 12 && y <= 15 && x >= 18 && x <= 46) return rgb(84, 62, 40);
        if (y >= 49 && y <= 52 && x >= 18 && x <= 46) return rgb(84, 62, 40);

        const t = y - 16;
        const b = 51 - y;
        const half = Math.min(t, b); // distance from the pinch at y=33/34
        if (half < 0 || half > 16) return 0;
        const halfWidth = Math.max(3, Math.floor(half * 0.8) + 4);
        if (Math.abs(x - 32) > halfWidth) return 0;

        const sand = half < 8 ? (y < 33 ? y >= 26 : y <= 40) : false;
        if (sand) return rgb(240, 200, 80);
        return rgb(190, 205, 215);
    });
}

// Lantern sprite: dark pole with a glowing colored cage
export function lanternSprite(r: number, g: number, b: number): Uint32Array {
    return makeTexture((x, y) => {
        if (x >= 30 && x <= 33 && y >= 34 && y <= 58) return rgb(56, 50, 48);
        if (x >= 24 && x <= 39 && y >= 12 && y <= 34) {
            const glow = Math.abs(x - 31) < 5 && y >= 16 && y <= 30;
            if (glow) return rgb(r, g, b);
            return rgb(48, 44, 44);
        }
        return 0;
    });
}

// Breadcrumb sprite: small glowing dot
export function crumbSprite(): Uint32Array {
    return makeTexture((x, y) => {
        const d = Math.hypot(x - 32, y - 32);
        if (d <= 4) return rgb(255, 225, 130);
        if (d <= 9) return rgb(210, 150, 60);
        return 0;
    });
}

// Exit portal sprite: bright green arch
export function portalSprite(): Uint32Array {
    return makeTexture((x, y) => {
        const inArch = x >= 18 && x <= 45 && y >= 6 && y <= 58;
        if (!inArch) return 0;
        const inCore = x >= 24 && x <= 39 && y >= 12 && y <= 52;
        if (inCore) {
            const n = noise(x, y) * 20;
            return rgb(120 + n, 255, 170 + n);
        }
        return rgb(30, 150, 70);
    });
}

// ---------------------------------------------------------------------------
// The original "texture streaming" pack from commit 8ef0432, restored as a
// selectable render style: brighter bricks with mortar on every row, deeply
// beveled stone with an inner frame, grid-lined floor, and a ceiling with a
// centered light fixture and crossbeams.
// ---------------------------------------------------------------------------

export class Textures {
    private textures = new Map<number, Uint32Array>();
    private fallback: Uint32Array;

    constructor() {
        this.fallback = this.createCheckerboard();
        this.textures.set(1, this.createBrick());
        this.textures.set(2, this.createBeveledStone());
        this.textures.set(10, this.createFloorTiles());
        this.textures.set(11, this.createCeilingGrid());

        // themed wings and doors for the escape-run tile ids
        this.textures.set(3, Textures.tint(this.get(1), 1.0, 0.72, 0.65));
        this.textures.set(4, Textures.tint(this.get(2), 0.8, 0.9, 1.3));
        this.textures.set(5, Textures.tint(this.get(2), 0.72, 1.15, 0.72));
        this.textures.set(6, this.createHazard());
        this.textures.set(20, this.createDoor(200, 60, 60));
        this.textures.set(21, this.createDoor(60, 90, 200));
        this.textures.set(22, this.createDoor(210, 170, 50));
    }

    get(id: number): Uint32Array {
        return this.textures.get(id) ?? this.fallback;
    }

    static tint(
        tex: Uint32Array,
        fr: number,
        fg: number,
        fb: number,
    ): Uint32Array {
        const out = new Uint32Array(tex.length);
        for (let i = 0; i < tex.length; i++) {
            const c = tex[i]!;
            const cl = (v: number) => Math.max(0, Math.min(255, Math.floor(v)));
            const r = cl((c & 0xff) * fr);
            const g = cl(((c >>> 8) & 0xff) * fg);
            const b = cl(((c >>> 16) & 0xff) * fb);
            out[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
        }
        return out;
    }

    private createHazard(): Uint32Array {
        const arr = new Uint32Array(64 * 64);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const n = this.noise(x, y) * 0.5;
                const stripe = (x + y) % 24 < 10;
                arr[y * 64 + x] = stripe
                    ? this.packRGB(196 + n, 164 + n, 36)
                    : this.packRGB(38 + n, 36 + n, 34 + n);
            }
        }
        return arr;
    }

    private createDoor(r: number, g: number, b: number): Uint32Array {
        const arr = new Uint32Array(64 * 64);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const n = this.noise(x, y) * 0.5;
                if (x < 3 || x > 60 || y < 3 || y > 60) {
                    arr[y * 64 + x] = this.packRGB(48, 44, 42);
                } else if (x % 12 === 0) {
                    arr[y * 64 + x] = this.packRGB(58, 50, 44);
                } else if (y >= 26 && y <= 38) {
                    arr[y * 64 + x] = this.packRGB(r + n, g + n, b + n);
                } else if (x >= 44 && x <= 52 && y >= 46 && y <= 50) {
                    arr[y * 64 + x] = this.packRGB(24, 22, 22);
                } else {
                    arr[y * 64 + x] = this.packRGB(96 + n, 78 + n, 58 + n);
                }
            }
        }
        return arr;
    }

    private packRGB(r: number, g: number, b: number): number {
        const cr = Math.max(0, Math.min(255, Math.floor(r)));
        const cg = Math.max(0, Math.min(255, Math.floor(g)));
        const cb = Math.max(0, Math.min(255, Math.floor(b)));
        return (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0;
    }

    private noise(x: number, y: number): number {
        let n = (x * 374761393 + y * 668265263) ^ (x * 1274126177);
        n = (n ^ (n >> 13)) * 1274126177;
        return ((n ^ (n >> 16)) & 31) - 16;
    }

    private createCheckerboard(): Uint32Array {
        const arr = new Uint32Array(64 * 64);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const sector = Math.floor(x / 8) + Math.floor(y / 8);
                arr[y * 64 + x] = sector % 2 === 0 ? 0xffffffff : 0xffff0000;
            }
        }
        return arr;
    }

    private createBrick(): Uint32Array {
        const arr = new Uint32Array(64 * 64);
        for (let y = 0; y < 64; y++) {
            const row = Math.floor(y / 8);
            const offsetX = row % 2 === 1 ? 16 : 0;

            for (let x = 0; x < 64; x++) {
                const n = this.noise(x, y);
                const isMortar = y % 8 === 0 || (x + offsetX) % 32 === 0;

                if (isMortar) {
                    arr[y * 64 + x] = this.packRGB(150 + n, 150 + n, 145 + n);
                } else {
                    const rowTint = ((row * 7) % 15) - 7;
                    arr[y * 64 + x] = this.packRGB(
                        155 + n + rowTint,
                        52 + n + rowTint,
                        42 + n + rowTint,
                    );
                }
            }
        }
        return arr;
    }

    private createBeveledStone(): Uint32Array {
        const arr = new Uint32Array(64 * 64);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const n = this.noise(x, y);
                let r = 105 + n;
                let g = 112 + n;
                let b = 122 + n;

                // 3D beveled outer rim
                if (x < 3 || y < 3) {
                    r += 40;
                    g += 40;
                    b += 40;
                } else if (x > 60 || y > 60) {
                    r -= 40;
                    g -= 40;
                    b -= 40;
                }

                // Inner architectural frame
                const inBounds = x >= 10 && x <= 53 && y >= 10 && y <= 53;
                const onFrame =
                    inBounds && (x === 10 || x === 53 || y === 10 || y === 53);

                if (onFrame) {
                    r -= 30;
                    g -= 30;
                    b -= 30;
                }

                arr[y * 64 + x] = this.packRGB(r, g, b);
            }
        }
        return arr;
    }

    private createFloorTiles(): Uint32Array {
        const arr = new Uint32Array(64 * 64);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const n = this.noise(x, y) * 0.5;
                if (x % 32 === 0 || y % 32 === 0) {
                    arr[y * 64 + x] = this.packRGB(42, 44, 48);
                } else {
                    arr[y * 64 + x] = this.packRGB(68 + n, 70 + n, 76 + n);
                }
            }
        }
        return arr;
    }

    private createCeilingGrid(): Uint32Array {
        const arr = new Uint32Array(64 * 64);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const n = this.noise(x, y) * 0.3;

                if (x >= 26 && x <= 37 && y >= 26 && y <= 37) {
                    // Centered ceiling light fixture
                    arr[y * 64 + x] = this.packRGB(145, 140, 125);
                } else if (x < 2 || x > 61 || y < 2 || y > 61) {
                    // Structural crossbeam
                    arr[y * 64 + x] = this.packRGB(52, 55, 62);
                } else {
                    arr[y * 64 + x] = this.packRGB(34 + n, 36 + n, 42 + n);
                }
            }
        }
        return arr;
    }
}
