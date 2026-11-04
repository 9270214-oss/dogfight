import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const WIN_SCORE = 100; // Кількість очок для перемоги у матчі

function generateAsteroids(count, width = 1200, height = 800) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      id: 'ast_' + Math.random().toString(36).substring(2, 9),
      x: Math.random() * (width - 100) + 50,
      y: Math.random() * (height - 100) + 50,
      vx: (Math.random() - 0.5) * 60,
      vy: (Math.random() - 0.5) * 60
    });
  }
  return list;
}

function generatePickups(count, width = 1200, height = 800) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      id: 'pik_' + Math.random().toString(36).substring(2, 9),
      x: Math.random() * (width - 100) + 50,
      y: Math.random() * (height - 100) + 50,
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  if (req.url === '/api/rooms') {
    const updatedRooms = rooms.map((r) => {
      const count = Array.from(players.values()).filter((p) => p.roomId === r.id).length;
      return { ...r, players: count };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updatedRooms));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

function sendToRoom(roomId, data) {
  if (!roomId) return;
  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const targetPlayer = Array.from(players.values()).find((p) => p.ws === client);
      if (targetPlayer && targetPlayer.roomId === roomId) {
        client.send(message);
      }
    }
  });
}

function broadcastToOthersInRoom(senderWs, roomId, data) {
  if (!roomId) return;
  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      const targetPlayer = Array.from(players.values()).find((p) => p.ws === client);
      if (targetPlayer && targetPlayer.roomId === roomId) {
        client.send(message);
      }
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

// ПЕРІОДИЧНИЙ СПАВН АПТЕЧОК
setInterval(() => {
  roomStates.forEach((state, roomId) => {
    if (state.gameOver) return;
    const activePlayers = Array.from(players.values()).filter((p) => p.roomId === roomId);
    if (activePlayers.length > 0 && state.pickups.length < 3) {
      const newPickup = {
        id: 'pik_' + Math.random().toString(36).substring(2, 9),
        x: Math.random() * 1000 + 100,
        y: Math.random() * 600 + 100,
        type: 'heal'
      };
      state.pickups.push(newPickup);
      sendToRoom(roomId, { type: 'SPAWN_PICKUP', payload: newPickup });
    }
  });
}, 12000);

wss.on('connection', (ws) => {
  const playerId = Math.random().toString(36).substring(2, 9);

  players.set(playerId, {
    id: playerId,
    ws: ws,
    roomId: null,
    x: 0,
    y: 0,
    angle: 0,
    hp: 100,
    score: 0
  });

  ws.on('message', (rawData) => {
    try {
      const { type, payload } = JSON.parse(rawData.toString());
      const player = players.get(playerId);
      if (!player) return;

      if (type === 'JOIN_ROOM') {
        player.roomId = payload.roomId;
        player.score = 0;
        player.hp = 100;
        let roomWorld = roomStates.get(payload.roomId);

        if (!roomWorld || !roomWorld.asteroids || roomWorld.asteroids.length === 0 || roomWorld.gameOver) {
          const count = payload.roomId === 'room-2' ? 18 : (payload.roomId === 'room-3' ? 6 : 10);
          roomWorld = { asteroids: generateAsteroids(count), pickups: generatePickups(2), gameOver: false };
          roomStates.set(payload.roomId, roomWorld);
        }

        const existingRoomPlayers = Array.from(players.values())
          .filter((p) => p.roomId === payload.roomId && p.id !== playerId)
          .map((p) => ({ id: p.id, x: p.x, y: p.y, angle: p.angle, hp: p.hp, score: p.score }));

        ws.send(JSON.stringify({
          type: 'INIT_SELF',
          payload: {
            id: playerId,
            existingPlayers: existingRoomPlayers,
            worldState: roomWorld,
            winScore: WIN_SCORE
          }
        }));

        broadcastToOthersInRoom(ws, player.roomId, {
          type: 'PLAYER_JOINED',
          payload: { id: playerId, x: player.x, y: player.y, angle: player.angle, hp: player.hp, score: player.score }
        });

      } else if (type === 'PLAYER_STATE') {
        player.x = payload.x;
        player.y = payload.y;
        player.angle = payload.angle;
        player.hp = payload.hp ?? player.hp;

        if (player.roomId) {
          broadcastToOthersInRoom(ws, player.roomId, {
            type: 'PLAYER_MOVED',
            payload: { id: playerId, x: player.x, y: player.y, angle: player.angle, hp: player.hp, score: player.score }
          });
        }

      } else if (type === 'PLAYER_FIRE') {
        if (player.roomId) {
          broadcastToOthersInRoom(ws, player.roomId, {
            type: 'PLAYER_FIRE',
            payload: { id: playerId, ...payload }
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
              attackerId: playerId,
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
                shooterId: playerId,
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
            payload: { pickupId: payload.pickupId, collectorId: playerId }
          });
        }
      }
    } catch (err) {
      console.error('[WS Error]', err);
    }
  });

  ws.on('close', () => {
    const player = players.get(playerId);
    if (player && player.roomId) {
      broadcastToOthersInRoom(ws, player.roomId, {
        type: 'PLAYER_DISCONNECTED',
        payload: { id: playerId }
      });
    }
    players.delete(playerId);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Server] Сервер запущено на http://${HOST}:${PORT}`);
});