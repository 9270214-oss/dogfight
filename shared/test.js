import assert from 'node:assert/strict';
import {
  PRNG,
  applyInput,
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot
} from './src/index.js';

const origInput = { seq: 42, turn: -1, thrust: true, fire: false };
const decodedInput = decodeInput(encodeInput(origInput.seq, origInput));
assert.equal(decodedInput.seq, 42);
assert.equal(decodedInput.turn, -1);
assert.equal(decodedInput.thrust, true);
assert.equal(decodedInput.fire, false);

const sampleShips = [
  { id: 1, lastSeq: 120, x: 345.5, y: 612.25, angle: 1.571 },
  { id: 2, lastSeq: 118, x: 890.0, y: 120.75, angle: -2.345 },
  { id: 3, lastSeq: 119, x: 100.25, y: 400.5, angle: 0.123 },
  { id: 4, lastSeq: 121, x: 999.75, y: 710.0, angle: -0.987 }
];

const decodedSnap = decodeSnapshot(encodeSnapshot(300, sampleShips));
assert.equal(decodedSnap.tick, 300);
assert.equal(decodedSnap.ships.length, 4);
for (let i = 0; i < sampleShips.length; i++) {
  assert.equal(decodedSnap.ships[i].id, sampleShips[i].id);
  assert.equal(decodedSnap.ships[i].lastSeq, sampleShips[i].lastSeq);
  assert.ok(Math.abs(decodedSnap.ships[i].x - sampleShips[i].x) < 0.01);
  assert.ok(Math.abs(decodedSnap.ships[i].angle - sampleShips[i].angle) <= 0.001);
}
console.log('[PASS] Round-trip тести DataView пройшли успішно!');

function runSim(seed) {
  const rng = new PRNG(seed);
  const ship = { x: 500, y: 400, angle: 0 };
  for (let i = 0; i < 1000; i++) {
    const cmd = {
      turn: rng.next() > 0.5 ? 1 : -1,
      thrust: rng.next() > 0.3
    };
    applyInput(ship, cmd, 1 / 30);
  }
  return ship;
}

assert.deepEqual(runSim(1337), runSim(1337));
console.log('[PASS] Детермінізм 1000 кроків підтверджено!');

const N = 10000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jsonPayload = { type: 'SNAPSHOT', tick: 300, ships: sampleShips };

const jsonBytes = encoder.encode(JSON.stringify(jsonPayload)).byteLength;
const binBytes = encodeSnapshot(300, sampleShips).byteLength;

const t0 = performance.now();
for (let i = 0; i < N; i++) {
  JSON.parse(decoder.decode(encoder.encode(JSON.stringify(jsonPayload))));
}
const jsonUs = ((performance.now() - t0) * 1000) / N;

const t1 = performance.now();
for (let i = 0; i < N; i++) {
  decodeSnapshot(encodeSnapshot(300, sampleShips));
}
const binUs = ((performance.now() - t1) * 1000) / N;

console.log('\n--- РЕЗУЛЬТАТИ БЕНЧМАРКУ (30 Гц, 4 гравці) ---');
console.log(`JSON:   ${jsonBytes} B/знімок | ${((jsonBytes * 30) / 1024).toFixed(2)} КБ/с | ${jsonUs.toFixed(2)} мкс`);
console.log(`Binary: ${binBytes} B/знімок | ${((binBytes * 30) / 1024).toFixed(2)} КБ/с | ${binUs.toFixed(2)} мкс`);