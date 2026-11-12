declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type EntityId = Brand<number, 'EntityId'>;
export type Tick = Brand<number, 'Tick'>;
export type Seq = Brand<number, 'Seq'>;
export type RoomId = Brand<string, 'RoomId'>;

export function asEntityId(id: number): EntityId {
  // Валідований числовий ідентифікатор корабля в мережі
  return id as EntityId;
}

export function asTick(tick: number): Tick {
  // Валідований номер серверного тіку симуляції
  return tick as Tick;
}

export function asSeq(seq: number): Seq {
  // Валідований порядковий номер вхідної команди гравця
  return seq as Seq;
}

export function asRoomId(id: string): RoomId {
  // Валідований рядковий ідентифікатор ігрової кімнати
  return id as RoomId;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface ShipSnapshot {
  readonly kind: 'ship';
  readonly id: EntityId;
  readonly lastSeq: Seq;
  readonly pos: Vec2;
  readonly angle: number;
  readonly hp: number;
}

export interface AsteroidSnapshot {
  readonly kind: 'asteroid';
  readonly id: string;
  readonly pos: Vec2;
  readonly vel: Vec2;
}

export interface BulletSnapshot {
  readonly kind: 'bullet';
  readonly id: string;
  readonly ownerId: EntityId;
  readonly pos: Vec2;
  readonly vel: Vec2;
}

export interface PickupSnapshot {
  readonly kind: 'pickup';
  readonly id: string;
  readonly pickupType: 'heal';
  readonly pos: Vec2;
}

export type EntitySnapshot =
  | ShipSnapshot
  | AsteroidSnapshot
  | BulletSnapshot
  | PickupSnapshot;

export interface PlayerInput {
  readonly turn: -1 | 0 | 1;
  readonly thrust: boolean;
  readonly fire: boolean;
}