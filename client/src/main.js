import { World } from './sim/world.js';
import { Ship } from './sim/ship.js';
import { Asteroid } from './sim/asteroid.js';
import { Pickup } from './sim/pickup.js';
import { handleCollisions } from './sim/collision.js';
import { ParticleSystem } from './render/particles.js';

import { loadAll } from './assets/loader.js';
import { drawLoadingScreen } from './render/loadingScreen.js';
import { audioManager } from './audio/audio.js';
import { showLobby } from './ui/lobby.js';

let myPlayerId = null;
let myScore = 0;
let winScoreTarget = 100;
const remotePlayers = new Map();
let currentGameWorld = null;
let localPlayerRef = null;
let initialWorldState = null;
let isWaveRequestPending = false;
let isGameOver = false;

// VFX та Трясіння камери
const particleSystem = new ParticleSystem();
let shakeTimer = 0;
let shakeIntensity = 0;

// Трекер для відстеження знищення БУДЬ-ЯКОГО астероїда
const trackedAsteroids = new Map();

function triggerScreenShake(intensity = 6, duration = 0.25) {
  shakeIntensity = intensity;
  shakeTimer = duration;
}

// Універсальна функція: гарантує вибух для кожного знищеного астероїда
function updateAsteroidVFX() {
  if (!currentGameWorld || typeof currentGameWorld.ofKind !== 'function') return;

  const currentAsteroids = new Set(currentGameWorld.ofKind('asteroid') || []);

  // 1. Перевіряємо астероїди, які зникли або загинули
  for (const [ast, pos] of trackedAsteroids.entries()) {
    if (!currentAsteroids.has(ast) || ast.alive === false) {
      if (!ast._explodedVFX) {
        ast._explodedVFX = true;
        particleSystem.createExplosion(pos.x, pos.y, '#00ffcc', 28);
        triggerScreenShake(5, 0.18);
      }
      trackedAsteroids.delete(ast);
    }
  }

  // 2. Оновлюємо останні координати живих астероїдів
  currentAsteroids.forEach((ast) => {
    if (ast.alive !== false && !ast._explodedVFX) {
      const ax = ast.x ?? ast.pos?.x ?? ast.position?.x ?? 0;
      const ay = ast.y ?? ast.pos?.y ?? ast.position?.y ?? 0;
      trackedAsteroids.set(ast, { x: ax, y: ay });
    }
  });
}

const socket = new WebSocket('ws://localhost:3000');

socket.addEventListener('open', () => {
  console.log('[WS Client] Підключено!');
});

