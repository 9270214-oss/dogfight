import http from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import {
  BinarySnapshotCodec,
  JsonSnapshotCodec,
  MSG,
  PRNG,
  PROTOCOL_VERSION,
  applyInput,
  asEntityId,
  asRoomId,
  asSeq,
  asTick,
  assertNever,
  decodeInput,
  encodePing,
  encodeWelcome,
  parseClientMessage,
  stepWorld,
  type EntityId,
  type InputPacket,
  type RoomId,
  type Seq,
  type ServerMessage,
  type SnapshotCodec,
  type SnapshotPacket,
  type Tick
} from 'shared';

// ============================================================================
// 1. КОНФІГУРАЦІЯ СЕРВЕРА ТА ВАЛІДАЦІЯ ЧЕРЕЗ ZOD
// ============================================================================

const ServerConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  TICK_RATE: z.coerce.number().int().min(10).max(120).default(30),
  WORLD_SEED: z.coerce.number().int().nonnegative().default(1337),
  WIN_SCORE: z.coerce.number().int().positive().default(100)
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const CONFIG: ServerConfig = ServerConfigSchema.parse({
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  TICK_RATE: process.env.TICK_RATE,
  WORLD_SEED: process.env.WORLD_SEED,
  WIN_SCORE: process.env.WIN_SCORE
});

const TICK_MS = 1000 / CONFIG.TICK_RATE;
const DT = 1 / CONFIG.TICK_RATE;

// ============================================================================
// 2. ДОМЕННІ ТИПИ ТА СТАН СЕРВЕРА
// ============================================================================

interface NetemConfig {
  delay: number;
  jitter: number;
  loss: number;
}

interface ServerStats {
  tick: number;
  targetHz: number;
  lastTickDurationMs: number;
  avgTickDurationMs: number;
  maxTickDurationMs: number;
  jitterMs: number;
  lastTickAt: number;
}

