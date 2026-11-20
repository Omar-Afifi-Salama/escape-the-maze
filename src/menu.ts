// HTML menu overlays (main menu, pause, settings, controls).
// Built as DOM on top of the canvas so the FOV slider is a real input
// and buttons work with the mouse.
import type { Settings } from "./settings.js";
import { CONFIG } from "./config.js";

export interface MainMenuState {
    mode: "timed" | "untimed";
    difficulty: "easy" | "medium" | "hard";
    bestLine: string | null;
}

export type MenuScreen = "main" | "pause" | "settings" | "controls" | "none";

export class Menu {
    private root: HTMLElement;
    onAction: (action: string, value?: string) => void = () => {};

    constructor() {
        const root = document.getElementById("menu-root");
        if (!root) throw new Error("missing #menu-root element");
        this.root = root;
    }

    hide() {
        this.root.replaceChildren();
        this.root.classList.add("hidden");
    }

    private open(children: HTMLElement[]) {
        this.root.replaceChildren(...children);
        this.root.classList.remove("hidden");
    }

    private el(tag: string, className: string | null, text?: string): HTMLElement {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    private button(label: string, action: string, small = false): HTMLButtonElement {
        const b = document.createElement("button");
        b.className = small ? "menu-btn small" : "menu-btn";
        b.textContent = label;
        b.addEventListener("click", () => this.onAction(action));
        return b;
    }

    private title(text: string): HTMLElement {
        return this.el("h1", "menu-title", text);
    }

    showMain(state: MainMenuState) {
        const overlay = this.el("div", "menu-overlay");
        overlay.appendChild(this.title("ESCAPE THE MAZE"));

        overlay.appendChild(
            this.el(
                "p",
                "menu-sub",
                "Climb the three zones, find the keys, open the doors, reach the green portal.",
            ),
        );

        overlay.appendChild(this.button("play", "play"));

        const modeBtn = this.button(`mode: ${state.mode}`, "mode");
        const diffBtn = this.button(`difficulty: ${state.difficulty}`, "difficulty");
        overlay.appendChild(modeBtn);
        overlay.appendChild(diffBtn);

        overlay.appendChild(this.button("settings", "open-settings"));
        overlay.appendChild(this.button("controls", "open-controls"));

        if (state.bestLine) {
            overlay.appendChild(this.el("div", "menu-best", state.bestLine));
        }

        overlay.appendChild(this.el("div", "menu-hint", "enter also starts a run"));
        this.open([overlay]);
    }

    showPause() {
        const overlay = this.el("div", "menu-overlay");
        overlay.appendChild(this.title("PAUSED"));
        overlay.appendChild(this.button("resume", "resume"));
        overlay.appendChild(this.button("settings", "open-settings"));
        overlay.appendChild(this.button("controls", "open-controls"));
        overlay.appendChild(this.button("restart (same seed)", "restart"));
        overlay.appendChild(this.button("new maze", "new"));
        overlay.appendChild(this.button("quit to menu", "quit"));
        overlay.appendChild(this.el("div", "menu-hint", "esc / p resumes"));
        this.open([overlay]);
    }

    showSettings(settings: Settings) {
        const overlay = this.el("div", "menu-overlay");
        overlay.appendChild(this.title("SETTINGS"));

        // FOV slider
        const fovRow = this.el("div", "menu-row");
        fovRow.appendChild(this.el("span", null, "field of view"));
        const fovLabel = this.el("span", null, `${Math.round(settings.fovDeg)}°`);
        fovLabel.style.minWidth = "48px";
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(CONFIG.FOV_MIN);
        slider.max = String(CONFIG.FOV_MAX);
        slider.step = "1";
        slider.value = String(settings.fovDeg);
        slider.addEventListener("input", () => {
            const v = Number(slider.value);
            fovLabel.textContent = `${v}°`;
            this.onAction("fov", String(v));
        });
        fovRow.appendChild(slider);
        fovRow.appendChild(fovLabel);
        overlay.appendChild(fovRow);

        // render style
        const styleRow = this.el("div", "menu-row");
        styleRow.appendChild(this.el("span", null, "render style"));
        const select = document.createElement("select");
        const options = [
            ["0", "textured + fog"],
            ["1", "custom textures"],
            ["2", "classic flat"],
        ] as const;
        for (const [value, label] of options) {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        }
        select.value = String(settings.renderMode);
        select.addEventListener("change", () =>
            this.onAction("renderMode", select.value),
        );
        styleRow.appendChild(select);
        overlay.appendChild(styleRow);

        overlay.appendChild(this.button("back", "back", true));
        this.open([overlay]);
    }

    showControls() {
        const overlay = this.el("div", "menu-overlay");
        overlay.appendChild(this.title("CONTROLS"));

        const list = this.el("div", "menu-controls");
        const entries: Array<[string, string]> = [
            ["W A S D / ↑ ↓", "move"],
            ["← →", "turn"],
            ["E", "drop breadcrumb"],
            ["M / Tab (hold)", "explored map + vision cone"],
            ["Esc / P", "pause"],
            ["F", "fullscreen"],
            ["T", "cycle render style"],
            ["R", "restart this seed"],
        ];
        for (const [key, action] of entries) {
            const line = this.el("div", null);
            const k = this.el("b", null, key);
            line.appendChild(k);
            line.appendChild(document.createTextNode(action));
            list.appendChild(line);
        }
        overlay.appendChild(list);

        overlay.appendChild(this.button("back", "back", true));
        this.open([overlay]);
    }
}
