import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  asEntityId,
  asRoomId,
  asSeq,
  asTick,
  assertNever,
  applyInput,
  BinarySnapshotCodec,
  decodeInput,
  decodePing,
  decodeSnapshot,
  decodeWelcome,
  encodeInput,
  encodePing,
  encodeSnapshot,
  encodeWelcome,
  JsonSnapshotCodec,
  MSG,
  parseClientMessage,
  parseServerMessage,
  PHYSICS,
  PRNG,
  PROTOCOL_VERSION,
  stepWorld,
  type ClientMessage,
  type PlayerInput,
  type SnapshotShipState
} from './index.ts';

describe('PRNG (детермінований генератор)', () => {
  it('генерує ідентичну послідовність чисел для однакового seed', () => {
    const a = new PRNG(1337);
    const b = new PRNG(1337);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('генерує різні послідовності для різних seed', () => {
    const a = new PRNG(1337);
    const b = new PRNG(42);
    expect(a.next()).not.toBe(b.next());
  });

  it('range(min, max) повертає значення строго в межах [min, max)', () => {
    const rng = new PRNG(999);
    for (let i = 0; i < 100; i++) {
      const val = rng.range(-50, 150);
      expect(val).toBeGreaterThanOrEqual(-50);
      expect(val).toBeLessThan(150);
    }
  });
});

describe('Branded types (номінальні обгортки)', () => {
  it('зберігають базові значення EntityId, Tick, Seq та RoomId', () => {
    expect(asEntityId(7)).toBe(7);
    expect(asTick(120)).toBe(120);
    expect(asSeq(15)).toBe(15);
    expect(asRoomId('room-1')).toBe('room-1');
  });
});

describe('Симуляція фізики (applyInput та stepWorld)', () => {
  it('не змінює позицію та кут при нульовому введенні', () => {
    const ship = { x: 100, y: 200, angle: 0.5 };
    applyInput(ship, { turn: 0, thrust: false, fire: false }, 0.1);
    expect(ship).toEqual({ x: 100, y: 200, angle: 0.5 });
  });

  it('повертає корабель відповідно до TURN_SPEED * dt', () => {
    const ship = { x: 0, y: 0, angle: 0 };
    applyInput(ship, { turn: 1, thrust: false, fire: false }, 0.5);
    expect(ship.angle).toBeCloseTo(PHYSICS.TURN_SPEED * 0.5, 6);
  });

  it('переміщує корабель уздовж напрямку кута при thrust: true', () => {
    const ship = { x: 10, y: 20, angle: 0 };
    applyInput(ship, { turn: 0, thrust: true, fire: false }, 0.25);
    expect(ship.x).toBeCloseTo(10 + PHYSICS.THRUST_SPEED * 0.25, 6);
    expect(ship.y).toBeCloseTo(20, 6);
  });

  it('stepWorld інтегрує координати всіх рухомих тіл за крок dt', () => {
    const bodies = [
      { x: 0, y: 0, vx: 100, vy: -50 },
      { x: 50, y: 50, vx: -20, vy: 40 }
    ];
    stepWorld(bodies, 0.5);
    expect(bodies[0]).toEqual({ x: 50, y: -25, vx: 100, vy: -50 });
    expect(bodies[1]).toEqual({ x: 40, y: 70, vx: -20, vy: 40 });
  });

  it('детермінованість: два клони світу після 500 кроків дають ідентичний стан', () => {
    const rng = new PRNG(2026);
    const inputs: PlayerInput[] = Array.from({ length: 500 }, () => ({
      turn: (Math.floor(rng.range(0, 3)) - 1) as -1 | 0 | 1,
      thrust: rng.next() > 0.4,
      fire: rng.next() > 0.7
    }));

    const shipA = { x: 600, y: 400, angle: 0 };
    const shipB = structuredClone(shipA);
    const bodiesA = [{ x: 100, y: 150, vx: 35, vy: -22 }];
    const bodiesB = structuredClone(bodiesA);

    for (const inp of inputs) {
      applyInput(shipA, inp, 1 / 30);
      stepWorld(bodiesA, 1 / 30);

      applyInput(shipB, inp, 1 / 30);
      stepWorld(bodiesB, 1 / 30);
    }

    expect(shipA).toEqual(shipB);
    expect(bodiesA).toEqual(bodiesB);
  });
});

describe('Протокол та Zod-парсери (parseClientMessage / parseServerMessage)', () => {
  it('assertNever кидає виняток при передачі неочікуваного значення', () => {
    expect(() => assertNever('UNKNOWN_VARIANT' as never)).toThrow();
  });

  it('parseClientMessage приймає валідні повідомлення у вигляді JSON-рядка та об’єкта', () => {
    const resStr = parseClientMessage(
      JSON.stringify({ type: 'INPUT', payload: { seq: 1, turn: -1, thrust: true, fire: false } })
    );
    expect(resStr.ok).toBe(true);

    const resWave = parseClientMessage({ type: 'REQUEST_NEW_WAVE' });
    expect(resWave.ok).toBe(true);
  });

  it('parseClientMessage відхиляє битий JSON та невалідні поля', () => {
    expect(parseClientMessage('{bad json').ok).toBe(false);
    expect(
      parseClientMessage({ type: 'INPUT', payload: { seq: 1, turn: 1e9, thrust: true, fire: false } }).ok
    ).toBe(false);
    expect(parseClientMessage({ type: 'JOIN_ROOM', payload: { roomId: '' } }).ok).toBe(false);
  });

  it('parseServerMessage приймає валідні серверні пакети та відхиляє пошкоджені', () => {
    const validPong = parseServerMessage(JSON.stringify({ type: 'PONG', payload: 12345 }));
    expect(validPong.ok).toBe(true);

    const validSnap = parseServerMessage({
      type: 'SNAPSHOT',
      tick: 10,
      ships: [{ id: 1, lastSeq: 2, x: 100, y: 200, angle: 0 }]
    });
    expect(validSnap.ok).toBe(true);

    expect(parseServerMessage('{broken').ok).toBe(false);
    expect(parseServerMessage({ type: 'SNAPSHOT', tick: -5, ships: [] }).ok).toBe(false);
  });
});

describe('Бінарний та JSON кодеки', () => {
  it('encodeWelcome / decodeWelcome коректно кодують та декодують пакет (8 байтів)', () => {
    const buf = encodeWelcome(asEntityId(42), 1337);
    expect(buf.byteLength).toBe(8);
    const decoded = decodeWelcome(buf);
    expect(decoded).toEqual({ id: asEntityId(42), seed: 1337 });
  });

  it('encodeInput / decodeInput коректно кодують та декодують команди керування (8 байтів)', () => {
    const buf = encodeInput(asSeq(77), { turn: -1, thrust: true, fire: true });
    expect(buf.byteLength).toBe(8);
    const decoded = decodeInput(buf);
    expect(decoded).toEqual({ seq: asSeq(77), turn: -1, thrust: true, fire: true });
  });

  it('decodeInput кидає RangeError при seq === 0 або невалідному turn', () => {
    const badSeq = encodeInput(asSeq(1), { turn: 0, thrust: false, fire: false });
    new DataView(badSeq).setUint32(2, 0, true);
    expect(() => decodeInput(badSeq)).toThrow(RangeError);

    const badTurn = encodeInput(asSeq(1), { turn: 0, thrust: false, fire: false });
    new DataView(badTurn).setInt8(6, 5);
    expect(() => decodeInput(badTurn)).toThrow(RangeError);
  });

  it('encodePing / decodePing коректно працюють для PING та PONG (10 байтів)', () => {
    const pingBuf = encodePing(MSG.PING, 987654.321);
    expect(pingBuf.byteLength).toBe(10);
    expect(decodePing(pingBuf)).toEqual({ type: MSG.PING, timestamp: 987654.321 });

    const pongBuf = encodePing(MSG.PONG, 111222.5);
    expect(decodePing(pongBuf)).toEqual({ type: MSG.PONG, timestamp: 111222.5 });
  });

  it('decodePing кидає RangeError на короткому буфері або неправильному заголовку', () => {
    expect(() => decodePing(new ArrayBuffer(4))).toThrow(RangeError);
    const badVer = encodePing(MSG.PING, 100);
    new DataView(badVer).setUint8(0, 99);
    expect(() => decodePing(badVer)).toThrow(RangeError);
  });

  it('encodeSnapshot / decodeSnapshot перевіряють ліміт кораблів, розмір та невалідні координати', () => {
    const tooMany = Array.from({ length: 256 }, (_, i) => ({
      id: asEntityId(i),
      lastSeq: asSeq(1),
      x: 0,
      y: 0,
      angle: 0
    }));
    expect(() => encodeSnapshot(asTick(1), tooMany)).toThrow(RangeError);

    const buf = encodeSnapshot(asTick(5), [
      { id: asEntityId(1), lastSeq: asSeq(3), x: 100, y: 200, angle: 0.5 }
    ]);
    // Обрізаємо 2 байти
    expect(() => decodeSnapshot(buf.slice(0, buf.byteLength - 2))).toThrow(RangeError);

    // Записуємо NaN у координату x
    const nanBuf = encodeSnapshot(asTick(5), [
      { id: asEntityId(1), lastSeq: asSeq(3), x: 100, y: 200, angle: 0.5 }
    ]);
    new DataView(nanBuf).setFloat32(13, Number.NaN, true);
    expect(() => decodeSnapshot(nanBuf)).toThrow(RangeError);
  });

  it('BinarySnapshotCodec та JsonSnapshotCodec працюють симетрично і перевіряють тип входу', () => {
    const binCodec = new BinarySnapshotCodec();
    const jsonCodec = new JsonSnapshotCodec();
    const snap = {
      tick: asTick(12),
      ships: [{ id: asEntityId(3), lastSeq: asSeq(9), x: 320.5, y: 410.25, angle: 1.234 }]
    };

    const binData = binCodec.encode(snap);
    expect(binData).toBeInstanceOf(ArrayBuffer);
    const fromBin = binCodec.decode(binData);
    expect(fromBin.tick).toBe(snap.tick);
    expect(fromBin.ships[0]?.angle).toBeCloseTo(1.234, 3);
    expect(() => binCodec.decode('not-binary')).toThrow(TypeError);

    const jsonData = jsonCodec.encode(snap);
    expect(typeof jsonData).toBe('string');
    expect(jsonCodec.decode(jsonData)).toEqual(snap);
    expect(() => jsonCodec.decode(new ArrayBuffer(8))).toThrow(TypeError);
    expect(() => jsonCodec.decode('{"type":"PONG","payload":1}')).toThrow();
  });
});

describe('Property-based тести (fast-check, ≥ 5 властивостей)', () => {
  const shipArb: fc.Arbitrary<SnapshotShipState> = fc.record({
    id: fc.integer({ min: 0, max: 65535 }).map(asEntityId),
    lastSeq: fc.integer({ min: 0, max: 0xffffffff }).map(asSeq),
    x: fc.double({ min: -5000, max: 5000, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -5000, max: 5000, noNaN: true, noDefaultInfinity: true }),
    angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true })
  });

  it('Властивість 1: round-trip бінарного знімка зберігає стан із точністю квантування кута (0.001 рад)', () => {
    const codec = new BinarySnapshotCodec();
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }).map(asTick),
        fc.array(shipArb, { minLength: 0, maxLength: 25 }),
        (tick, ships) => {
          const encoded = codec.encode({ tick, ships });
          const decoded = codec.decode(encoded);
          expect(decoded.tick).toBe(tick);
          expect(decoded.ships.length).toBe(ships.length);
          for (let i = 0; i < ships.length; i++) {
            const orig = ships[i]!;
            const dec = decoded.ships[i]!;
            expect(dec.id).toBe(orig.id);
            expect(dec.lastSeq).toBe(orig.lastSeq);
            expect(Math.abs(dec.x - orig.x)).toBeLessThan(0.01);
            expect(Math.abs(dec.y - orig.y)).toBeLessThan(0.01);
            expect(Math.abs(dec.angle - orig.angle)).toBeLessThanOrEqual(0.0011);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Властивість 2: довжина бінарного кадру точно відповідає специфікації формату (7 + 16 * N)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }).map(asTick),
        fc.array(shipArb, { minLength: 0, maxLength: 40 }),
        (tick, ships) => {
          const buf = encodeSnapshot(tick, ships);
          expect(buf.byteLength).toBe(7 + ships.length * 16);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Властивість 3: довільні биті буфери сміття кидають лише очікуваний RangeError і не валять процес', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 128 }), (bytes) => {
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const decoders = [decodeSnapshot, decodeInput, decodeWelcome, decodePing];
        for (const fn of decoders) {
          try {
            fn(buf);
          } catch (err: unknown) {
            expect(err).toBeInstanceOf(RangeError);
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('Властивість 4: корабель залишається в межах тороїдальної арени 1200×800 після 1000 випадкових кроків', () => {
    const inputArb: fc.Arbitrary<PlayerInput> = fc.record({
      turn: fc.constantFrom(-1 as const, 0 as const, 1 as const),
      thrust: fc.boolean(),
      fire: fc.boolean()
    });

    fc.assert(
      fc.property(fc.array(inputArb, { minLength: 1000, maxLength: 1000 }), (inputs) => {
        const WORLD_W = 1200;
        const WORLD_H = 800;
        const ship = { x: 600, y: 400, angle: 0 };

        for (const inp of inputs) {
          applyInput(ship, inp, 1 / 30);
          ship.x = ((ship.x % WORLD_W) + WORLD_W) % WORLD_W;
          ship.y = ((ship.y % WORLD_H) + WORLD_H) % WORLD_H;
        }

        expect(ship.x).toBeGreaterThanOrEqual(0);
        expect(ship.x).toBeLessThan(WORLD_W);
        expect(ship.y).toBeGreaterThanOrEqual(0);
        expect(ship.y).toBeLessThan(WORLD_H);
        expect(Number.isFinite(ship.angle)).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('Властивість 5: parseClientMessage приймає кожне валідне повідомлення і відхиляє зіпсовані мутації', () => {
    const validMsgArb: fc.Arbitrary<ClientMessage> = fc.oneof(
      fc.record({
        type: fc.constant('JOIN_ROOM' as const),
        payload: fc.record({ roomId: fc.string({ minLength: 1, maxLength: 32 }) })
      }),
      fc.record({
        type: fc.constant('INPUT' as const),
        payload: fc.record({
          seq: fc.integer({ min: 1, max: 1_000_000 }),
          turn: fc.constantFrom(-1 as const, 0 as const, 1 as const),
          thrust: fc.boolean(),
          fire: fc.boolean()
        })
      }),
      fc.record({
        type: fc.constant('PING' as const),
        payload: fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true })
      }),
      fc.record({
        type: fc.constant('SET_CODEC' as const),
        payload: fc.record({ codec: fc.constantFrom('binary' as const, 'json' as const) })
      }),
      fc.record({
        type: fc.constant('REQUEST_NEW_WAVE' as const)
      })
    );

    const invalidMsgArb = fc.oneof(
      fc.record({
        type: fc.constant('INPUT'),
        payload: fc.record({
          seq: fc.integer({ min: -1000, max: 0 }),
          turn: fc.integer({ min: 2, max: 100 }),
          thrust: fc.boolean(),
          fire: fc.boolean()
        })
      }),
      fc.record({
        type: fc.constant('JOIN_ROOM'),
        payload: fc.record({ roomId: fc.constant('') })
      }),
      fc.record({
        type: fc.constant('UNKNOWN_TYPE'),
        payload: fc.anything()
      })
    );

    fc.assert(
      fc.property(validMsgArb, invalidMsgArb, (validMsg, invalidMsg) => {
        expect(parseClientMessage(validMsg).ok).toBe(true);
        expect(parseClientMessage(JSON.stringify(validMsg)).ok).toBe(true);
        expect(parseClientMessage(invalidMsg).ok).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});