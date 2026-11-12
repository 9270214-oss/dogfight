export const PROTOCOL_VERSION = 1;

export const MSG = {
  INPUT: 1,
  SNAPSHOT: 2,
  WELCOME: 3,
  PING: 4,
  PONG: 5
};

function normalizeAngle(rad) {
  const twoPi = Math.PI * 2;
  return (((rad + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
}

export function encodeWelcome(id, seed) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.WELCOME);
  view.setUint16(2, id, true);
  view.setUint32(4, seed, true);
  return buf;
}

export function decodeWelcome(buf) {
  const view = new DataView(buf);
  return {
    version: view.getUint8(0),
    type: view.getUint8(1),
    id: view.getUint16(2, true),
    seed: view.getUint32(4, true)
  };
}

export function encodeInput(seq, input) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.INPUT);
  view.setUint32(2, seq, true);
  view.setInt8(6, Math.max(-1, Math.min(1, Math.round(input.turn || 0))));

  let flags = 0;
  if (input.thrust) flags |= 1;
  if (input.fire) flags |= 2;
  view.setUint8(7, flags);

  return buf;
}

export function decodeInput(buf) {
  const view = new DataView(buf);
  const flags = view.getUint8(7);
  return {
    version: view.getUint8(0),
    type: view.getUint8(1),
    seq: view.getUint32(2, true),
    turn: view.getInt8(6),
    thrust: (flags & 1) !== 0,
    fire: (flags & 2) !== 0
  };
}

export function encodeSnapshot(tick, ships) {
  const buf = new ArrayBuffer(7 + ships.length * 16);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.SNAPSHOT);
  view.setUint32(2, tick, true);
  view.setUint8(6, ships.length);

  let offset = 7;
  for (const s of ships) {
    view.setUint16(offset, s.id, true);
    view.setUint32(offset + 2, s.lastSeq || 0, true);
    view.setFloat32(offset + 6, s.x, true);
    view.setFloat32(offset + 10, s.y, true);
    view.setInt16(offset + 14, Math.round(normalizeAngle(s.angle || 0) * 1000), true);
    offset += 16;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const view = new DataView(buf);
  const version = view.getUint8(0);
  const type = view.getUint8(1);
  const tick = view.getUint32(2, true);
  const count = view.getUint8(6);
  const ships = [];

  let offset = 7;
  for (let i = 0; i < count; i++) {
    ships.push({
      id: view.getUint16(offset, true),
      lastSeq: view.getUint32(offset + 2, true),
      x: view.getFloat32(offset + 6, true),
      y: view.getFloat32(offset + 10, true),
      angle: view.getInt16(offset + 14, true) / 1000
    });
    offset += 16;
  }
  return { version, type, tick, ships };
}

export function encodePing(type, timestamp) {
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, type);
  view.setFloat64(2, timestamp, true);
  return buf;
}

export function decodePing(buf) {
  const view = new DataView(buf);
  return {
    version: view.getUint8(0),
    type: view.getUint8(1),
    timestamp: view.getFloat64(2, true)
  };
}