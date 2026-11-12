import type { Entity } from './entity.ts';
import type { ShipInputs } from './ship.ts';

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
}

export class World {
  #entities = new Map<number, Entity>();
  #pendingDespawn = new Set<number>();
  #stars: Star[] = [];

  score = 0;
  width: number;
  height: number;

  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
    this.generateStars();
  }

  generateStars(): void {
    this.#stars = [];
    for (let i = 0; i < 180; i++) {
      this.#stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.8 + 0.2
      });
    }
  }

  spawn<T extends Entity>(entity: T): T {
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(id: number): void {
    this.#pendingDespawn.add(id);
  }

  get(id: number): Entity | undefined {
    return this.#entities.get(id);
  }

  *[Symbol.iterator](): IterableIterator<Entity> {
    yield* this.#entities.values();
  }

  *ofKind<T extends Entity = Entity>(kind: string): IterableIterator<T> {
    for (const entity of this) {
      if (entity.kind === kind) {
        yield entity as T;
      }
    }
  }

  sweep(): void {
    for (const id of this.#pendingDespawn) {
      const e = this.#entities.get(id);
      if (e) {
        e.alive = false;
        this.#entities.delete(id);
      }
    }
    this.#pendingDespawn.clear();
  }

  step(dt: number, inputs?: ShipInputs): void {
    for (const entity of this.#entities.values()) {
      entity.update(dt, this, inputs);
      if (!entity.alive) {
        this.#pendingDespawn.add(entity.id);
      }
    }
    this.sweep();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    for (const star of this.#stars) {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
      ctx.fillRect(Math.floor(star.x), Math.floor(star.y), star.size, star.size);
    }
    ctx.restore();

    for (const entity of this) {
      if (entity.alive) {
        entity.draw(ctx);
      }
    }
  }
}