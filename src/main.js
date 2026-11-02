import { World } from './sim/world.js';
import { Ship } from './sim/ship.js';
import { Asteroid } from './sim/asteroid.js';
import { Pickup } from './sim/pickup.js';
import { HomingBehavior } from './sim/composition.js';
import { handleCollisions } from './sim/collision.js';

const canvas = document.getElementById('canvas') || document.querySelector('canvas');
const ctx = canvas.getContext('2d');

const world = new World(window.innerWidth, window.innerHeight);

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  world.width = canvas.width;
  world.height = canvas.height;
  if (world.generateStars) world.generateStars();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const player = new Ship(world.width / 2, world.height / 2);
world.spawn(player);

// Спавнимо 10 астероїдів
function spawnAsteroids(count) {
  for (let i = 0; i < count; i++) {
    world.spawn(new Asteroid(Math.random() * world.width, Math.random() * world.height));
  }
}
spawnAsteroids(10);

// Астероїд із самонаведенням
const homingAsteroid = new Asteroid(100, 100);
homingAsteroid.homingComponent = new HomingBehavior('ship', 1.2, 85);
world.spawn(homingAsteroid);

// Спавн першої аптечки
world.spawn(new Pickup(Math.random() * (world.width - 100) + 50, Math.random() * (world.height - 100) + 50, 'heal'));

const inputs = { left: false, right: false, thrust: false };

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputs.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') inputs.right = true;
  if (e.code === 'ArrowUp' || e.code === 'KeyW') inputs.thrust = true;

  if (e.code === 'Space') {
    player.fire(world);
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputs.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') inputs.right = false;
  if (e.code === 'ArrowUp' || e.code === 'KeyW') inputs.thrust = false;
});

let respawnTimer = 0;
let pickupTimer = 0;
let lastTime = performance.now();

function gameLoop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Респаун гравця
  if (!player.alive) {
    respawnTimer += dt;
    if (respawnTimer >= 2.0) {
      player.respawn(world.width / 2, world.height / 2);
      respawnTimer = 0;
    }
  }

  // Підтримуємо постійну кількість астероїдів (якщо стало менше 6 — додаємо нові)
  let currentAsteroids = 0;
  for (const _ of world.ofKind('asteroid')) {
    currentAsteroids++;
  }
  if (currentAsteroids < 6) {
    spawnAsteroids(3);
  }

  // Періодична поява аптечок кожні 10 секунд
  pickupTimer += dt;
  if (pickupTimer >= 10.0) {
    pickupTimer = 0;
    world.spawn(new Pickup(
      Math.random() * (world.width - 100) + 50,
      Math.random() * (world.height - 100) + 50,
      'heal'
    ));
  }

  world.step(dt, inputs);
  handleCollisions(world);

  world.draw(ctx);

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);