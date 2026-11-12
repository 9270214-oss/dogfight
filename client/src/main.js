import {
  MSG,
  applyInput,
  decodeWelcome,
  encodeInput,
  decodeSnapshot,
  encodePing,
  decodePing
} from 'shared';
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

const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 800;
const TICK_RATE = 30;
const FIXED_DT = 1 / TICK_RATE;

let myPlayerId = null;
let myNetId = null;
let worldSeed = 1337;
let myScore = 0;
let winScoreTarget = 100;

const remotePlayers = new Map();
const snapshotBuffer = [];
let currentGameWorld = null;
let localPlayerRef = null;
let initialWorldState = null;
let isWaveRequestPending = false;
let isGameOver = false;

// Стан Prediction, Reconciliation та візуального згладжування
let predictionEnabled = true;
let activeCodec = 'binary';
let netemPreset = '0 ms';
let interpDelayMs = 80;

let inputSeq = 0;
const pendingInputs = [];
const predState = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, angle: 0 };
const smoothOffset = { x: 0, y: 0 };

// Метрики для Netgraph
const netStats = {
  rttMs: 0,
  lastSnapshotAt: performance.now(),
  snapshotAgeMs: 0,
  inBytesAcc: 0,
  outBytesAcc: 0,
  inBytesPerSec: 0,
  outBytesPerSec: 0,
  lastCorrectionPx: 0
};

const textEncoder = new TextEncoder();

function wrapCoords(obj) {
  if (obj.x < 0) obj.x += WORLD_WIDTH;
  if (obj.x > WORLD_WIDTH) obj.x -= WORLD_WIDTH;
  if (obj.y < 0) obj.y += WORLD_HEIGHT;
  if (obj.y > WORLD_HEIGHT) obj.y -= WORLD_HEIGHT;
}

