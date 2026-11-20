import { Renderer } from "./renderer.js";
import { Screen } from "./screen.js";
import { Player, WorldMap } from "./world.js";
import { generateMaze } from "./maze.js";
import { SPRITE_TEX, TILE } from "./maze.js";
import { HUD } from "./hud.js";
import { Menu } from "./menu.js";
import { Sprite } from "./sprite.js";
import { CONFIG, DIFFICULTIES, type Difficulty } from "./config.js";
import { loadSettings, saveSettings, type Settings } from "./settings.js";

export type KeyColor = "red" | "blue" | "gold";
export type GameState = "menu" | "playing" | "paused" | "won" | "lost";

export class Game {
    state: GameState = "menu";
    seed = 0;

    world!: WorldMap;
    player!: Player;
    renderer!: Renderer;

    settings: Settings = loadSettings();
    gameMode: "timed" | "untimed" = "timed";
    difficulty: Difficulty = "medium";

    timeLeft: number = CONFIG.TIME_LIMIT;
    elapsed = 0;
    inventory = new Set<KeyColor>();
    hint = "";
    bestLeft: number | null = null;

    // unlock feedback
    flashColor: string | null = null;
    flashT = 0;
    toast = "";
    toastT = 0;

    private screen: Screen;
    private hud: HUD;
    private menu: Menu;
    // where "back" goes from settings/controls
    private menuReturn: "main" | "pause" = "main";

    constructor(screen: Screen) {
        this.screen = screen;
        this.hud = new HUD(screen);
        this.menu = new Menu();
        this.menu.onAction = (action, value) => this.onMenuAction(action, value);

        this.loadBest();
        this.newRun(Math.floor(Math.random() * 1e9));
        this.state = "menu";
        this.menu.showMain(this.mainMenuState());
    }

    // ---- run lifecycle ----

    newRun(seed: number) {
        this.seed = seed;
        const spec = DIFFICULTIES[this.difficulty];
        const maze = generateMaze(
            seed,
            this.difficulty,
            this.gameMode === "timed" ? spec.hourglasses : 0,
        );
        this.world = new WorldMap(maze);
        this.player = new Player(maze.start);
        this.player.setFov(this.settings.fovDeg);
        this.renderer = new Renderer(this.screen, this.world, this.player);
        this.renderer.setRenderMode(this.settings.renderMode);
        this.renderer.setViewDist(spec.viewDist);
        this.timeLeft = this.gameMode === "timed" ? spec.timeLimit : Infinity;
        this.elapsed = 0;
        this.inventory.clear();
        this.hint = "";
        this.state = "playing";
    }

    pause() {
        if (this.state !== "playing") return;
        this.state = "paused";
        this.menuReturn = "pause";
        this.menu.showPause();
    }

    resume() {
        if (this.state !== "paused") return;
        this.state = "playing";
        this.menu.hide();
    }

    quitToMenu() {
        this.state = "menu";
        this.menuReturn = "main";
        this.menu.showMain(this.mainMenuState());
    }

    private mainMenuState() {
        return {
            mode: this.gameMode,
            difficulty: this.difficulty,
            bestLine: this.bestLine(),
        };
    }

    // ---- menu actions ----

    private onMenuAction(action: string, value?: string) {
        switch (action) {
            case "play": {
                this.newRun(Math.floor(Math.random() * 1e9));
                this.menu.hide();
                break;
            }
            case "mode":
                this.gameMode = this.gameMode === "timed" ? "untimed" : "timed";
                this.loadBest();
                this.menu.showMain(this.mainMenuState());
                break;
            case "difficulty": {
                const order = ["easy", "medium", "hard"] as const;
                this.difficulty =
                    order[(order.indexOf(this.difficulty) + 1) % order.length]!;
                this.loadBest();
                this.menu.showMain(this.mainMenuState());
                break;
            }
            case "open-settings":
                this.menu.showSettings(this.settings);
                break;
            case "open-controls":
                this.menu.showControls();
                break;
            case "back":
                if (this.menuReturn === "pause") this.menu.showPause();
                else this.menu.showMain(this.mainMenuState());
                break;
            case "fov": {
                this.settings.fovDeg = Number(value);
                saveSettings(this.settings);
                this.player?.setFov(this.settings.fovDeg);
                break;
            }
            case "renderMode": {
                this.settings.renderMode = Number(value);
                saveSettings(this.settings);
                this.renderer?.setRenderMode(this.settings.renderMode);
                break;
            }
            case "resume":
                this.resume();
                break;
            case "restart":
                this.newRun(this.seed);
                this.menu.hide();
                break;
            case "new":
                this.newRun(Math.floor(Math.random() * 1e9));
                this.menu.hide();
                break;
            case "quit":
                this.quitToMenu();
                break;
        }
    }

