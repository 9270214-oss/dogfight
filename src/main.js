import { World } from './sim/world.js';
import { Ship } from './sim/ship.js';
import { Asteroid } from './sim/asteroid.js';
import { Pickup } from './sim/pickup.js';
import { HomingBehavior } from './sim/composition.js';
import { handleCollisions } from './sim/collision.js';

import { loadAll } from './assets/loader.js';
import { drawLoadingScreen } from './render/loadingScreen.js';
import { audioManager } from './audio/audio.js';
import { showLobby } from './ui/lobby.js';

let canvas = document.getElementById('canvas') || document.querySelector('canvas');
if (!canvas) {
  canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  document.body.appendChild(canvas);
}
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

async function init() {
  drawLoadingScreen(ctx, canvas.width, canvas.height, 0, "Завантаження ресурсів...");

  try {
    const loadedAssets = await loadAll('/assets/manifest.json', {
      onProgress: (progress) => {
        drawLoadingScreen(ctx, canvas.width, canvas.height, progress);
      }
    });

    drawLoadingScreen(ctx, canvas.width, canvas.height, 1, "Ресурси завантажено!");

    // Показуємо лобі кімнат
    const selectedRoom = await showLobby();
    console.log(`[Lobby] Обрана кімната: ${selectedRoom.name}`);

    // Запускаємо гру із передачею вибраної кімнати
    startGame(loadedAssets, selectedRoom);

  } catch (err) {
    console.error('Помилка асинхронного запуску:', err);
    drawLoadingScreen(ctx, canvas.width, canvas.height, 0, `Помилка: ${err.message}`);
  }
}

function startGame(assets, room) {
  // Ініціалізація та підготовка Web Audio API
  audioManager.init(assets.audio);

  const world = new World(canvas.width, canvas.height);

  // Визначаємо складність залежно від кімнати
  let initialAsteroidCount = 10;
  let minAsteroidCount = 6;

  if (room?.id === 'room-2') { // Оріон-Бета (Важко)
    initialAsteroidCount = 18;
    minAsteroidCount = 12;
  } else if (room?.id === 'room-3') { // Тренувальна арена (Легко)
    initialAsteroidCount = 4;
    minAsteroidCount = 2;
  }

  const player = new Ship(world.width / 2, world.height / 2);
  world.spawn(player);

  function spawnAsteroids(count) {
    for (let i = 0; i < count; i++) {
      world.spawn(new Asteroid(Math.random() * world.width, Math.random() * world.height));
    }
  }
  spawnAsteroids(initialAsteroidCount);

  // Астероїд із самонаведенням
  const homingAsteroid = new Asteroid(100, 100);
  homingAsteroid.homingComponent = new HomingBehavior('ship', 1.2, 85);
  world.spawn(homingAsteroid);

  world.spawn(new Pickup(Math.random() * (world.width - 100) + 50, Math.random() * (world.height - 100) + 50, 'heal'));

  const inputs = { left: false, right: false, thrust: false };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputs.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') inputs.right = true;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') inputs.thrust = true;
    if (e.code === 'Space') player.fire(world);
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

    if (!player.alive) {
      respawnTimer += dt;
      if (respawnTimer >= 2.0) {
        player.respawn(world.width / 2, world.height / 2);
        respawnTimer = 0;
      }
    }

    let currentAsteroids = 0;
    for (const _ of world.ofKind('asteroid')) {
      currentAsteroids++;
    }
    if (currentAsteroids < minAsteroidCount) {
      spawnAsteroids(3);
    }

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

    // Малюємо назву кімнати у верхньому куті Canvas
    ctx.save();
    ctx.fillStyle = '#00ffcc';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Кімната: ${room ? room.name : 'Локальна'}`, 20, 30);
    ctx.restore();

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
}

init();