function lerpAngle(a0, a1, t) {
  const twoPi = Math.PI * 2;
  const diff = (((a1 - a0 + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
  return a0 + diff * t;
}

// VFX та Трясіння камери
const particleSystem = new ParticleSystem();
let shakeTimer = 0;
let shakeIntensity = 0;
const trackedAsteroids = new Map();

function triggerScreenShake(intensity = 6, duration = 0.25) {
  shakeIntensity = intensity;
  shakeTimer = duration;
}

function updateAsteroidVFX() {
  if (!currentGameWorld || typeof currentGameWorld.ofKind !== 'function') return;
  const currentAsteroids = new Set(currentGameWorld.ofKind('asteroid') || []);

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

  currentAsteroids.forEach((ast) => {
    if (ast.alive !== false && !ast._explodedVFX) {
      const ax = ast.pos?.x ?? ast.x ?? 0;
      const ay = ast.pos?.y ?? ast.y ?? 0;
      trackedAsteroids.set(ast, { x: ax, y: ay });
    }
  });
}

const socket = new WebSocket('ws://localhost:3000');
socket.binaryType = 'arraybuffer';

function sendPacket(data) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const bytes = data instanceof ArrayBuffer
    ? data.byteLength
    : textEncoder.encode(data).byteLength;
  netStats.outBytesAcc += bytes;
  socket.send(data);
}

setInterval(() => {
  netStats.inBytesPerSec = netStats.inBytesAcc;
  netStats.outBytesPerSec = netStats.outBytesAcc;
  netStats.inBytesAcc = 0;
  netStats.outBytesAcc = 0;
}, 1000);

setInterval(() => {
  if (socket.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (activeCodec === 'binary') {
    sendPacket(encodePing(MSG.PING, now));
  } else {
    sendPacket(JSON.stringify({ type: 'PING', payload: now }));
  }
}, 500);

function handleSnapshotData(snapshot) {
  const now = performance.now();
  netStats.lastSnapshotAt = now;

  // Зберігаємо знімок у буфер для інтерполяції віддалених кораблів
  const shipsMap = new Map();
  for (const s of snapshot.ships) {
    shipsMap.set(s.id, { x: s.x, y: s.y, angle: s.angle });
  }
  snapshotBuffer.push({ time: now, tick: snapshot.tick, ships: shipsMap });
  while (snapshotBuffer.length > 30) {
    snapshotBuffer.shift();
  }

  const activeNetIds = new Set();

  for (const s of snapshot.ships) {
    if (s.id === myNetId) {
      while (pendingInputs.length > 0 && pendingInputs[0].seq <= s.lastSeq) {
        pendingInputs.shift();
      }

      if (!predictionEnabled) {
        // Режим M1 без передбачення: корабель рухається лише за знімками сервера
        netStats.lastCorrectionPx = Math.hypot(s.x - predState.x, s.y - predState.y);
        predState.x = s.x;
        predState.y = s.y;
        predState.angle = s.angle;
        smoothOffset.x = 0;
        smoothOffset.y = 0;
        if (localPlayerRef && localPlayerRef.alive) {
          localPlayerRef.pos.x = predState.x;
          localPlayerRef.pos.y = predState.y;
          localPlayerRef.angle = predState.angle;
        }
        continue;
      }

      // Режим M2: Server Reconciliation із повторним програванням непідтверджених команд
      const beforeX = predState.x;
      const beforeY = predState.y;

      predState.x = s.x;
      predState.y = s.y;
      predState.angle = s.angle;

      for (const item of pendingInputs) {
        applyInput(predState, item.input, FIXED_DT);
        wrapCoords(predState);
      }

      let errX = beforeX - predState.x;
      let errY = beforeY - predState.y;
      if (Math.abs(errX) > WORLD_WIDTH / 2) errX = 0;
      if (Math.abs(errY) > WORLD_HEIGHT / 2) errY = 0;

      const errMag = Math.hypot(errX, errY);
      netStats.lastCorrectionPx = errMag;

      if (errMag > 0.5 && errMag < 180) {
        smoothOffset.x += errX;
        smoothOffset.y += errY;
      }
    } else {
      activeNetIds.add(s.id);
      const strId = 'p_' + s.id;
      if (!remotePlayers.has(strId)) {
        remotePlayers.set(strId, {
          id: strId,
          netId: s.id,
          x: s.x,
          y: s.y,
          angle: s.angle,
          hp: 100,
          score: 0
        });
      }
    }
  }

  for (const [strId, p] of remotePlayers.entries()) {
    if (typeof p.netId === 'number' && !activeNetIds.has(p.netId)) {
      remotePlayers.delete(strId);
    }
  }
}

socket.addEventListener('open', () => {
  console.log('[WS Client] Підключено!');
});

socket.addEventListener('message', (event) => {
  if (event.data instanceof ArrayBuffer) {
    netStats.inBytesAcc += event.data.byteLength;
    const view = new DataView(event.data);
    if (view.byteLength < 2) return;
    const msgType = view.getUint8(1);

    if (msgType === MSG.WELCOME) {
      const welcome = decodeWelcome(event.data);
      myNetId = welcome.id;
      worldSeed = welcome.seed;
      return;
    }

    if (msgType === MSG.PONG) {
      const pong = decodePing(event.data);
      const sampleRtt = Math.max(0, performance.now() - pong.timestamp);
      netStats.rttMs = netStats.rttMs === 0 ? sampleRtt : netStats.rttMs * 0.8 + sampleRtt * 0.2;
      return;
    }

    if (msgType === MSG.SNAPSHOT) {
      handleSnapshotData(decodeSnapshot(event.data));
      return;
    }
  }

  try {
    netStats.inBytesAcc += textEncoder.encode(event.data).byteLength;
    const { type, payload } = JSON.parse(event.data);

    if (type === 'PONG') {
      const sampleRtt = Math.max(0, performance.now() - Number(payload || 0));
      netStats.rttMs = netStats.rttMs === 0 ? sampleRtt : netStats.rttMs * 0.8 + sampleRtt * 0.2;
    } else if (type === 'SNAPSHOT') {
      handleSnapshotData(payload);
    } else if (type === 'INIT_SELF') {
      myPlayerId = payload.id;
      if (payload.netId) myNetId = payload.netId;
      if (payload.seed) worldSeed = payload.seed;
      if (payload.winScore) winScoreTarget = payload.winScore;
      if (payload.worldState) initialWorldState = payload.worldState;

      if (Array.isArray(payload.existingPlayers)) {
        payload.existingPlayers.forEach((p) => {
          remotePlayers.set(p.id, { hp: 100, score: 0, ...p });
        });
      }
    } else if (type === 'PLAYER_JOINED') {
      remotePlayers.set(payload.id, { hp: 100, score: 0, ...payload });
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
        particleSystem.createExplosion(localPlayerRef.pos.x, localPlayerRef.pos.y, '#ff0055', 35);
        localPlayerRef.takeDamage(payload.damage || 20);
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
        if (target) target.alive = false;
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
          const px = target.pos?.x ?? target.x ?? 0;
          const py = target.pos?.y ?? target.y ?? 0;
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
      Переможець: <strong>${isMe ? 'Ви' : 'Гравець ' + winnerId}</strong> з рахунком <strong>${winnerScore} pts</strong>
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

function interpolateRemoteEntities(now) {
  if (snapshotBuffer.length === 0) return;
  const renderTime = now - interpDelayMs;

  let s0 = snapshotBuffer[0];
  let s1 = snapshotBuffer[snapshotBuffer.length - 1];

  for (let i = 0; i < snapshotBuffer.length - 1; i++) {
    if (snapshotBuffer[i].time <= renderTime && snapshotBuffer[i + 1].time >= renderTime) {
      s0 = snapshotBuffer[i];
      s1 = snapshotBuffer[i + 1];
      break;
    }
  }

  const span = s1.time - s0.time;
  const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTime - s0.time) / span)) : 1;

  remotePlayers.forEach((p) => {
    if (typeof p.netId !== 'number') return;
    const p1 = s1.ships.get(p.netId);
    if (!p1) return;
    const p0 = s0.ships.get(p.netId) || p1;

    if (Math.abs(p1.x - p0.x) > WORLD_WIDTH / 2 || Math.abs(p1.y - p0.y) > WORLD_HEIGHT / 2) {
      p.x = p1.x;
      p.y = p1.y;
    } else {
      p.x = p0.x + (p1.x - p0.x) * alpha;
      p.y = p0.y + (p1.y - p0.y) * alpha;
    }
    p.angle = lerpAngle(p0.angle, p1.angle, alpha);
  });
}

async function init() {
  drawLoadingScreen(ctx, canvas.width, canvas.height, 0, 'Завантаження...');
  try {
    const loadedAssets = await loadAll('/assets/manifest.json', {
      onProgress: (progress) => drawLoadingScreen(ctx, canvas.width, canvas.height, progress)
    });
    drawLoadingScreen(ctx, canvas.width, canvas.height, 1, 'Готово!');

    const selectedRoom = await showLobby();

    const join = () => {
      sendPacket(JSON.stringify({
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
  const world = new World(WORLD_WIDTH, WORLD_HEIGHT);
  currentGameWorld = world;
  isGameOver = false;
  myScore = 0;
  trackedAsteroids.clear();

  const player = new Ship(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  player.networkControlled = true;
  localPlayerRef = player;
  world.spawn(player);

  predState.x = player.pos.x;
  predState.y = player.pos.y;
  predState.angle = player.angle;
  pendingInputs.length = 0;

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

  const inputs = { left: false, right: false, thrust: false, fire: false };

  window.addEventListener('keydown', (e) => {
    if (isGameOver) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputs.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') inputs.right = true;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') inputs.thrust = true;

    if (e.code === 'Space' && player.alive) {
      inputs.fire = true;
      player.fire(world);
      if (audioManager.play) audioManager.play('laser');

      sendPacket(JSON.stringify({
        type: 'PLAYER_FIRE',
        payload: { x: player.pos.x, y: player.pos.y, angle: player.angle }
      }));
    }

    // Клавіші керування мережевим стендом (Netem / Prediction / Codec / Interp)
    if (e.code === 'Digit1') {
      netemPreset = '0 ms';
      sendPacket(JSON.stringify({ type: 'SET_NETEM', payload: { delay: 0, jitter: 0, loss: 0 } }));
    } else if (e.code === 'Digit2') {
      netemPreset = '100 ms';
      sendPacket(JSON.stringify({ type: 'SET_NETEM', payload: { delay: 100, jitter: 0, loss: 0 } }));
    } else if (e.code === 'Digit3') {
      netemPreset = '100±30ms, 2%';
      sendPacket(JSON.stringify({ type: 'SET_NETEM', payload: { delay: 100, jitter: 30, loss: 0.02 } }));
    } else if (e.code === 'KeyP') {
      predictionEnabled = !predictionEnabled;
      pendingInputs.length = 0;
      smoothOffset.x = 0;
      smoothOffset.y = 0;
    } else if (e.code === 'KeyB') {
      activeCodec = activeCodec === 'binary' ? 'json' : 'binary';
      sendPacket(JSON.stringify({ type: 'SET_CODEC', payload: { codec: activeCodec } }));
    } else if (e.code === 'BracketLeft') {
      interpDelayMs = Math.max(33, interpDelayMs - 15);
    } else if (e.code === 'BracketRight') {
      interpDelayMs = Math.min(200, interpDelayMs + 15);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputs.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') inputs.right = false;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') inputs.thrust = false;
    if (e.code === 'Space') inputs.fire = false;
  });

  let respawnTimer = 0;
  let tickAccumulator = 0;
  let lastTime = performance.now();

  function gameLoop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    netStats.snapshotAgeMs = now - netStats.lastSnapshotAt;

    if (!isGameOver) {
      if (!player.alive) {
        respawnTimer += dt;
        if (respawnTimer >= 2.0) {
          player.respawn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
          predState.x = WORLD_WIDTH / 2;
          predState.y = WORLD_HEIGHT / 2;
          predState.angle = 0;
          smoothOffset.x = 0;
          smoothOffset.y = 0;
          pendingInputs.length = 0;
          respawnTimer = 0;
        }
      }

      // ФІКСОВАНИЙ 30Hz КРОК СИМУЛЯЦІЇ ТА ВІДПРАВКИ INPUT
      tickAccumulator += dt;
      while (tickAccumulator >= FIXED_DT) {
        tickAccumulator -= FIXED_DT;

        if (player.alive) {
          const turn = (inputs.right ? 1 : 0) - (inputs.left ? 1 : 0);
          const cmd = {
            turn,
            thrust: !!inputs.thrust,
            fire: !!inputs.fire
          };
          const seq = ++inputSeq;

          if (predictionEnabled) {
            applyInput(predState, cmd, FIXED_DT);
            wrapCoords(predState);
            pendingInputs.push({ seq, input: cmd });
            if (pendingInputs.length > 120) pendingInputs.shift();
          }

          if (activeCodec === 'binary') {
            sendPacket(encodeInput(seq, cmd));
          } else {
            sendPacket(JSON.stringify({ type: 'INPUT', payload: { seq, ...cmd } }));
          }
        }
      }

      // Згладжування поправки reconciliation за ~100 мс
      const decay = Math.exp(-dt * 25);
      smoothOffset.x *= decay;
      smoothOffset.y *= decay;

      if (player.alive) {
        player.pos.x = predState.x + smoothOffset.x;
        player.pos.y = predState.y + smoothOffset.y;
        player.angle = predState.angle;
        wrapCoords(player.pos);
      }

      // Інтерполяція віддалених кораблів у минулому (now - interpDelayMs)
      interpolateRemoteEntities(now);

      if (inputs.thrust && player.alive) {
        particleSystem.createThruster(player.pos.x, player.pos.y, player.angle);
      }

      if (typeof world.ofKind === 'function') {
        const activeAsteroids = Array.from(world.ofKind('asteroid') || []).filter((a) => a.alive !== false);
        if (activeAsteroids.length === 0 && !isWaveRequestPending && socket.readyState === WebSocket.OPEN) {
          isWaveRequestPending = true;
          sendPacket(JSON.stringify({ type: 'REQUEST_NEW_WAVE' }));
        }
      }

      if (player.alive && typeof world.ofKind === 'function') {
        const bullets = Array.from(world.ofKind('bullet') || []).filter((b) => b.alive !== false);
        const asteroids = Array.from(world.ofKind('asteroid') || []).filter((a) => a.alive !== false);
        const pickups = Array.from(world.ofKind('pickup') || []).filter((p) => p.alive !== false);

        pickups.forEach((pik) => {
          const pikX = pik.pos?.x ?? pik.x;
          const pikY = pik.pos?.y ?? pik.y;
          if (typeof pikX === 'number' && typeof pikY === 'number') {
            if (Math.hypot(player.pos.x - pikX, player.pos.y - pikY) < 30) {
              pik.alive = false;
              particleSystem.createPickupBurst(pikX, pikY);
              player.heal(30);
              if (pik.netId) {
                sendPacket(JSON.stringify({
                  type: 'PICKUP_COLLECTED',
                  payload: { pickupId: pik.netId }
                }));
              }
            }
          }
        });

        bullets.forEach((bullet) => {
          const bx = bullet.pos?.x ?? bullet.x;
          const by = bullet.pos?.y ?? bullet.y;
          if (typeof bx === 'number' && typeof by === 'number') {
            asteroids.forEach((ast) => {
              if (ast.alive === false) return;
              const ax = ast.pos?.x ?? ast.x;
              const ay = ast.pos?.y ?? ast.y;
              if (typeof ax === 'number' && typeof ay === 'number') {
                if (Math.hypot(bx - ax, by - ay) < 32) {
                  bullet.alive = false;
                  ast.alive = false;
                  if (ast.netId) {
                    sendPacket(JSON.stringify({
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
              if (Math.hypot(bx - rx, by - ry) < 25 && bullet.alive !== false) {
                bullet.alive = false;
                sendPacket(JSON.stringify({
                  type: 'PLAYER_HIT',
                  payload: { targetId: remoteId, damage: 25 }
                }));
              }
            });
          }
        });
      }

      world.step(dt, inputs);
      handleCollisions(world);
      updateAsteroidVFX();
      particleSystem.update(dt);
    }

    // РЕНДЕР СВІТУ З МАСШТАБУВАННЯМ ПІД РОЗМІР ВІКНА
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT);

    if (shakeTimer > 0) {
      shakeTimer -= dt;
      ctx.translate(
        (Math.random() - 0.5) * shakeIntensity,
        (Math.random() - 0.5) * shakeIntensity
      );
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

    // NETGRAPH OVERLAY (МЕРЕЖЕВА ДІАГНОСТИКА)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 12, 20, 0.78)';
    ctx.fillRect(14, 14, 305, 195);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 14, 305, 195);

    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`NETGRAPH | ${room ? room.name : 'Арена'} | Seed: ${worldSeed}`, 24, 34);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#e0f7fa';
    ctx.fillText(`RTT (Ping):        ${netStats.rttMs.toFixed(1)} ms`, 24, 54);
    ctx.fillText(`Вік знімка:        ${netStats.snapshotAgeMs.toFixed(0)} ms`, 24, 72);
    ctx.fillText(`Трафік In / Out:   ${netStats.inBytesPerSec} / ${netStats.outBytesPerSec} B/s`, 24, 90);
    ctx.fillText(`Черга input:       ${pendingInputs.length} пак.`, 24, 108);
    ctx.fillText(`Поправка (Reconc): ${netStats.lastCorrectionPx.toFixed(2)} px`, 24, 126);
    ctx.fillText(`Інтерполяція ([/]):${interpDelayMs} ms`, 24, 144);

    ctx.fillStyle = predictionEnabled ? '#00ff66' : '#ff5555';
    ctx.fillText(`[P] Prediction: ${predictionEnabled ? 'ON' : 'OFF'} | [B] ${activeCodec.toUpperCase()}`, 24, 166);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(`[1/2/3] Netem: ${netemPreset}`, 24, 184);
    ctx.fillStyle = '#90a4ae';
    ctx.font = '11px monospace';
    ctx.fillText(`1:0ms | 2:100ms | 3:100±30ms+2%`, 24, 200);
    ctx.restore();

    // ТАБЛИЦЯ ОЧОК
    ctx.save();
    const boardX = canvas.width - 240;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(boardX - 10, 14, 230, 45 + (remotePlayers.size * 20));
    ctx.strokeStyle = '#00ffcc';
    ctx.strokeRect(boardX - 10, 14, 230, 45 + (remotePlayers.size * 20));

    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`ТАБЛИЦЯ ОЧОК (Ціль: ${winScoreTarget})`, boardX, 32);

    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#00ff00';
    ctx.fillText(`Ви (${myPlayerId || 'Me'}): ${myScore} pts`, boardX, 52);

    let lineOffset = 70;
    remotePlayers.forEach((p, id) => {
      ctx.fillStyle = '#ff9900';
      ctx.fillText(`Гравець ${id}: ${p.score || 0} pts`, boardX, lineOffset);
      lineOffset += 18;
    });
    ctx.restore();

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
}

init();