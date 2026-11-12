import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  MSG,
  PRNG,
  applyInput,
  stepWorld,
  encodeWelcome,
  decodeInput,
  encodeSnapshot,
  encodePing
} from 'shared';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;
const DT = 1 / TICK_RATE;
const WORLD_SEED = 1337;
const WIN_SCORE = 100;

const rng = new PRNG(WORLD_SEED);

const defaultNetem = {
  delay: 0,
  jitter: 0,
  loss: 0
};

const serverStats = {
  tick: 0,
  targetHz: TICK_RATE,
  lastTickDurationMs: 0,
  avgTickDurationMs: 0,
  maxTickDurationMs: 0,
  jitterMs: 0,
  lastTickAt: performance.now()
};

function randomId(prefix) {
  return prefix + Math.floor(rng.next() * 1e9).toString(36);
}

function generateAsteroids(count, width = 1200, height = 800) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      id: randomId('ast_'),
      x: rng.range(50, width - 50),
      y: rng.range(50, height - 50),
      vx: rng.range(-30, 30),
      vy: rng.range(-30, 30)
    });
  }
  return list;
}

function generatePickups(count, width = 1200, height = 800) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      id: randomId('pik_'),
      x: rng.range(50, width - 50),
      y: rng.range(50, height - 50),
      type: 'heal'
    });
  }
  return list;
}

const roomStates = new Map([
  ['room-1', { asteroids: generateAsteroids(10), pickups: generatePickups(2), gameOver: false }],
  ['room-2', { asteroids: generateAsteroids(18), pickups: generatePickups(3), gameOver: false }],
  ['room-3', { asteroids: generateAsteroids(6), pickups: generatePickups(1), gameOver: false }]
]);

const rooms = [
  { id: 'room-1', name: 'Альфа-Сектор', players: 0, maxPlayers: 4 },
  { id: 'room-2', name: 'Оріон-Бета', players: 0, maxPlayers: 4 },
  { id: 'room-3', name: 'Тренувальна арена', players: 0, maxPlayers: 4 }
];

const players = new Map();
let nextNetId = 1;

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
}

function wrapCoords(obj, width = 1200, height = 800) {
  if (obj.x < 0) obj.x += width;
  if (obj.x > width) obj.x -= width;
  if (obj.y < 0) obj.y += height;
  if (obj.y > height) obj.y -= height;
}

function clampNetem(cfg = {}) {
  return {
    delay: Math.max(0, Math.min(2000, Number(cfg.delay) || 0)),
    jitter: Math.max(0, Math.min(1000, Number(cfg.jitter) || 0)),
    loss: Math.max(0, Math.min(0.9, Number(cfg.loss) || 0))
  };
}

function calcNetDelay(netem) {
  if (!netem || (netem.delay === 0 && netem.jitter === 0)) return 0;
  const spread = (Math.random() * 2 - 1) * netem.jitter;
  return Math.max(0, netem.delay + spread);
}

