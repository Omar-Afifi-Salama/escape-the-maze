// Persistent player settings (FOV, render style).
import { CONFIG } from "./config.js";

export interface Settings {
    fovDeg: number;
    renderMode: number; // 0 textured+fog, 1 custom textures, 2 classic flat
}

const KEY = "maze-escape-settings";

const DEFAULTS: Settings = {
    fovDeg: CONFIG.FOV_DEFAULT,
    renderMode: 0,
};

export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...DEFAULTS };

        const parsed = JSON.parse(raw) as Partial<Settings>;
        return {
            fovDeg: Math.max(
                CONFIG.FOV_MIN,
                Math.min(CONFIG.FOV_MAX, Number(parsed.fovDeg ?? DEFAULTS.fovDeg)),
            ),
            renderMode: Number(parsed.renderMode ?? DEFAULTS.renderMode),
        };
    } catch {
        return { ...DEFAULTS };
    }
}

export function saveSettings(settings: Settings): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
        // storage unavailable — settings just won't persist
    }
}
