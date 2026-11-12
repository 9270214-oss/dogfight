import { z } from 'zod';
import {
  asEntityId,
  asSeq,
  asTick,
  type EntityId,
  type PlayerInput,
  type Seq,
  type Tick
} from './types.ts';

export const PROTOCOL_VERSION = 1 as const;

export const MSG = {
  INPUT: 1,
  SNAPSHOT: 2,
  WELCOME: 3,
  PING: 4,
  PONG: 5
} as const;

export type BinaryMsgType = (typeof MSG)[keyof typeof MSG];

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function assertNever(value: never): never {
  throw new Error(`Необроблений варіант дискримінованого об'єднання: ${JSON.stringify(value)}`);
}

// ============================================================================
// 1. ZOD-СХЕМИ ПОВІДОМЛЕНЬ КЛІЄНТ -> СЕРВЕР
// ============================================================================

const TurnSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

export const ClientInputPayloadSchema = z.object({
  seq: z.number().int().positive(),
  turn: TurnSchema,
  thrust: z.boolean(),
  fire: z.boolean()
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('JOIN_ROOM'),
    payload: z.object({ roomId: z.string().min(1).max(64) })
  }),
  z.object({
    type: z.literal('INPUT'),
    payload: ClientInputPayloadSchema
  }),
  z.object({
    type: z.literal('PING'),
    payload: z.number().finite()
  }),
  z.object({
    type: z.literal('SET_NETEM'),
    payload: z.object({
      delay: z.number().min(0).max(2000).optional(),
      jitter: z.number().min(0).max(1000).optional(),
      loss: z.number().min(0).max(0.9).optional()
    })
  }),
  z.object({
    type: z.literal('SET_CODEC'),
    payload: z.object({
      codec: z.union([z.literal('binary'), z.literal('json')])
    })
  }),
  z.object({
    type: z.literal('PLAYER_FIRE'),
    payload: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      angle: z.number().finite()
    })
  }),
  z.object({
    type: z.literal('PLAYER_HIT'),
    payload: z.object({
      targetId: z.string().min(1),
      damage: z.number().min(1).max(100)
    })
  }),
  z.object({
    type: z.literal('ASTEROID_DESTROYED'),
    payload: z.object({
      asteroidId: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal('REQUEST_NEW_WAVE')
  }),
  z.object({
    type: z.literal('PICKUP_COLLECTED'),
    payload: z.object({
      pickupId: z.string().min(1)
    })
  })
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ============================================================================
// 2. ZOD-СХЕМИ ПОВІДОМЛЕНЬ СЕРВЕР -> КЛІЄНТ
// ============================================================================

const RemotePlayerSchema = z.object({
  id: z.string(),
  netId: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  angle: z.number().finite(),
  hp: z.number().finite(),
  score: z.number().finite()
});

const AsteroidDtoSchema = z.object({
  id: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite()
});

const PickupDtoSchema = z.object({
  id: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  type: z.string()
});

const JsonSnapshotShipSchema = z.object({
  id: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  angle: z.number().finite()
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('INIT_SELF'),
    payload: z.object({
      id: z.string(),
      netId: z.number().int().nonnegative(),
      seed: z.number().int().nonnegative(),
      existingPlayers: z.array(RemotePlayerSchema),
      worldState: z.object({
        asteroids: z.array(AsteroidDtoSchema),
        pickups: z.array(PickupDtoSchema),
        gameOver: z.boolean()
      }),
      winScore: z.number().positive()
    })
  }),
  z.object({
    type: z.literal('PLAYER_JOINED'),
    payload: RemotePlayerSchema
  }),
  z.object({
    type: z.literal('PLAYER_DISCONNECTED'),
    payload: z.object({ id: z.string() })
  }),
  z.object({
    type: z.literal('PLAYER_FIRE'),
    payload: z.object({
      id: z.string(),
      x: z.number().finite(),
      y: z.number().finite(),
      angle: z.number().finite()
    })
  }),
  z.object({
    type: z.literal('PLAYER_HIT'),
    payload: z.object({
      targetId: z.string(),
      damage: z.number().finite(),
      attackerId: z.string(),
      attackerScore: z.number().finite()
    })
  }),
  z.object({
    type: z.literal('ASTEROID_DESTROYED'),
    payload: z.object({
      asteroidId: z.string(),
      shooterId: z.string(),
      shooterScore: z.number().finite()
    })
  }),
  z.object({
    type: z.literal('NEW_WAVE'),
    payload: z.object({
      asteroids: z.array(AsteroidDtoSchema)
    })
  }),
  z.object({
    type: z.literal('SPAWN_PICKUP'),
    payload: PickupDtoSchema
  }),
  z.object({
    type: z.literal('PICKUP_COLLECTED'),
    payload: z.object({
      pickupId: z.string(),
      collectorId: z.string()
    })
  }),
  z.object({
    type: z.literal('GAME_OVER'),
    payload: z.object({
      winnerId: z.string(),
      winnerScore: z.number().finite()
    })
  }),
  z.object({
    type: z.literal('SNAPSHOT'),
    tick: z.number().int().nonnegative(),
    ships: z.array(JsonSnapshotShipSchema)
  }),
  z.object({
    type: z.literal('PONG'),
    payload: z.number().finite()
  })
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ============================================================================
// 3. БЕЗПЕЧНИЙ ПАРСИНГ НА МЕЖАХ (UNKNOWN -> RESULT)
// ============================================================================

export function parseClientMessage(raw: unknown): Result<ClientMessage> {
  let parsedJson: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Некоректний синтаксис JSON' };
    }
  }

  const res = ClientMessageSchema.safeParse(parsedJson);
  if (!res.success) {
    const details = res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, error: details };
  }

  return { ok: true, value: res.data };
}