    // ---- input ----

    onKeyDown(code: string) {
        if (this.state === "playing") {
            if (code === "Escape" || code === "KeyP") {
                this.pause();
                return;
            }
            if (code === "KeyR") {
                this.newRun(this.seed);
                return;
            }
            if (code === "KeyE") this.dropCrumb();
            if (code === "KeyT") {
                console.log(`render mode: ${this.renderer.toggleRenderMode()}`);
                this.settings.renderMode = this.renderer.getRenderMode();
                saveSettings(this.settings);
            }
        } else if (this.state === "paused") {
            if (code === "Escape" || code === "KeyP") this.resume();
        } else if (this.state === "menu") {
            if (code === "Enter") this.onMenuAction("play");
        } else {
            // won / lost
            if (code === "Enter") this.onMenuAction("new");
            else if (code === "Escape") this.quitToMenu();
        }
    }

    // ---- gameplay ----

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

        if (this.gameMode === "timed") {
            this.timeLeft -= dt;
            if (this.timeLeft <= 0) {
                this.timeLeft = 0;
                this.state = "lost";
                return;
            }
        } else {
            this.elapsed += dt;
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

        // doors: unlock instantly when near with the right key, else hint
        this.hint = "";
        for (const door of this.world.doors.values()) {
            if (this.world.getTile(door.x, door.y) !== door.tile) continue; // already open

            const dx = door.x + 0.5 - this.player.posX;
            const dy = door.y + 0.5 - this.player.posY;
            if (dx * dx + dy * dy > CONFIG.DOOR_OPEN_DIST ** 2) continue;

            const needed = doorColorOf(door.tile);
            if (this.inventory.has(needed)) {
                this.world.setTile(door.x, door.y, TILE.FLOOR);
                this.flashColor =
                    needed === "red" ? "#e04848" : needed === "blue" ? "#4868e0" : "#e0be32";
                this.flashT = 0.4;
                this.toast = `${needed[0]!.toUpperCase()}${needed.slice(1)} door unlocked`;
                this.toastT = 2.2;
            } else if (this.hint === "") {
                this.hint = `Locked — needs the ${needed} key`;
            }
        }

        // unlock feedback decay
        if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
        if (this.toastT > 0) this.toastT = Math.max(0, this.toastT - dt);

        // exit
        const tx = Math.floor(this.player.posX);
        const ty = Math.floor(this.player.posY);
        if (this.world.getTile(tx, ty) === TILE.EXIT) {
            this.state = "won";
            const score = this.gameMode === "timed" ? this.timeLeft : this.elapsed;
            const better =
                this.gameMode === "timed"
                    ? this.bestLeft === null || score > this.bestLeft
                    : this.bestLeft === null || score < this.bestLeft;
            if (better) {
                this.bestLeft = score;
                localStorage.setItem(this.bestKey(), String(score));
            }
            return;
        }

        // tension: fog closes in during the last 30 seconds (timed mode only)
        this.renderer.setTension(
            this.gameMode === "timed" && this.timeLeft < CONFIG.TENSION_TIME
                ? 1 - this.timeLeft / CONFIG.TENSION_TIME
                : 0,
        );
    }

    render(mapOpen: boolean) {
        if (this.state === "menu") {
            // static maze backdrop behind the menu overlay
            this.renderer.renderScene();
            this.screen.present();
            return;
        }

        this.renderer.renderScene();
        if (CONFIG.SHOW_MINIMAP) this.renderer.drawMinimap();
        this.screen.present();

        this.hud.draw(this, mapOpen);
    }

    // ---- best times ----

    private bestKey(): string {
        return `maze-escape-best-${this.gameMode}-${this.difficulty}`;
    }

    private loadBest() {
        const stored = localStorage.getItem(this.bestKey());
        this.bestLeft = stored === null ? null : Number(stored);
    }

    bestLine(): string | null {
        if (this.bestLeft === null) return null;
        return this.gameMode === "timed"
            ? `best escape (${this.difficulty}): ${fmtTime(this.bestLeft)} left`
            : `best run (${this.difficulty}): ${fmtTime(this.bestLeft)}`;
    }
}

function fmtTime(t: number): string {
    const total = Math.max(0, t);
    const mm = Math.floor(total / 60);
    const ss = Math.floor(total % 60);
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
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
