import type { Screen } from "./screen.js";
import type { Game } from "./game.js";
import type { WorldMap } from "./world.js";
import { TILE } from "./maze.js";
import { CONFIG } from "./config.js";

function fmt(t: number): string {
    const total = Math.max(0, t);
    const mm = Math.floor(total / 60);
    const ss = Math.floor(total % 60);
    const tenth = Math.floor((total * 10) % 10);
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${tenth}`;
}

const KEY_COLORS: Array<{ name: "red" | "blue" | "gold"; css: string }> = [
    { name: "red", css: "#e04848" },
    { name: "blue", css: "#4868e0" },
    { name: "gold", css: "#e0be32" },
];

// minimap colors for the full-map overlay (css, per zone)
const ZONE_FLOOR_CSS = ["#2c2c2c", "#381c18", "#1c2238", "#1e301c", "#38301a"];
const ZONE_WALL_CSS = ["#969696", "#aa4638", "#4664aa", "#468c3c", "#aa8c32"];

export class HUD {
    private ctx: CanvasRenderingContext2D;
    private width: number;
    private height: number;

    constructor(screen: Screen) {
        this.ctx = screen.context;
        this.width = screen.width;
        this.height = screen.height;
    }

    drawTitle(bestLeft: number | null) {
        const { ctx, width: w, height: h } = this;
        ctx.clearRect(0, 0, w, h);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 64px monospace";
        ctx.fillText("ESCAPE THE MAZE", w / 2, h / 2 - 90);

        ctx.font = "22px monospace";
        ctx.fillStyle = "#aaaaaa";
        ctx.fillText(
            "Find the 3 keys, unlock the wings, reach the green portal",
            w / 2,
            h / 2 - 30,
        );
        ctx.fillText("before the torchlight runs out.", w / 2, h / 2 - 4);

        ctx.fillStyle = "#888888";
        ctx.font = "18px monospace";
        const lines = [
            "WASD / arrows — move & turn      E — drop breadcrumb",
            "hold M — full explored map       T — render style",
            "F — fullscreen                   Enter — start",
        ];
        lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + 50 + i * 26));

        if (bestLeft !== null) {
            ctx.fillStyle = "#e0be32";
            ctx.font = "bold 22px monospace";
            ctx.fillText(`best escape: ${fmt(bestLeft)} left`, w / 2, h - 60);
        }

        const blink = Math.floor(performance.now() / 500) % 2 === 0;
        if (blink) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 26px monospace";
            ctx.fillText("press ENTER", w / 2, h - 24);
        }
    }

    draw(game: Game, mapOpen: boolean) {
        const { ctx, width: w } = this;
        const playing = game.state === "playing";

        // HUD text gets a dark outline so it reads over bright walls
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = 4;

        // timer / stopwatch
        const timed = game.gameMode === "timed";
        if (timed) {
            const urgent = game.timeLeft < CONFIG.TENSION_TIME;
            const pulse = urgent && Math.floor(performance.now() / 250) % 2 === 0;
            ctx.fillStyle = pulse ? "#ff5544" : urgent ? "#ffaa88" : "#ffffff";
            ctx.font = "bold 28px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(fmt(game.timeLeft), 14, 21);
        } else {
            ctx.fillStyle = "#9fd8ff";
            ctx.font = "bold 28px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(fmt(game.elapsed), 14, 21);
        }

        // keycard icons
        let x = 150;
        for (const key of KEY_COLORS) {
            ctx.globalAlpha = game.inventory.has(key.name) ? 1 : 0.2;
            ctx.fillStyle = key.css;
            ctx.fillRect(x, 12, 34, 18);
            ctx.globalAlpha = 1;
            ctx.fillStyle = "#000000";
            ctx.font = "bold 14px monospace";
            ctx.textAlign = "center";
            ctx.fillText(key.name[0]!.toUpperCase(), x + 17, 22);
            x += 44;
        }

        // seed — bottom-right corner, small and faint
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#ffffff";
        ctx.font = "15px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`seed ${game.seed}`, w - 12, this.height - 16);
        ctx.globalAlpha = 1;
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // locked-door hint
        if (playing && game.hint) {
            ctx.fillStyle = "#ffcc44";
            ctx.font = "bold 22px monospace";
            ctx.textAlign = "center";
            ctx.fillText(game.hint, w / 2, this.height - 34);
        }

        // unlock toast + colored flash
        if (game.toastT > 0) {
            ctx.globalAlpha = Math.min(1, game.toastT);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 24px monospace";
            ctx.textAlign = "center";
            ctx.fillText(game.toast, w / 2, 70);
            ctx.globalAlpha = 1;
        }
        if (game.flashT > 0 && game.flashColor) {
            ctx.globalAlpha = (game.flashT / 0.4) * 0.3;
            ctx.fillStyle = game.flashColor;
            ctx.fillRect(0, 0, w, this.height);
            ctx.globalAlpha = 1;
        }

        if (mapOpen) this.drawMapOverlay(game);

        if (game.state === "won" || game.state === "lost") {
            this.drawEnd(game);
        }
    }

    // big overlay: everything explored so far — the "paper maze" view,
    // with a vision cone showing where you are and what you can see
    private drawMapOverlay(game: Game) {
        const world = game.world;
        const player = game.player;
        const { ctx, width: w, height: h } = this;
        // fit the whole grid inside the window, then center both axes
        const ts = Math.max(1, Math.floor(Math.min(w / world.width, h / world.height)));
        const mapW = world.width * ts;
        const mapH = world.height * ts;
        const ox = Math.floor((w - mapW) / 2);
        const oy = Math.floor((h - mapH) / 2);

        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.fillRect(0, 0, w, h);

        for (let y = 0; y < world.height; y++) {
            for (let x = 0; x < world.width; x++) {
                const i = y * world.width + x;
                const seen = world.visited[i]!;
                if (seen === 0) continue;

                const tile = world.getTile(x, y);
                let css: string;

                if (tile === TILE.DOOR_RED) css = "#e04848";
                else if (tile === TILE.DOOR_BLUE) css = "#4868e0";
                else if (tile === TILE.DOOR_GOLD) css = "#e0be32";
                else if (tile === TILE.EXIT) css = "#2cd264";
                else {
                    const zone = world.zone[i]!;
                    css = seen === 2 ? ZONE_WALL_CSS[zone]! : ZONE_FLOOR_CSS[zone]!;
                }

                ctx.fillStyle = css;
                ctx.fillRect(ox + x * ts, oy + y * ts, ts - 1, ts - 1);
            }
        }

        // vision cone: from this frame's ray distances, so it stops at walls
        const rays = game.renderer.getRaySamples(48);
        const dirAngle = Math.atan2(player.dirY, player.dirX);
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, mapW, mapH);
        ctx.clip();

        ctx.beginPath();
        ctx.moveTo(ox + player.posX * ts, oy + player.posY * ts);
        for (const { angle, dist } of rays) {
            const a = dirAngle + angle;
            ctx.lineTo(
                ox + (player.posX + Math.cos(a) * dist) * ts,
                oy + (player.posY + Math.sin(a) * dist) * ts,
            );
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // player dot
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(
            ox + Math.floor(player.posX * ts) - 3,
            oy + Math.floor(player.posY * ts) - 3,
            6,
            6,
        );
        ctx.restore();

        ctx.strokeStyle = "#444444";
        ctx.strokeRect(ox - 1, oy - 1, mapW + 2, mapH + 2);
    }

    private drawEnd(game: Game) {
        const { ctx, width: w, height: h } = this;
        const won = game.state === "won";

        ctx.fillStyle = won ? "rgba(0,40,10,0.72)" : "rgba(60,0,0,0.72)";
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = won ? "#7dff9a" : "#ff6666";
        ctx.font = "bold 72px monospace";
        ctx.fillText(won ? "ESCAPED!" : "TIME'S UP", w / 2, h / 2 - 60);

        ctx.fillStyle = "#ffffff";
        ctx.font = "26px monospace";
        if (won) {
            const line = game.gameMode === "timed"
                ? `escaped with ${fmt(game.timeLeft)} left`
                : `escaped in ${fmt(game.elapsed)}`;
            ctx.fillText(line, w / 2, h / 2 + 4);
            if (game.bestLeft !== null) {
                ctx.fillStyle = "#e0be32";
                ctx.fillText(game.bestLine() ?? "", w / 2, h / 2 + 40);
            }
        } else {
            ctx.fillText("the torchlight won this time.", w / 2, h / 2 + 4);
        }

        const blink = Math.floor(performance.now() / 500) % 2 === 0;
        if (blink) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 24px monospace";
            ctx.fillText("press ENTER for a new maze", w / 2, h - 60);
        }
    }
}