socket.addEventListener('message', (event) => {
  try {
    const { type, payload } = JSON.parse(event.data);

    if (type === 'INIT_SELF') {
      myPlayerId = payload.id;
      if (payload.winScore) winScoreTarget = payload.winScore;
      if (payload.worldState) initialWorldState = payload.worldState;
      if (Array.isArray(payload.existingPlayers)) {
        payload.existingPlayers.forEach((p) => {
          remotePlayers.set(p.id, { hp: 100, score: 0, ...p });
        });
      }
    } else if (type === 'PLAYER_JOINED') {
      remotePlayers.set(payload.id, { hp: 100, score: 0, ...payload });
    } else if (type === 'PLAYER_MOVED') {
      const existing = remotePlayers.get(payload.id) || { hp: 100, score: 0 };
      remotePlayers.set(payload.id, { ...existing, ...payload });
    } else if (type === 'PLAYER_DISCONNECTED') {
      remotePlayers.delete(payload.id);
    } else if (type === 'PLAYER_FIRE' && currentGameWorld && !isGameOver) {
      const remoteShip = new Ship(payload.x, payload.y);
      remoteShip.angle = payload.angle;
      remoteShip.fire(currentGameWorld);
      if (audioManager.play) audioManager.play('laser');
    } else if (type === 'PLAYER_HIT') {
      triggerScreenShake(7, 0.2);

      if (payload.attackerId === myPlayerId) {
        myScore = payload.attackerScore;
      } else {
        const attacker = remotePlayers.get(payload.attackerId);
        if (attacker) attacker.score = payload.attackerScore;
      }

      const target = remotePlayers.get(payload.targetId);
      if (target) {
        target.hp = Math.max(0, (target.hp ?? 100) - (payload.damage || 20));
        particleSystem.createExplosion(target.x || 0, target.y || 0, '#ff9900', 25);
      }

      if (payload.targetId === myPlayerId && localPlayerRef && localPlayerRef.alive) {
        const px = localPlayerRef.x ?? localPlayerRef.pos?.x ?? (canvas.width / 2);
        const py = localPlayerRef.y ?? localPlayerRef.pos?.y ?? (canvas.height / 2);
        particleSystem.createExplosion(px, py, '#ff0055', 35);

        if (typeof localPlayerRef.takeDamage === 'function') {
          localPlayerRef.takeDamage(payload.damage || 20);
        } else if (typeof localPlayerRef.hp === 'number') {
          localPlayerRef.hp -= payload.damage || 20;
          if (localPlayerRef.hp <= 0) localPlayerRef.alive = false;
        } else {
          localPlayerRef.alive = false;
        }
      }
    } else if (type === 'ASTEROID_DESTROYED') {
      if (payload.shooterId === myPlayerId) {
        myScore = payload.shooterScore;
      } else {
        const shooter = remotePlayers.get(payload.shooterId);
        if (shooter) shooter.score = payload.shooterScore;
      }

      if (currentGameWorld && typeof currentGameWorld.ofKind === 'function') {
        const asteroids = Array.from(currentGameWorld.ofKind('asteroid') || []);
        const target = asteroids.find((a) => a.netId === payload.asteroidId);
        if (target) {
          target.alive = false;
        }
      }
    } else if (type === 'NEW_WAVE' && currentGameWorld && !isGameOver) {
      isWaveRequestPending = false;
      if (typeof currentGameWorld.ofKind === 'function') {
        const oldAsteroids = Array.from(currentGameWorld.ofKind('asteroid') || []);
        oldAsteroids.forEach((a) => (a.alive = false));
      }

      if (Array.isArray(payload.asteroids)) {
        payload.asteroids.forEach((ast) => {
          const asteroidInstance = new Asteroid(ast.x, ast.y);
          asteroidInstance.netId = ast.id;
          if (typeof ast.vx === 'number') asteroidInstance.vx = ast.vx;
          if (typeof ast.vy === 'number') asteroidInstance.vy = ast.vy;
          currentGameWorld.spawn(asteroidInstance);
        });
      }
    } else if (type === 'SPAWN_PICKUP' && currentGameWorld && !isGameOver) {
      const newP = new Pickup(payload.x, payload.y, payload.type || 'heal');
      newP.netId = payload.id;
      currentGameWorld.spawn(newP);
    } else if (type === 'PICKUP_COLLECTED' && currentGameWorld) {
      if (typeof currentGameWorld.ofKind === 'function') {
        const pickups = Array.from(currentGameWorld.ofKind('pickup') || []);
        const target = pickups.find((p) => p.netId === payload.pickupId);
        if (target) {
          const px = target.x ?? target.pos?.x ?? 0;
          const py = target.y ?? target.pos?.y ?? 0;
          particleSystem.createPickupBurst(px, py);
          target.alive = false;
        }
      }
    } else if (type === 'GAME_OVER') {
      isGameOver = true;
      triggerScreenShake(12, 0.5);
      showGameOverModal(payload.winnerId, payload.winnerScore);
    }
  } catch (err) {
    console.error('[WS Client Error]', err);
  }
});

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

