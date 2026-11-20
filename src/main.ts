import { Game } from "./game.js";
import { Screen } from "./screen.js";

const keys = new Set<string>();
const screen = new Screen(960, 540);
const game = new Game(screen);

window.addEventListener("keydown", (e) => {
    keys.add(e.code);

    // keep arrows/space from scrolling the page
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
    }

    if (e.code === "KeyF" && !e.repeat) {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    }

    game.onKeyDown(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

let lastTime = performance.now();

function loop(now: number) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    game.update(dt, keys);
    game.render(keys.has("KeyM"));

    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
