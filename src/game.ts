import { Renderer } from "./renderer.js";
import { Screen } from "./screen.js";
import { Player, WorldMap } from "./world.js";
import { generateMaze } from "./maze.js";
import { SPRITE_TEX, TILE } from "./maze.js";
import { HUD } from "./hud.js";
import { Sprite } from "./sprite.js";
import { CONFIG } from "./config.js";
import { loadSettings, saveSettings, type Settings } from "./settings.js";

export type KeyColor = "red" | "blue" | "gold";
export type GameState = "title" | "playing" | "won" | "lost";

export class Game {
    state: GameState = "title";
    seed = 0;

    world!: WorldMap;
    player!: Player;
    renderer!: Renderer;

    timeLeft: number = CONFIG.TIME_LIMIT;
    inventory = new Set<KeyColor>();
    hint = "";
    bestLeft: number | null = null;

    settings: Settings = loadSettings();
    gameMode: "timed" | "untimed" = "timed";
    difficulty: "easy" | "medium" | "hard" = "medium";

    private screen: Screen;
    private hud: HUD;

    constructor(screen: Screen) {
        this.screen = screen;
        this.hud = new HUD(screen);

        this.loadBest();
        this.newRun(Math.floor(Math.random() * 1e9));
    }

    private bestKey(): string {
        return `maze-escape-best-${this.gameMode}-${this.difficulty}`;
    }

    private loadBest() {
        const stored = localStorage.getItem(this.bestKey());
        this.bestLeft = stored === null ? null : Number(stored);
    }

    newRun(seed: number) {
        this.seed = seed;
        const maze = generateMaze(seed);
        this.world = new WorldMap(maze);
        this.player = new Player(maze.start);
        this.player.setFov(this.settings.fovDeg);
        this.renderer = new Renderer(this.screen, this.world, this.player);
        this.renderer.setRenderMode(this.settings.renderMode);
        this.timeLeft = CONFIG.TIME_LIMIT;
        this.inventory.clear();
        this.hint = "";
        this.state = "playing";
    }

    onKeyDown(code: string) {
        if (this.state !== "playing") {
            if (code === "Enter") this.newRun(Math.floor(Math.random() * 1e9));
            return;
        }

        if (code === "KeyR") this.newRun(Math.floor(Math.random() * 1e9));
        if (code === "KeyE") this.dropCrumb();
        if (code === "KeyT") console.log(`render mode: ${this.renderer.toggleRenderMode()}`);
    }

    // drop a glowing breadcrumb at the player's feet (E key)
    private dropCrumb() {
        const crumbs = this.world.sprites.filter((s) => s.kind === "crumb");
        if (crumbs.length >= CONFIG.MAX_CRUMBS) {
            const oldest = crumbs[0]!;
            const i = this.world.sprites.indexOf(oldest);
            if (i >= 0) this.world.sprites.splice(i, 1);
        }

        const style = { scale: 0.16, vOffset: 0.85 };
        this.world.sprites.push(
            new Sprite(this.player.posX, this.player.posY, SPRITE_TEX.CRUMB, "crumb", style.scale, style.vOffset),
        );
    }

    update(dt: number, keys: Set<string>) {
        if (this.state !== "playing") return;

        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.state = "lost";
            return;
        }

        // movement
        let forward = 0;
        let strafe = 0;
        let turn = 0;

        if (keys.has("KeyW") || keys.has("ArrowUp")) forward += 1;
        if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= 1;
        if (keys.has("KeyD")) strafe += 1;
        if (keys.has("KeyA")) strafe -= 1;
        if (keys.has("ArrowRight")) turn += 1;
        if (keys.has("ArrowLeft")) turn -= 1;

        this.player.move(forward, strafe, dt, this.world);
        this.player.rotate(turn * CONFIG.TURN_SPEED * dt);

        // fog of war
        this.world.reveal(this.player.posX, this.player.posY);

        // pickups
        for (const sprite of this.world.sprites) {
            if (sprite.collected || (sprite.kind !== "key" && sprite.kind !== "hourglass")) {
                continue;
            }

            const dx = sprite.x - this.player.posX;
            const dy = sprite.y - this.player.posY;
            if (dx * dx + dy * dy > CONFIG.PICKUP_DIST ** 2) continue;

            sprite.collected = true;
            if (sprite.kind === "key") {
                this.inventory.add(keyColorOf(sprite.textureId));
            } else {
                this.timeLeft += CONFIG.HOURGLASS_BONUS;
            }
        }

        // doors: open when near with the right key, else hint
        this.hint = "";
        for (const door of this.world.doors.values()) {
            const dx = door.x + 0.5 - this.player.posX;
            const dy = door.y + 0.5 - this.player.posY;
            if (dx * dx + dy * dy > CONFIG.DOOR_OPEN_DIST ** 2) continue;

            const needed = doorColorOf(door.tile);
            if (this.inventory.has(needed)) {
                door.open = Math.min(1, door.open + dt / CONFIG.DOOR_OPEN_TIME);
            } else if (door.open < 0.9 && this.hint === "") {
                this.hint = `Locked — needs the ${needed} key`;
            }
        }

        // exit
        const tx = Math.floor(this.player.posX);
        const ty = Math.floor(this.player.posY);
        if (this.world.getTile(tx, ty) === TILE.EXIT) {
            this.state = "won";
            if (this.bestLeft === null || this.timeLeft > this.bestLeft) {
                this.bestLeft = this.timeLeft;
                localStorage.setItem(this.bestKey(), String(this.timeLeft));
            }
            return;
        }

        // tension: fog closes in during the last 30 seconds (textured mode only)
        this.renderer.setTension(
            this.timeLeft < CONFIG.TENSION_TIME
                ? 1 - this.timeLeft / CONFIG.TENSION_TIME
                : 0,
        );
    }

    render(mapOpen: boolean) {
        if (this.state === "title") {
            this.screen.pixels.fill(0xff000000);
            this.screen.present();
            this.hud.drawTitle(this.bestLeft);
            return;
        }

        this.renderer.renderScene();
        this.renderer.drawMinimap();
        this.screen.present();

        this.hud.draw(this, mapOpen);
    }
}

function keyColorOf(textureId: number): KeyColor {
    if (textureId === SPRITE_TEX.KEY_BLUE) return "blue";
    if (textureId === SPRITE_TEX.KEY_GOLD) return "gold";
    return "red";
}

function doorColorOf(tile: number): KeyColor {
    if (tile === TILE.DOOR_BLUE) return "blue";
    if (tile === TILE.DOOR_GOLD) return "gold";
    return "red";
}
