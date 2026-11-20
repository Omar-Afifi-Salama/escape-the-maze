export type SpriteKind =
    | "torch"
    | "key"
    | "hourglass"
    | "lantern"
    | "crumb"
    | "portal";

// how each kind is drawn: scale = fraction of full wall height,
// vOffset = vertical placement (-1 top of wall .. 0 center .. 1 on the floor)
export const SPRITE_STYLE: Record<
    SpriteKind,
    { scale: number; vOffset: number }
> = {
    torch: { scale: 1, vOffset: 0 },
    key: { scale: 0.35, vOffset: 0.55 },
    hourglass: { scale: 0.35, vOffset: 0.5 },
    lantern: { scale: 0.8, vOffset: 0.3 },
    crumb: { scale: 0.16, vOffset: 0.85 },
    portal: { scale: 1, vOffset: 0 },
};

export class Sprite {
    x: number;
    y: number;
    textureId: number;
    kind: SpriteKind;
    scale: number;
    vOffset: number;
    collected: boolean;

    constructor(
        x: number,
        y: number,
        textureId: number,
        kind: SpriteKind = "torch",
        scale = SPRITE_STYLE[kind].scale,
        vOffset = SPRITE_STYLE[kind].vOffset,
    ) {
        this.x = x;
        this.y = y;
        this.textureId = textureId;
        this.kind = kind;
        this.scale = scale;
        this.vOffset = vOffset;
        this.collected = false;
    }
}
