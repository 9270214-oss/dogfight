import { Vector2 } from './vector.js';

export class Entity {
  static #nextId = 1;
  #id;

  constructor(x = 0, y = 0, radius = 10, kind = 'entity') {
    this.#id = Entity.#nextId++;
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(0, 0);
    this.angle = 0;
    this.radius = radius;
    this.alive = true;
    this.kind = kind;
  }

  get id() {
    return this.#id;
  }

  update(dt, world) {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  draw(ctx) {
    // Перевизначається в підкласах
  }
}