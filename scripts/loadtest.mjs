import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3099;
const BASE_HTTP = `http://127.0.0.1:${PORT}`;
const BASE_WS = `ws://127.0.0.1:${PORT}`;
const STAGES = [32, 64, 128];
const STAGE_DURATION_MS = 5000;
const ROOMS = ['room-1', 'room-2', 'room-3'];

const PROTOCOL_VERSION = 1;
const MSG_INPUT = 1;
const MSG_SNAPSHOT = 2;
const MSG_PING = 4;
const MSG_PONG = 5;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeInputPacket(seq, turn, thrust, fire) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG_INPUT);
  view.setUint32(2, seq >>> 0, true);
  view.setInt8(6, turn);
  view.setUint8(7, (thrust ? 1 : 0) | (fire ? 2 : 0));
  return Buffer.from(buf);
}

function encodePingPacket(timestamp) {
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG_PING);
  view.setFloat64(2, timestamp, true);
  return Buffer.from(buf);
}

async function waitForServerReady(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_HTTP}/health`);
      if (res.ok) return;
    } catch {
      // Сервер ще запускається
    }
    await sleep(150);
  }
  throw new Error('Таймаут очікування запуску сервера для навантажувального тесту');
}

function createVirtualClient(index) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE_WS);
    ws.binaryType = 'arraybuffer';

    let seq = 0;
    let snapshotsReceived = 0;
    let bytesReceived = 0;
    const rttSamples = [];

    ws.on('open', () => {
      const roomId = ROOMS[index % ROOMS.length];
      ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId } }));
      resolve({
        ws,
        sendTick() {
          if (ws.readyState !== WebSocket.OPEN) return;
          seq = ((seq + 1) & 0xff) || 1;
          const turn = (index % 3) - 1;
          ws.send(encodeInputPacket(seq, turn, true, seq % 10 === 0));
        },
        sendPing() {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(encodePingPacket(performance.now()));
        },
        getMetrics() {
          return { snapshotsReceived, bytesReceived, rttSamples };
        },
        close() {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        }
      });
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        bytesReceived += Buffer.byteLength(data.toString());
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      bytesReceived += buf.byteLength;
      if (buf.byteLength < 2) return;

      const msgType = buf.readUInt8(1);
      if (msgType === MSG_SNAPSHOT) {
        snapshotsReceived++;
      } else if (msgType === MSG_PONG && buf.byteLength >= 10) {
        const sentAt = buf.readDoubleLE(2);
        rttSamples.push(Math.max(0, performance.now() - sentAt));
      }
    });

    ws.on('error', reject);
  });
}

async function runStage(clientCount) {
  const clients = [];
  for (let i = 0; i < clientCount; i++) {
    clients.push(await createVirtualClient(i));
  }

  // Прогрів 300 мс після підключення всіх клієнтів
  await sleep(300);

  const inputTimer = setInterval(() => {
    for (const c of clients) c.sendTick();
  }, 33);

  const pingTimer = setInterval(() => {
    for (const c of clients) c.sendPing();
  }, 250);

  await sleep(STAGE_DURATION_MS);

  clearInterval(inputTimer);
  clearInterval(pingTimer);

  const statsRes = await fetch(`${BASE_HTTP}/api/stats`);
  const serverStats = await statsRes.json();

  let totalSnapshots = 0;
  let totalBytes = 0;
  const allRtts = [];

  for (const c of clients) {
    const m = c.getMetrics();
    totalSnapshots += m.snapshotsReceived;
    totalBytes += m.bytesReceived;
    allRtts.push(...m.rttSamples);
    c.close();
  }

  // Пауза на коректне закриття сокетів перед наступним етапом
  await sleep(400);

  allRtts.sort((a, b) => a - b);
  const durationSec = STAGE_DURATION_MS / 1000;

  return {
    clients: clientCount,
    snapshotsPerSec: Math.round(totalSnapshots / durationSec),
    rxKBps: (totalBytes / 1024 / durationSec).toFixed(1),
    rttP50: percentile(allRtts, 50).toFixed(2),
    rttP95: percentile(allRtts, 95).toFixed(2),
    rttP99: percentile(allRtts, 99).toFixed(2),
    tickAvgMs: serverStats.avgTickDurationMs,
    tickMaxMs: serverStats.maxTickDurationMs,
    tickJitterMs: serverStats.jitterMs
  };
}

async function main() {
  console.log('=== ЗАПУСК НАВАНТАЖУВАЛЬНОГО ТЕСТУВАННЯ (32 / 64 / 128 КЛІЄНТІВ) ===\n');

  const serverProc = spawn(process.execPath, ['server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  try {
    await waitForServerReady();
    const results = [];

    for (const count of STAGES) {
      console.log(`Тестування навантаження: ${count} одночасних клієнтів (${STAGE_DURATION_MS / 1000} с)...`);
      const report = await runStage(count);
      results.push(report);
    }

    console.log('\n=== РЕЗУЛЬТАТИ НАВАНТАЖУВАЛЬНОГО ТЕСТУВАННЯ ===');
    console.table(results);
  } finally {
    serverProc.kill();
  }
}

main().catch((err) => {
  console.error('Помилка навантажувального тесту:', err);
  process.exitCode = 1;
});