export class Screen {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint32Array;
    private ctx: CanvasRenderingContext2D;
    private imageData: ImageData;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        document.body.appendChild(canvas);

        this.ctx = canvas.getContext("2d")!;
        this.imageData = this.ctx.createImageData(width, height);
        this.pixels = new Uint32Array(this.imageData.data.buffer);
    }

    setPixel(x: number, y: number, color: number) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;

        this.pixels[y * this.width + x] = color;
    }

    drawRect(x: number, y: number, w: number, h: number, color: number) {
        const minRow = Math.min(y, y + h);
        const maxRow = Math.max(y, y + h);

        const minCol = Math.min(x, x + w);
        const maxCol = Math.max(x, x + w);

        for (let row = minRow; row < maxRow; row++) {
            for (let col = minCol; col < maxCol; col++) {
                this.setPixel(col, row, color);
            }
        }
    }

    drawVLine(x: number, y: number, l: number, color: number) {
        const minRow = Math.min(y, y + l);
        const maxRow = Math.max(y, y + l);

        for (let row = minRow; row < maxRow; row++) {
            this.setPixel(x, row, color);
        }
    }

    drawHLine(x: number, y: number, l: number, color: number) {
        const minCol = Math.min(x, x + l);
        const maxCol = Math.max(x, x + l);

        for (let col = minCol; col < maxCol; col++) {
            this.setPixel(col, y, color);
        }
    }

    present() {
        this.ctx.putImageData(this.imageData, 0, 0);
    }
}