export function parseServerMessage(raw: unknown): Result<ServerMessage> {
  let parsedJson: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Некоректний синтаксис JSON від сервера' };
    }
  }

  const res = ServerMessageSchema.safeParse(parsedJson);
  if (!res.success) {
    const details = res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, error: details };
  }

  return { ok: true, value: res.data };
}

// ============================================================================
// 4. БІНАРНИЙ КОДЕК (DATAVIEW, LITTLE-ENDIAN) З ПЕРЕВІРКОЮ МЕЖ ТА ВЕРСІЇ
// ============================================================================

export interface WelcomePacket {
  readonly id: EntityId;
  readonly seed: number;
}

export interface InputPacket extends PlayerInput {
  readonly seq: Seq;
}

export interface SnapshotShipState {
  readonly id: EntityId;
  readonly lastSeq: Seq;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface SnapshotPacket {
  readonly tick: Tick;
  readonly ships: readonly SnapshotShipState[];
}

export interface PingPacket {
  readonly type: typeof MSG.PING | typeof MSG.PONG;
  readonly timestamp: number;
}

function assertHeader(view: DataView, expectedType: BinaryMsgType, minBytes: number): void {
  if (view.byteLength < minBytes) {
    throw new RangeError(`Пакет занадто короткий: отримано ${view.byteLength} Б, очікувалось >= ${minBytes} Б`);
  }
  const version = view.getUint8(0);
  if (version !== PROTOCOL_VERSION) {
    throw new RangeError(`Непідтримувана версія протоколу: ${version}`);
  }
  const type = view.getUint8(1);
  if (type !== expectedType) {
    throw new RangeError(`Неочікуваний тип пакета: ${type}, очікувався ${expectedType}`);
  }
}

export function encodeWelcome(id: EntityId, seed: number): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.WELCOME);
  view.setUint16(2, id, true);
  view.setUint32(4, seed >>> 0, true);
  return buf;
}

export function decodeWelcome(buf: ArrayBuffer): WelcomePacket {
  const view = new DataView(buf);
  assertHeader(view, MSG.WELCOME, 8);
  return {
    id: asEntityId(view.getUint16(2, true)),
    seed: view.getUint32(4, true)
  };
}

export function encodeInput(seq: Seq, input: PlayerInput): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.INPUT);
  view.setUint32(2, seq >>> 0, true);
  view.setInt8(6, input.turn);
  const flags = (input.thrust ? 1 : 0) | (input.fire ? 2 : 0);
  view.setUint8(7, flags);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): InputPacket {
  const view = new DataView(buf);
  assertHeader(view, MSG.INPUT, 8);
  const seqNum = view.getUint32(2, true);
  if (seqNum <= 0) {
    throw new RangeError(`Невалідний seq у бінарному пакеті INPUT: ${seqNum}`);
  }
  const rawTurn = view.getInt8(6);
  if (rawTurn !== -1 && rawTurn !== 0 && rawTurn !== 1) {
    throw new RangeError(`Невалідне значення turn: ${rawTurn}`);
  }
  const flags = view.getUint8(7);
  return {
    seq: asSeq(seqNum),
    turn: rawTurn,
    thrust: (flags & 1) !== 0,
    fire: (flags & 2) !== 0
  };
}