function sendWithNetem(player, data) {
  if (!player || player.ws.readyState !== WebSocket.OPEN) return;
  const netem = player.netem || defaultNetem;
  if (netem.loss > 0 && Math.random() < netem.loss) return;

  const wait = calcNetDelay(netem);
  if (wait <= 0) {
    player.ws.send(data);
  } else {
    setTimeout(() => {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    }, wait);
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  if (parsedUrl.pathname === '/api/rooms') {
    const updatedRooms = rooms.map((r) => {
      const count = Array.from(players.values()).filter((p) => p.roomId === r.id).length;
      return { ...r, players: count };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updatedRooms));
    return;
  }

  if (parsedUrl.pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...serverStats,
      connectedPlayers: players.size,
      netem: defaultNetem
    }));
    return;
  }

  if (parsedUrl.pathname === '/api/netem') {
    if (parsedUrl.searchParams.has('delay') || parsedUrl.searchParams.has('jitter') || parsedUrl.searchParams.has('loss')) {
      Object.assign(defaultNetem, clampNetem({
        delay: parsedUrl.searchParams.get('delay') ?? defaultNetem.delay,
        jitter: parsedUrl.searchParams.get('jitter') ?? defaultNetem.jitter,
        loss: parsedUrl.searchParams.get('loss') ?? defaultNetem.loss
      }));
      players.forEach((p) => {
        p.netem = { ...defaultNetem };
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(defaultNetem));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

function sendToRoom(roomId, data) {
  if (!roomId) return;
  const message = JSON.stringify(data);
  players.forEach((p) => {
    if (p.roomId === roomId) {
      sendWithNetem(p, message);
    }
  });
}

function broadcastToOthersInRoom(senderId, roomId, data) {
  if (!roomId) return;
  const message = JSON.stringify(data);
  players.forEach((p) => {
    if (p.id !== senderId && p.roomId === roomId) {
      sendWithNetem(p, message);
    }
  });
}

function checkWinCondition(player) {
  if (!player.roomId) return;
  const roomState = roomStates.get(player.roomId);
  if (roomState && !roomState.gameOver && player.score >= WIN_SCORE) {
    roomState.gameOver = true;
    sendToRoom(player.roomId, {
      type: 'GAME_OVER',
      payload: {
        winnerId: player.id,
        winnerScore: player.score
      }
    });
  }
}

setInterval(() => {
  roomStates.forEach((state, roomId) => {
    if (state.gameOver) return;
    const activePlayers = Array.from(players.values()).filter((p) => p.roomId === roomId);
    if (activePlayers.length > 0 && state.pickups.length < 3) {
      const newPickup = {
        id: randomId('pik_'),
        x: rng.range(100, 1100),
        y: rng.range(100, 700),
        type: 'heal'
      };
      state.pickups.push(newPickup);
      sendToRoom(roomId, { type: 'SPAWN_PICKUP', payload: newPickup });
    }
  });
}, 12000);

function allowInputToken(player) {
  const now = performance.now();
  const elapsedSec = (now - player.lastTokenAt) / 1000;
  player.lastTokenAt = now;
  player.tokens = Math.min(60, player.tokens + elapsedSec * 45);
  if (player.tokens < 1) return false;
  player.tokens -= 1;
  return true;
}

function validateInputPacket(rawInput) {
  if (!rawInput || typeof rawInput !== 'object') return null;
  if (!Number.isInteger(rawInput.seq) || rawInput.seq <= 0) return null;
  if (typeof rawInput.turn !== 'number' || !Number.isFinite(rawInput.turn)) return null;
  if (Math.abs(rawInput.turn) > 1) return null;

  return {
    seq: rawInput.seq,
    turn: Math.round(rawInput.turn),
    thrust: Boolean(rawInput.thrust),
    fire: Boolean(rawInput.fire)
  };
}

function handleClientMessage(player, rawData, isBinary) {
  if (!players.has(player.id)) return;

  if (isBinary) {
    const ab = toArrayBuffer(rawData);
    if (ab.byteLength < 2) return;
    const view = new DataView(ab);
    const version = view.getUint8(0);
    const msgType = view.getUint8(1);
    if (version !== PROTOCOL_VERSION) return;

    if (msgType === MSG.PING && ab.byteLength >= 10) {
      const ts = view.getFloat64(2, true);
      sendWithNetem(player, encodePing(MSG.PONG, ts));
      return;
    }

    if (msgType === MSG.INPUT && ab.byteLength >= 8) {
      if (!allowInputToken(player)) return;
      const valid = validateInputPacket(decodeInput(ab));
      if (!valid || valid.seq <= player.lastSeq) return;
      if (player.inputQueue.length < 64) {
        player.inputQueue.push(valid);
      }
    }
    return;
  }

  try {
    const { type, payload } = JSON.parse(rawData.toString());

    if (type === 'INPUT') {
      if (!allowInputToken(player)) return;
      const valid = validateInputPacket(payload);
      if (!valid || valid.seq <= player.lastSeq) return;
      if (player.inputQueue.length < 64) {
        player.inputQueue.push(valid);
      }

    } else if (type === 'PING') {
      sendWithNetem(player, JSON.stringify({ type: 'PONG', payload }));

    } else if (type === 'SET_NETEM') {
      player.netem = clampNetem(payload);

    } else if (type === 'SET_CODEC') {
      player.codec = payload?.codec === 'json' ? 'json' : 'binary';

    } else if (type === 'JOIN_ROOM') {
      player.roomId = payload.roomId;
      player.score = 0;
      player.hp = 100;
      player.x = rng.range(150, 1050);
      player.y = rng.range(150, 650);
      player.angle = rng.range(0, Math.PI * 2);
      player.lastSeq = 0;
      player.inputQueue = [];

      let roomWorld = roomStates.get(payload.roomId);
      if (!roomWorld || !roomWorld.asteroids || roomWorld.asteroids.length === 0 || roomWorld.gameOver) {
        const count = payload.roomId === 'room-2' ? 18 : (payload.roomId === 'room-3' ? 6 : 10);
        roomWorld = { asteroids: generateAsteroids(count), pickups: generatePickups(2), gameOver: false };
        roomStates.set(payload.roomId, roomWorld);
      }

      const existingRoomPlayers = Array.from(players.values())
        .filter((p) => p.roomId === payload.roomId && p.id !== player.id)
        .map((p) => ({ id: p.id, netId: p.netId, x: p.x, y: p.y, angle: p.angle, hp: p.hp, score: p.score }));

      sendWithNetem(player, JSON.stringify({
        type: 'INIT_SELF',
        payload: {
          id: player.id,
          netId: player.netId,
          seed: WORLD_SEED,
          existingPlayers: existingRoomPlayers,
          worldState: roomWorld,
          winScore: WIN_SCORE
        }
      }));

      broadcastToOthersInRoom(player.id, player.roomId, {
        type: 'PLAYER_JOINED',
        payload: { id: player.id, netId: player.netId, x: player.x, y: player.y, angle: player.angle, hp: player.hp, score: player.score }
      });

    } else if (type === 'PLAYER_FIRE') {
      if (player.roomId) {
        broadcastToOthersInRoom(player.id, player.roomId, {
          type: 'PLAYER_FIRE',
          payload: { id: player.id, x: player.x, y: player.y, angle: player.angle }
        });
      }

    } else if (type === 'PLAYER_HIT') {
      if (player.roomId) {
        player.score += 25;
        const targetPlayer = players.get(payload.targetId);
        if (targetPlayer) {
          targetPlayer.hp = Math.max(0, targetPlayer.hp - (payload.damage || 20));
        }
        sendToRoom(player.roomId, {
          type: 'PLAYER_HIT',
          payload: {
            targetId: payload.targetId,
            damage: payload.damage,
            attackerId: player.id,
            attackerScore: player.score
          }
        });
        checkWinCondition(player);
      }

    } else if (type === 'ASTEROID_DESTROYED') {
      if (player.roomId) {
        player.score += 10;
        const roomWorld = roomStates.get(player.roomId);
        if (roomWorld) {
          roomWorld.asteroids = roomWorld.asteroids.filter((a) => a.id !== payload.asteroidId);
          sendToRoom(player.roomId, {
            type: 'ASTEROID_DESTROYED',
            payload: {
              asteroidId: payload.asteroidId,
              shooterId: player.id,
              shooterScore: player.score
            }
          });
          checkWinCondition(player);
        }
      }

    } else if (type === 'REQUEST_NEW_WAVE') {
      if (player.roomId) {
        const roomWorld = roomStates.get(player.roomId);
        if (roomWorld && !roomWorld.gameOver) {
          const count = player.roomId === 'room-2' ? 18 : (player.roomId === 'room-3' ? 6 : 10);
          roomWorld.asteroids = generateAsteroids(count);
          sendToRoom(player.roomId, {
            type: 'NEW_WAVE',
            payload: { asteroids: roomWorld.asteroids }
          });
        }
      }

    } else if (type === 'PICKUP_COLLECTED') {
      if (player.roomId) {
        const roomWorld = roomStates.get(player.roomId);
        if (roomWorld) {
          roomWorld.pickups = roomWorld.pickups.filter((p) => p.id !== payload.pickupId);
        }
        sendToRoom(player.roomId, {
          type: 'PICKUP_COLLECTED',
          payload: { pickupId: payload.pickupId, collectorId: player.id }
        });
      }
    }
  } catch (err) {
    console.error('[WS Error]', err);
  }
}

wss.on('connection', (ws, req) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const initialNetem = clampNetem({
    delay: reqUrl.searchParams.get('delay') ?? defaultNetem.delay,
    jitter: reqUrl.searchParams.get('jitter') ?? defaultNetem.jitter,
    loss: reqUrl.searchParams.get('loss') ?? defaultNetem.loss
  });

  const netId = nextNetId++;
  const playerId = 'p_' + netId;

  const playerObj = {
    id: playerId,
    netId,
    ws,
    roomId: null,
    x: 600,
    y: 400,
    angle: 0,
    hp: 100,
    score: 0,
    lastSeq: 0,
    inputQueue: [],
    codec: 'binary',
    netem: initialNetem,
    tokens: 60,
    lastTokenAt: performance.now()
  };

  players.set(playerId, playerObj);
  sendWithNetem(playerObj, encodeWelcome(netId, WORLD_SEED));

  ws.on('message', (rawData, isBinary) => {
    const netem = playerObj.netem || defaultNetem;
    if (netem.loss > 0 && Math.random() < netem.loss) return;

    const wait = calcNetDelay(netem);
    if (wait <= 0) {
      handleClientMessage(playerObj, rawData, isBinary);
    } else {
      setTimeout(() => handleClientMessage(playerObj, rawData, isBinary), wait);
    }
  });

  ws.on('close', () => {
    if (playerObj.roomId) {
      broadcastToOthersInRoom(playerId, playerObj.roomId, {
        type: 'PLAYER_DISCONNECTED',
        payload: { id: playerId }
      });
    }
    players.delete(playerId);
  });
});

let nextTick = performance.now() + TICK_MS;

function runServerTick() {
  const tickStart = performance.now();
  const intervalJitter = Math.abs(tickStart - serverStats.lastTickAt - TICK_MS);
  serverStats.lastTickAt = tickStart;
  serverStats.jitterMs = Number((serverStats.jitterMs * 0.9 + intervalJitter * 0.1).toFixed(2));
  serverStats.tick++;

  roomStates.forEach((state, roomId) => {
    if (state.gameOver) return;

    stepWorld(state.asteroids, DT);
    for (const ast of state.asteroids) {
      wrapCoords(ast);
    }

    const roomPlayers = Array.from(players.values()).filter((p) => p.roomId === roomId);
    if (roomPlayers.length === 0) return;

    for (const p of roomPlayers) {
      while (p.inputQueue.length > 0) {
        const input = p.inputQueue.shift();
        applyInput(p, input, DT);
        wrapCoords(p);
        p.lastSeq = input.seq;
      }
    }

    const shipsPayload = roomPlayers.map((p) => ({
      id: p.netId,
      lastSeq: p.lastSeq,
      x: p.x,
      y: p.y,
      angle: p.angle
    }));

    const binarySnapshot = encodeSnapshot(serverStats.tick, shipsPayload);
    let jsonSnapshot = null;

    for (const p of roomPlayers) {
      if (p.codec === 'json') {
        if (!jsonSnapshot) {
          jsonSnapshot = JSON.stringify({ type: 'SNAPSHOT', tick: serverStats.tick, ships: shipsPayload });
        }
        sendWithNetem(p, jsonSnapshot);
      } else {
        sendWithNetem(p, binarySnapshot);
      }
    }
  });

  const duration = performance.now() - tickStart;
  serverStats.lastTickDurationMs = Number(duration.toFixed(3));
  serverStats.avgTickDurationMs = Number((serverStats.avgTickDurationMs * 0.9 + duration * 0.1).toFixed(3));
  if (duration > serverStats.maxTickDurationMs) {
    serverStats.maxTickDurationMs = Number(duration.toFixed(3));
  }

  nextTick += TICK_MS;
  const now = performance.now();
  if (nextTick < now - TICK_MS) {
    nextTick = now + TICK_MS;
  }
  setTimeout(runServerTick, Math.max(0, nextTick - now));
}

setTimeout(runServerTick, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`[Server] Авторитативний сервер (30 Гц, setTimeout) на http://${HOST}:${PORT}`);
});