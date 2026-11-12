import assert from 'node:assert/strict';
import {
  BinarySnapshotCodec,
  JsonSnapshotCodec,
  MSG,
  PRNG,
  applyInput,
  asEntityId,
  asSeq,
  asTick,
  decodeInput,
  decodePing,
  decodeSnapshot,
  decodeWelcome,
  encodeInput,
  encodePing,
  encodeSnapshot,
  encodeWelcome,
  parseClientMessage,
  type PlayerInput,
  type SnapshotPacket
} from './src/index.ts';

// 1. Кругові тести бінарного протоколу з брендованими типами
const welcome = decodeWelcome(encodeWelcome(asEntityId(7), 1337));
assert.equal(welcome.id, 7);
assert.equal(welcome.seed, 1337);

const input = decodeInput(encodeInput(asSeq(42), { turn: -1, thrust: true, fire: false }));
assert.equal(input.seq, 42);
assert.equal(input.turn, -1);
assert.equal(input.thrust, true);
assert.equal(input.fire, false);

const sampleSnapshot: SnapshotPacket = {
  tick: asTick(120),
  ships: [
    { id: asEntityId(1), lastSeq: asSeq(10), x: 320.5, y: 410.25, angle: 1.571 },
    { id: asEntityId(2), lastSeq: asSeq(9), x: 800.0, y: 200.75, angle: -0.785 }
  ]
};

const decodedSnap = decodeSnapshot(encodeSnapshot(sampleSnapshot.tick, sampleSnapshot.ships));
assert.equal(decodedSnap.tick, 120);
assert.equal(decodedSnap.ships.length, 2);
assert.ok(Math.abs((decodedSnap.ships[0]?.x ?? 0) - 320.5) < 0.001);
assert.ok(Math.abs((decodedSnap.ships[0]?.angle ?? 0) - 1.571) < 0.002);

const ping = decodePing(encodePing(MSG.PING, 12345.67));
assert.equal(ping.type, MSG.PING);
assert.equal(ping.timestamp, 12345.67);

// 2. Перевірка валідації на межах (Zod + бінарний декодер)
const badJson = parseClientMessage('{ broken json');
assert.equal(badJson.ok, false);

const badTurn = parseClientMessage({
  type: 'INPUT',
  payload: { seq: 1, turn: 999, thrust: true, fire: false }
});
assert.equal(badTurn.ok, false);

const goodJoin = parseClientMessage({
  type: 'JOIN_ROOM',
  payload: { roomId: 'arena-1' }
});
assert.equal(goodJoin.ok, true);

assert.throws(() => decodeSnapshot(new ArrayBuffer(3)), RangeError);

// 3. Перевірка детермінізму симуляції (1000 кроків)
function runSimulation(seed: number) {
  const rng = new PRNG(seed);
  const ship = { x: 600, y: 400, angle: 0 };
  const dt = 1 / 30;

  for (let i = 0; i < 1000; i++) {
    const r = rng.next();
    const cmd: PlayerInput = {
      turn: r < 0.33 ? -1 : r > 0.66 ? 1 : 0,
      thrust: rng.next() > 0.4,
      fire: false
    };
    applyInput(ship, cmd, dt);
  }
  return ship;
}

const runA = runSimulation(2026);
const runB = runSimulation(2026);
assert.deepEqual(runA, runB);

// 4. Перевірка обох реалізацій SnapshotCodec
const binCodec = new BinarySnapshotCodec();
const jsonCodec = new JsonSnapshotCodec();
assert.equal(binCodec.decode(binCodec.encode(sampleSnapshot)).tick, 120);
assert.equal(jsonCodec.decode(jsonCodec.encode(sampleSnapshot)).tick, 120);

console.log('[OK] shared: перевірка типів, Zod-валідація, бінарний кодек та детермінізм пройдені!');