function showGameOverModal(winnerId, winnerScore) {
  let modal = document.getElementById('game-over-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'game-over-modal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.85); display: flex; flex-direction: column;
      justify-content: center; align-items: center; z-index: 9999;
      color: #00ffcc; font-family: sans-serif; text-align: center;
    `;
    document.body.appendChild(modal);
  }

  const isMe = winnerId === myPlayerId;
  modal.innerHTML = `
    <h1 style="font-size: 3rem; margin-bottom: 10px; color: ${isMe ? '#00ff00' : '#ff3366'};">
      ${isMe ? '🏆 ВІТАЄМО! ВИ ПЕРЕМОГЛИ!' : '💥 МАТЧ ЗАВЕРШЕНО'}
    </h1>
    <p style="font-size: 1.4rem; margin-bottom: 20px;">
      Переможець: <strong>${isMe ? 'Ви' : 'Гравець ' + winnerId.substring(0, 4)}</strong> з рахунком <strong>${winnerScore} pts</strong>
    </p>
    <button id="btn-return-lobby" style="
      padding: 12px 30px; font-size: 1.2rem; font-weight: bold;
      background: #00ffcc; color: #000; border: none; border-radius: 6px;
      cursor: pointer; transition: transform 0.2s;
    ">Повернутися у Лобі</button>
  `;

  modal.style.display = 'flex';
  document.getElementById('btn-return-lobby').onclick = () => {
    window.location.reload();
  };
}

async function init() {
  drawLoadingScreen(ctx, canvas.width, canvas.height, 0, "Завантаження...");

  try {
    const loadedAssets = await loadAll('/assets/manifest.json', {
      onProgress: (progress) => drawLoadingScreen(ctx, canvas.width, canvas.height, progress)
    });

    drawLoadingScreen(ctx, canvas.width, canvas.height, 1, "Готово!");

    const selectedRoom = await showLobby();

    const join = () => {
      socket.send(JSON.stringify({
        type: 'JOIN_ROOM',
        payload: { roomId: selectedRoom.id }
      }));
    };

    if (socket.readyState === WebSocket.OPEN) join();
    else socket.addEventListener('open', join, { once: true });

    const checkStateInterval = setInterval(() => {
      if (initialWorldState || socket.readyState !== WebSocket.OPEN) {
        clearInterval(checkStateInterval);
        startGame(loadedAssets, selectedRoom);
      }
    }, 50);

  } catch (err) {
    console.error('Помилка запуску:', err);
  }
}

function startGame(assets, room) {
  audioManager.init(assets.audio);
  const world = new World(canvas.width, canvas.height);
  currentGameWorld = world;
  isGameOver = false;
  myScore = 0;
  trackedAsteroids.clear();

  const player = new Ship(world.width / 2, world.height / 2);
  localPlayerRef = player;
  world.spawn(player);

  if (initialWorldState && Array.isArray(initialWorldState.asteroids)) {
    initialWorldState.asteroids.forEach((ast) => {
      const asteroidInstance = new Asteroid(ast.x, ast.y);
      asteroidInstance.netId = ast.id;
      if (typeof ast.vx === 'number') asteroidInstance.vx = ast.vx;
      if (typeof ast.vy === 'number') asteroidInstance.vy = ast.vy;
      world.spawn(asteroidInstance);
    });
  }

  if (initialWorldState && Array.isArray(initialWorldState.pickups)) {
    initialWorldState.pickups.forEach((pik) => {
      const pInstance = new Pickup(pik.x, pik.y, pik.type || 'heal');
      pInstance.netId = pik.id;
      world.spawn(pInstance);
    });
  }

  const inputs = { left: false, right: false, thrust: false };

  window.addEventListener('keydown', (e) => {
    if (isGameOver) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputs.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') inputs.right = true;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') inputs.thrust = true;

    if (e.code === 'Space' && player.alive) {
      player.fire(world);
      if (audioManager.play) audioManager.play('laser');

      if (socket.readyState === WebSocket.OPEN) {
        const posX = player.x ?? player.pos?.x ?? player.position?.x ?? (world.width / 2);
        const posY = player.y ?? player.pos?.y ?? player.position?.y ?? (world.height / 2);
        const angle = player.angle ?? player.rotation ?? 0;

        socket.send(JSON.stringify({
          type: 'PLAYER_FIRE',
          payload: { x: posX, y: posY, angle }
        }));
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputs.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') inputs.right = false;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') inputs.thrust = false;
  });

  let respawnTimer = 0;
  let lastTime = performance.now();

  function gameLoop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (!isGameOver) {
      if (!player.alive) {
        respawnTimer += dt;
        if (respawnTimer >= 2.0) {
          player.respawn(world.width / 2, world.height / 2);
          if (typeof player.hp !== 'undefined') player.hp = 100;
          respawnTimer = 0;
        }
      }

      if (inputs.thrust && player.alive) {
        const px = player.x ?? player.pos?.x ?? player.position?.x ?? 0;
        const py = player.y ?? player.pos?.y ?? player.position?.y ?? 0;
        const angle = player.angle ?? player.rotation ?? 0;
        particleSystem.createThruster(px, py, angle);
      }

      if (typeof world.ofKind === 'function') {
        const activeAsteroids = Array.from(world.ofKind('asteroid') || []).filter((a) => a.alive !== false);
        if (activeAsteroids.length === 0 && !isWaveRequestPending && socket.readyState === WebSocket.OPEN) {
          isWaveRequestPending = true;
          socket.send(JSON.stringify({ type: 'REQUEST_NEW_WAVE' }));
        }
      }

      if (player.alive && typeof world.ofKind === 'function') {
        const bullets = Array.from(world.ofKind('bullet') || []).filter((b) => b.alive !== false);
        const asteroids = Array.from(world.ofKind('asteroid') || []).filter((a) => a.alive !== false);
        const pickups = Array.from(world.ofKind('pickup') || []).filter((p) => p.alive !== false);

        const px = player.x ?? player.pos?.x ?? player.position?.x ?? 0;
        const py = player.y ?? player.pos?.y ?? player.position?.y ?? 0;

        pickups.forEach((pik) => {
          const pikX = pik.x ?? pik.pos?.x ?? pik.position?.x;
          const pikY = pik.y ?? pik.pos?.y ?? pik.position?.y;

          if (typeof pikX === 'number' && typeof pikY === 'number') {
            if (Math.hypot(px - pikX, py - pikY) < 30) {
              pik.alive = false;
              particleSystem.createPickupBurst(pikX, pikY);
              if (typeof player.hp === 'number') player.hp = Math.min(100, player.hp + 30);

              if (socket.readyState === WebSocket.OPEN && pik.netId) {
                socket.send(JSON.stringify({
                  type: 'PICKUP_COLLECTED',
                  payload: { pickupId: pik.netId }
                }));
              }
            }
          }
        });

        bullets.forEach((bullet) => {
          const bx = bullet.x ?? bullet.pos?.x ?? bullet.position?.x;
          const by = bullet.y ?? bullet.pos?.y ?? bullet.position?.y;

          if (typeof bx === 'number' && typeof by === 'number') {
            asteroids.forEach((ast) => {
              if (ast.alive === false) return;
              const ax = ast.x ?? ast.pos?.x ?? ast.position?.x;
              const ay = ast.y ?? ast.pos?.y ?? ast.position?.y;

              if (typeof ax === 'number' && typeof ay === 'number') {
                const dist = Math.hypot(bx - ax, by - ay);
                if (dist < 32) {
                  bullet.alive = false;
                  ast.alive = false;

                  if (socket.readyState === WebSocket.OPEN && ast.netId) {
                    socket.send(JSON.stringify({
                      type: 'ASTEROID_DESTROYED',
                      payload: { asteroidId: ast.netId }
                    }));
                  }
                }
              }
            });

            remotePlayers.forEach((remoteP, remoteId) => {
              const rx = remoteP.x ?? 0;
              const ry = remoteP.y ?? 0;
              const dist = Math.hypot(bx - rx, by - ry);

              if (dist < 25 && bullet.alive !== false) {
                bullet.alive = false;

                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({
                    type: 'PLAYER_HIT',
                    payload: { targetId: remoteId, damage: 25 }
                  }));
                }
              }
            });
          }
        });
      }

      world.step(dt, inputs);
      handleCollisions(world);

      // ГАРАНТОВАНИЙ ВИКЛИК СПЕЦЕФЕКТІВ ДЛЯ УСІХ ЗНИЩЕНИХ АСТЕРОЇДІВ
      updateAsteroidVFX();
      particleSystem.update(dt);

      if (socket.readyState === WebSocket.OPEN && player.alive) {
        const posX = player.x ?? player.pos?.x ?? player.position?.x ?? (world.width / 2);
        const posY = player.y ?? player.pos?.y ?? player.position?.y ?? (world.height / 2);
        const angle = player.angle ?? player.rotation ?? 0;

        socket.send(JSON.stringify({
          type: 'PLAYER_STATE',
          payload: { x: posX, y: posY, angle, hp: player.hp ?? 100 }
        }));
      }
    }

    ctx.save();
    if (shakeTimer > 0) {
      shakeTimer -= dt;
      const offsetX = (Math.random() - 0.5) * shakeIntensity;
      const offsetY = (Math.random() - 0.5) * shakeIntensity;
      ctx.translate(offsetX, offsetY);
    }

    world.draw(ctx);
    particleSystem.draw(ctx);

    remotePlayers.forEach((p) => {
      const posX = p.x ?? 0;
      const posY = p.y ?? 0;
      const hp = p.hp ?? 100;

      ctx.save();
      ctx.translate(posX, posY);
      ctx.rotate(p.angle || 0);

      ctx.strokeStyle = '#ff9900';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(-10, -10);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.stroke();

      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(posX - 15, posY - 22, 30, 4);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(posX - 15, posY - 22, (30 * hp) / 100, 4);
      ctx.restore();
    });

    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#00ffcc';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Кімната: ${room ? room.name : 'Локальна'} | Гравців: ${remotePlayers.size + 1}`, 20, 30);

    const boardX = canvas.width - 240;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(boardX - 10, 10, 230, 45 + (remotePlayers.size * 20));
    ctx.strokeStyle = '#00ffcc';
    ctx.strokeRect(boardX - 10, 10, 230, 45 + (remotePlayers.size * 20));

    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`ТАБЛИЦЯ ОЧОК (Ціль: ${winScoreTarget})`, boardX, 28);

    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#00ff00';
    ctx.fillText(`Ви (${myPlayerId || 'Me'}): ${myScore} pts`, boardX, 48);

    let lineOffset = 66;
    remotePlayers.forEach((p, id) => {
      ctx.fillStyle = '#ff9900';
      ctx.fillText(`Гравець ${id.substring(0, 4)}: ${p.score || 0} pts`, boardX, lineOffset);
      lineOffset += 18;
    });

    ctx.restore();

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
}

init();