import { Vector2 } from './vector.ts';
import type { World } from './world.ts';

export class Entity {
  static #nextId = 1;
  #id: number;

  pos: Vector2;
  vel: Vector2;
  angle: number;
  radius: number;
  alive: boolean;
  kind: string;
  netId?: string;

  constructor(x = 0, y = 0, radius = 10, kind = 'entity') {
    this.#id = Entity.#nextId++;
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(0, 0);
    this.angle = 0;
    this.radius = radius;
    this.alive = true;
    this.kind = kind;
  }

  get id(): number {
    return this.#id;
  }

  update(dt: number, _world?: World, _inputs?: unknown): void {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  draw(_ctx: CanvasRenderingContext2D): void {
    // Перевизначається в підкласах
  }
}