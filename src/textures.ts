export class Textures {
    private textures = new Map<number, Uint32Array>();
    private fallback: Uint32Array;

    constructor() {
        this.fallback = this.createCheckerboard();
        this.textures.set(1, this.createBrick());
        this.textures.set(2, this.createBeveledStone());
        this.textures.set(10, this.createFloorTiles());
        this.textures.set(11, this.createCeilingGrid());
    }

    get(id: number): Uint32Array {
        return this.textures.get(id) ?? this.fallback;
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
