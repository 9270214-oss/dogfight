import { createLoop } from "./loop.js";
import { createInput } from "./input.js";
import { integrate } from "./sim/ship.js";
import { wrapAround } from "./sim/arena.js";
import { createCanvas } from "./render/canvas.js";
import { drawShip, drawStars, drawGrid } from "./render/draw.js";

const canvas = document.querySelector("#game");
const { context } = createCanvas(canvas);
const input = createInput();
const hud = document.createElement("div");
hud.id = "hud";
document.body.appendChild(hud);

const ship = {
  x: 400,
  y: 300,
  vx: 0,
  vy: 0,
  angle: 0,
};

const previousShip = { ...ship };

function simulate(dt) {
  Object.assign(previousShip, ship);

  integrate(ship, input, dt);
  wrapAround(ship, canvas.clientWidth, canvas.clientHeight);
}

function render(alpha) {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  drawStars(context, canvas.clientWidth, canvas.clientHeight);
  drawGrid(context, canvas.clientWidth, canvas.clientHeight);
  const angleDifference =
  Math.atan2(
    Math.sin(ship.angle - previousShip.angle),
    Math.cos(ship.angle - previousShip.angle),
  );

const renderShip = {
  ...ship,
  x: previousShip.x + (ship.x - previousShip.x) * alpha,
  y: previousShip.y + (ship.y - previousShip.y) * alpha,
  angle: previousShip.angle + angleDifference * alpha,
};
  
drawShip(context, renderShip, input.isDown("ArrowUp"));

  hud.textContent =
    `steps/s: ${loop.stepsPerSecond.toFixed(0)} | ` +
    `frames/s: ${loop.framesPerSecond.toFixed(0)} | ` +
    `frame time: ${loop.frameTime.toFixed(2)} ms`;

  input.endFrame();
}

const loop = createLoop({
  step: 1 / 60,
  simulate,
  render,
});