interface Asteroid {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Pickup {
  id: string;
  x: number;
  y: number;
  type: 'heal';
}

interface RoomState {
  asteroids: Asteroid[];
  pickups: Pickup[];
  gameOver: boolean;
}

interface RoomInfo {
  readonly id: RoomId;
  readonly name: string;
  players: number;
  readonly maxPlayers: number;
}

interface PlayerState {
  readonly id: string;
  readonly netId: EntityId;
  readonly ws: WebSocket;
  roomId: RoomId | null;
  x: number;
  y: number;
  angle: number;
  hp: number;
  score: number;
  lastSeq: Seq;
  inputQueue: InputPacket[];
  codec: 'binary' | 'json';
  netem: NetemConfig;
  tokens: number;
  lastTokenAt: number;
}

const rng = new PRNG(CONFIG.WORLD_SEED);
const binaryCodec: SnapshotCodec = new BinarySnapshotCodec();
const jsonCodec: SnapshotCodec = new JsonSnapshotCodec();

const defaultNetem: NetemConfig = {
  delay: 0,
  jitter: 0,
  loss: 0
};

const serverStats: ServerStats = {
  tick: 0,
  targetHz: CONFIG.TICK_RATE,
  lastTickDurationMs: 0,
  avgTickDurationMs: 0,
  maxTickDurationMs: 0,
  jitterMs: 0,
  lastTickAt: performance.now()
};

function randomId(prefix: string): string {
  return prefix + Math.floor(rng.next() * 1e9).toString(36);
}

function generateAsteroids(count: number, width = 1200, height = 800): Asteroid[] {
  const list: Asteroid[] = [];
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

function generatePickups(count: number, width = 1200, height = 800): Pickup[] {
  const list: Pickup[] = [];
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

const roomStates = new Map<RoomId, RoomState>([
  [asRoomId('room-1'), { asteroids: generateAsteroids(10), pickups: generatePickups(2), gameOver: false }],
  [asRoomId('room-2'), { asteroids: generateAsteroids(18), pickups: generatePickups(3), gameOver: false }],
  [asRoomId('room-3'), { asteroids: generateAsteroids(6), pickups: generatePickups(1), gameOver: false }]
]);

const rooms: readonly RoomInfo[] = [
  { id: asRoomId('room-1'), name: 'Альфа-Сектор', players: 0, maxPlayers: 4 },
  { id: asRoomId('room-2'), name: 'Оріон-Бета', players: 0, maxPlayers: 4 },
  { id: asRoomId('room-3'), name: 'Тренувальна арена', players: 0, maxPlayers: 4 }
];

const players = new Map<string, PlayerState>();
let nextNetId = 1;

// ============================================================================
// 3. ДОПОМІЖНІ МЕРЕЖЕВІ ТА ФІЗИЧНІ ФУНКЦІЇ
// ============================================================================

function isNewerSeq(seq: number, lastSeq: number): boolean {
  const diff = ((seq & 0xff) - (lastSeq & 0xff) + 256) % 256;
  return diff > 0 && diff < 128;
}

function toArrayBuffer(data: RawData): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  const buf = Array.isArray(data) ? Buffer.concat(data) : data;
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

function wrapCoords(obj: { x: number; y: number }, width = 1200, height = 800): void {
  if (obj.x < 0) obj.x += width;
  if (obj.x > width) obj.x -= width;
  if (obj.y < 0) obj.y += height;
  if (obj.y > height) obj.y -= height;
}

function clampNetem(cfg: Partial<Record<keyof NetemConfig, unknown>> = {}): NetemConfig {
  return {
    delay: Math.max(0, Math.min(2000, Number(cfg.delay) || 0)),
    jitter: Math.max(0, Math.min(1000, Number(cfg.jitter) || 0)),
    loss: Math.max(0, Math.min(0.9, Number(cfg.loss) || 0))
  };
}

function calcNetDelay(netem: NetemConfig): number {
  if (netem.delay === 0 && netem.jitter === 0) return 0;
  const spread = (Math.random() * 2 - 1) * netem.jitter;
  return Math.max(0, netem.delay + spread);
}

function sendWithNetem(player: PlayerState, data: string | ArrayBuffer): void {
  if (player.ws.readyState !== WebSocket.OPEN) return;
  const netem = player.netem;
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

function sendServerMessage(player: PlayerState, msg: ServerMessage): void {
  sendWithNetem(player, JSON.stringify(msg));
}

function sendToRoom(roomId: RoomId | null, data: ServerMessage): void {
  if (!roomId) return;
  const message = JSON.stringify(data);
  players.forEach((p) => {
    if (p.roomId === roomId) {
      sendWithNetem(p, message);
    }
  });
}

function broadcastToOthersInRoom(senderId: string, roomId: RoomId | null, data: ServerMessage): void {
  if (!roomId) return;
  const message = JSON.stringify(data);
  players.forEach((p) => {
    if (p.id !== senderId && p.roomId === roomId) {
      sendWithNetem(p, message);
    }
  });
}

function checkWinCondition(player: PlayerState): void {
  if (!player.roomId) return;
  const roomState = roomStates.get(player.roomId);
  if (roomState && !roomState.gameOver && player.score >= CONFIG.WIN_SCORE) {
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

function allowInputToken(player: PlayerState): boolean {
  const now = performance.now();
  const elapsedSec = (now - player.lastTokenAt) / 1000;
  player.lastTokenAt = now;
  player.tokens = Math.min(60, player.tokens + elapsedSec * 45);
  if (player.tokens < 1) return false;
  player.tokens -= 1;
  return true;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ============================================================================
// 4. HTTP API (HEALTH, ROOMS, STATS, NETEM)
// ============================================================================

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

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
    res.end(
      JSON.stringify({
        ...serverStats,
        connectedPlayers: players.size,
        netem: defaultNetem
      })
    );
    return;
  }

  if (parsedUrl.pathname === '/api/netem') {
    if (
      parsedUrl.searchParams.has('delay') ||
      parsedUrl.searchParams.has('jitter') ||
      parsedUrl.searchParams.has('loss')
    ) {
      Object.assign(
        defaultNetem,
        clampNetem({
          delay: parsedUrl.searchParams.get('delay') ?? defaultNetem.delay,
          jitter: parsedUrl.searchParams.get('jitter') ?? defaultNetem.jitter,
          loss: parsedUrl.searchParams.get('loss') ?? defaultNetem.loss
        })
      );
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

// ============================================================================
// 5. ПЕРІОДИЧНИЙ СПАВН АПТЕЧОК
// ============================================================================

setInterval(() => {
  roomStates.forEach((state, roomId) => {
    if (state.gameOver) return;
    const activePlayers = Array.from(players.values()).filter((p) => p.roomId === roomId);
    if (activePlayers.length > 0 && state.pickups.length < 3) {
      const newPickup: Pickup = {
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

// ============================================================================
// 6. ОБРОБКА ВХІДНИХ ПОВІДОМЛЕНЬ КЛІЄНТА (BINARY + ZOD)
// ============================================================================

function handleClientMessage(player: PlayerState, rawData: RawData, isBinary: boolean): void {
  if (!players.has(player.id)) return;

  if (isBinary) {
    try {
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
        const packet = decodeInput(ab);
        const latestSeq = player.inputQueue[player.inputQueue.length - 1]?.seq ?? player.lastSeq;
        if (!isNewerSeq(packet.seq, latestSeq)) return;
        if (player.inputQueue.length < 64) {
          player.inputQueue.push(packet);
        }
      }
    } catch (err: unknown) {
      console.warn(`[WS Binary Warning] ${player.id}: ${formatError(err)}`);
    }
    return;
  }

  const parsed = parseClientMessage(rawData.toString());
  if (!parsed.ok) {
    console.warn(`[WS Validation Warning] ${player.id}: ${parsed.error}`);
    return;
  }

  const msg = parsed.value;

  switch (msg.type) {
    case 'INPUT': {
      if (!allowInputToken(player)) return;
      const seq = asSeq(msg.payload.seq & 0xff);
      const latestSeq = player.inputQueue[player.inputQueue.length - 1]?.seq ?? player.lastSeq;
      if (!isNewerSeq(seq, latestSeq)) return;
      if (player.inputQueue.length < 64) {
        player.inputQueue.push({
          seq,
          turn: msg.payload.turn,
          thrust: msg.payload.thrust,
          fire: msg.payload.fire
        });
      }
      break;
    }

    case 'PING': {
      sendServerMessage(player, { type: 'PONG', payload: msg.payload });
      break;
    }

    case 'SET_NETEM': {
      player.netem = clampNetem(msg.payload);
      break;
    }

    case 'SET_CODEC': {
      player.codec = msg.payload.codec;
      break;
    }

    case 'JOIN_ROOM': {
      const targetRoomId = asRoomId(msg.payload.roomId);
      player.roomId = targetRoomId;
      player.score = 0;
      player.hp = 100;
      player.x = 600;
      player.y = 400;
      player.angle = 0;
      player.lastSeq = asSeq(0);
      player.inputQueue = [];

      let roomWorld = roomStates.get(targetRoomId);
      if (!roomWorld || roomWorld.asteroids.length === 0 || roomWorld.gameOver) {
        const count = targetRoomId === asRoomId('room-2') ? 18 : targetRoomId === asRoomId('room-3') ? 6 : 10;
        roomWorld = { asteroids: generateAsteroids(count), pickups: generatePickups(2), gameOver: false };
        roomStates.set(targetRoomId, roomWorld);
      }

      const existingRoomPlayers = Array.from(players.values())
        .filter((p) => p.roomId === targetRoomId && p.id !== player.id)
        .map((p) => ({
          id: p.id,
          netId: p.netId,
          x: p.x,
          y: p.y,
          angle: p.angle,
          hp: p.hp,
          score: p.score
        }));

      sendServerMessage(player, {
        type: 'INIT_SELF',
        payload: {
          id: player.id,
          netId: player.netId,
          seed: CONFIG.WORLD_SEED,
          existingPlayers: existingRoomPlayers,
          worldState: roomWorld,
          winScore: CONFIG.WIN_SCORE
        }
      });

      broadcastToOthersInRoom(player.id, player.roomId, {
        type: 'PLAYER_JOINED',
        payload: {
          id: player.id,
          netId: player.netId,
          x: player.x,
          y: player.y,
          angle: player.angle,
          hp: player.hp,
          score: player.score
        }
      });
      break;
    }

    case 'PLAYER_FIRE': {
      if (player.roomId) {
        broadcastToOthersInRoom(player.id, player.roomId, {
          type: 'PLAYER_FIRE',
          payload: { id: player.id, x: player.x, y: player.y, angle: player.angle }
        });
      }
      break;
    }

    case 'PLAYER_HIT': {
      if (player.roomId) {
        player.score += 25;
        const targetPlayer = players.get(msg.payload.targetId);
        if (targetPlayer) {
          targetPlayer.hp = Math.max(0, targetPlayer.hp - msg.payload.damage);
        }
        sendToRoom(player.roomId, {
          type: 'PLAYER_HIT',
          payload: {
            targetId: msg.payload.targetId,
            damage: msg.payload.damage,
            attackerId: player.id,
            attackerScore: player.score
          }
        });
        checkWinCondition(player);
      }
      break;
    }

    case 'ASTEROID_DESTROYED': {
      if (player.roomId) {
        player.score += 10;
        const roomWorld = roomStates.get(player.roomId);
        if (roomWorld) {
          roomWorld.asteroids = roomWorld.asteroids.filter((a) => a.id !== msg.payload.asteroidId);
          sendToRoom(player.roomId, {
            type: 'ASTEROID_DESTROYED',
            payload: {
              asteroidId: msg.payload.asteroidId,
              shooterId: player.id,
              shooterScore: player.score
            }
          });
          checkWinCondition(player);
        }
      }
      break;
    }

    case 'REQUEST_NEW_WAVE': {
      if (player.roomId) {
        const roomWorld = roomStates.get(player.roomId);
        if (roomWorld && !roomWorld.gameOver) {
          const count =
            player.roomId === asRoomId('room-2') ? 18 : player.roomId === asRoomId('room-3') ? 6 : 10;
          roomWorld.asteroids = generateAsteroids(count);
          sendToRoom(player.roomId, {
            type: 'NEW_WAVE',
            payload: { asteroids: roomWorld.asteroids }
          });
        }
      }
      break;
    }

    case 'PICKUP_COLLECTED': {
      if (player.roomId) {
        const roomWorld = roomStates.get(player.roomId);
        if (roomWorld) {
          roomWorld.pickups = roomWorld.pickups.filter((p) => p.id !== msg.payload.pickupId);
        }
        sendToRoom(player.roomId, {
          type: 'PICKUP_COLLECTED',
          payload: { pickupId: msg.payload.pickupId, collectorId: player.id }
        });
      }
      break;
    }

    case 'CHAT': {
      if (player.roomId) {
        sendToRoom(player.roomId, {
          type: 'CHAT',
          payload: {
            senderId: player.id,
            text: msg.payload.text
          }
        });
      }
      break;
    }

    default:
      assertNever(msg);
  }
}

// ============================================================================
// 7. ПІДКЛЮЧЕННЯ WEBSOCKET ТА ІГРОВИЙ ЦИКЛ (30 ГЦ)
// ============================================================================

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const initialNetem = clampNetem({
    delay: reqUrl.searchParams.get('delay') ?? defaultNetem.delay,
    jitter: reqUrl.searchParams.get('jitter') ?? defaultNetem.jitter,
    loss: reqUrl.searchParams.get('loss') ?? defaultNetem.loss
  });

  const netId = asEntityId(nextNetId++);
  const playerId = 'p_' + netId;

  const playerObj: PlayerState = {
    id: playerId,
    netId,
    ws,
    roomId: null,
    x: 600,
    y: 400,
    angle: 0,
    hp: 100,
    score: 0,
    lastSeq: asSeq(0),
    inputQueue: [],
    codec: 'binary',
    netem: initialNetem,
    tokens: 60,
    lastTokenAt: performance.now()
  };

  players.set(playerId, playerObj);
  sendWithNetem(playerObj, encodeWelcome(netId, CONFIG.WORLD_SEED));

  ws.on('message', (rawData: RawData, isBinary: boolean) => {
    const netem = playerObj.netem;
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

function runServerTick(): void {
  const tickStart = performance.now();
  const intervalJitter = Math.abs(tickStart - serverStats.lastTickAt - TICK_MS);
  serverStats.lastTickAt = tickStart;
  serverStats.jitterMs = Number((serverStats.jitterMs * 0.9 + intervalJitter * 0.1).toFixed(2));

  serverStats.tick++;
  const currentTick: Tick = asTick(serverStats.tick);

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
        if (!input) continue;
        applyInput(p, input, DT);
        wrapCoords(p);
        p.lastSeq = asSeq(input.seq & 0xff);
      }
    }

    const snapshotPacket: SnapshotPacket = {
      tick: currentTick,
      ships: roomPlayers.map((p) => ({
        id: p.netId,
        lastSeq: p.lastSeq,
        x: p.x,
        y: p.y,
        angle: p.angle
      }))
    };

    let binaryPayload: ArrayBuffer | string | null = null;
    let jsonPayload: ArrayBuffer | string | null = null;

    for (const p of roomPlayers) {
      if (p.codec === 'json') {
        if (jsonPayload === null) {
          jsonPayload = jsonCodec.encode(snapshotPacket);
        }
        sendWithNetem(p, jsonPayload);
      } else {
        if (binaryPayload === null) {
          binaryPayload = binaryCodec.encode(snapshotPacket);
        }
        sendWithNetem(p, binaryPayload);
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

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`[Server] Авторитативний сервер (${CONFIG.TICK_RATE} Гц, TypeScript) на http://${CONFIG.HOST}:${CONFIG.PORT}`);
});