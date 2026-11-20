import { Renderer } from "./renderer.js";
import { Screen } from "./screen.js";
import { Player, WorldMap } from "./world.js";

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
    keys.add(e.code);

    if (e.code === "KeyF" && !e.repeat) {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    }

    if (e.code === "KeyT" && !e.repeat) {
        console.log(`render mode: ${renderer.toggleRenderMode()}`);
    }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

const screen = new Screen(960, 540);
const worldMap = new WorldMap(16, 16);
const player = new Player();
const renderer = new Renderer(screen, worldMap, player);

let lastTime = performance.now();
const rotSpeed = 2.5;

let forward = 0;
let strafe = 0;
let turn = 0;

function render(now: number) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    forward = 0;
    strafe = 0;
    turn = 0;

    if (keys.has("KeyW") || keys.has("ArrowUp")) forward += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= 1;

    if (keys.has("KeyD")) strafe += 1;
    if (keys.has("KeyA")) strafe -= 1;

    if (keys.has("ArrowRight")) turn += 1;
    if (keys.has("ArrowLeft")) turn -= 1;

    player.move(forward, strafe, dt, worldMap);
    player.rotate(turn * rotSpeed * dt);

    renderer.renderScene();

    renderer.drawMinimap();

    screen.present();

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