export function encodeSnapshot(tick: Tick, ships: readonly SnapshotShipState[]): ArrayBuffer {
  if (ships.length > 255) {
    throw new RangeError(`Перевищено ліміт кораблів у знімку: ${ships.length}`);
  }
  const buf = new ArrayBuffer(7 + ships.length * 16);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.SNAPSHOT);
  view.setUint32(2, tick >>> 0, true);
  view.setUint8(6, ships.length);

  let offset = 7;
  for (const ship of ships) {
    view.setUint16(offset, ship.id, true);
    view.setUint32(offset + 2, ship.lastSeq >>> 0, true);
    view.setFloat32(offset + 6, ship.x, true);
    view.setFloat32(offset + 10, ship.y, true);
    const quantizedAngle = Math.max(-32768, Math.min(32767, Math.round(ship.angle * 1000)));
    view.setInt16(offset + 14, quantizedAngle, true);
    offset += 16;
  }

  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): SnapshotPacket {
  const view = new DataView(buf);
  assertHeader(view, MSG.SNAPSHOT, 7);
  const tick = asTick(view.getUint32(2, true));
  const count = view.getUint8(6);
  const expectedSize = 7 + count * 16;
  if (view.byteLength < expectedSize) {
    throw new RangeError(`Пошкоджений знімок: очікувалось ${expectedSize} Б, отримано ${view.byteLength} Б`);
  }

  const ships: SnapshotShipState[] = [];
  let offset = 7;
  for (let i = 0; i < count; i++) {
    const id = asEntityId(view.getUint16(offset, true));
    const lastSeq = asSeq(view.getUint32(offset + 2, true));
    const x = view.getFloat32(offset + 6, true);
    const y = view.getFloat32(offset + 10, true);
    const angle = view.getInt16(offset + 14, true) / 1000;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Некоректні координати корабля у бінарному знімку');
    }
    ships.push({ id, lastSeq, x, y, angle });
    offset += 16;
  }

  return { tick, ships };
}

export function encodePing(type: typeof MSG.PING | typeof MSG.PONG, timestamp: number): ArrayBuffer {
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, type);
  view.setFloat64(2, timestamp, true);
  return buf;
}

export function decodePing(buf: ArrayBuffer): PingPacket {
  const view = new DataView(buf);
  if (view.byteLength < 10) {
    throw new RangeError(`Короткий PING/PONG пакет: ${view.byteLength} Б`);
  }
  const version = view.getUint8(0);
  const type = view.getUint8(1);
  if (version !== PROTOCOL_VERSION || (type !== MSG.PING && type !== MSG.PONG)) {
    throw new RangeError(`Невалідний заголовок PING/PONG: v=${version}, t=${type}`);
  }
  return {
    type,
    timestamp: view.getFloat64(2, true)
  };
}

// ============================================================================
// 5. ІНТЕРФЕЙС CODEC (BINARY ТА JSON РЕАЛІЗАЦІЇ)
// ============================================================================

export interface SnapshotCodec {
  readonly name: 'binary' | 'json';
  encode(snapshot: SnapshotPacket): ArrayBuffer | string;
  decode(raw: ArrayBuffer | string): SnapshotPacket;
}

export class BinarySnapshotCodec implements SnapshotCodec {
  readonly name = 'binary' as const;

  encode(snapshot: SnapshotPacket): ArrayBuffer {
    return encodeSnapshot(snapshot.tick, snapshot.ships);
  }

  decode(raw: ArrayBuffer | string): SnapshotPacket {
    if (!(raw instanceof ArrayBuffer)) {
      throw new TypeError('BinarySnapshotCodec очікує ArrayBuffer');
    }
    return decodeSnapshot(raw);
  }
}

export class JsonSnapshotCodec implements SnapshotCodec {
  readonly name = 'json' as const;

  encode(snapshot: SnapshotPacket): string {
    return JSON.stringify({
      type: 'SNAPSHOT',
      tick: snapshot.tick,
      ships: snapshot.ships
    });
  }

  decode(raw: ArrayBuffer | string): SnapshotPacket {
    if (typeof raw !== 'string') {
      throw new TypeError('JsonSnapshotCodec очікує рядок JSON');
    }
    const parsed = parseServerMessage(raw);
    if (!parsed.ok || parsed.value.type !== 'SNAPSHOT') {
      throw new Error('Невалідний JSON-знімок');
    }
    return {
      tick: asTick(parsed.value.tick),
      ships: parsed.value.ships.map((s) => ({
        id: asEntityId(s.id),
        lastSeq: asSeq(s.lastSeq),
        x: s.x,
        y: s.y,
        angle: s.angle
      }))
    };
  }
}