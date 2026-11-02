export class World {
    #entities = new Map();
    #pendingDespawn = new Set();
    #stars = [];
    score = 0;
  
    constructor(width = 800, height = 600) {
      this.width = width;
      this.height = height;
      this.generateStars();
    }
  
    generateStars() {
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
  
    spawn(entity) {
      this.#entities.set(entity.id, entity);
      return entity;
    }
  
    despawn(id) {
      this.#pendingDespawn.add(id);
    }
  
    get(id) {
      return this.#entities.get(id);
    }
  
    *[Symbol.iterator]() {
      yield* this.#entities.values();
    }
  
    *ofKind(kind) {
      for (const entity of this) {
        if (entity.kind === kind) {
          yield entity;
        }
      }
    }
  
    sweep() {
      for (const id of this.#pendingDespawn) {
        const e = this.#entities.get(id);
        if (e) {
          e.alive = false;
          this.#entities.delete(id);
        }
      }
      this.#pendingDespawn.clear();
    }
  
    step(dt, inputs) {
      for (const entity of this.#entities.values()) {
        if (entity.update) {
          entity.update(dt, this, inputs);
        }
        if (!entity.alive) {
          this.#pendingDespawn.add(entity.id);
        }
      }
      this.sweep();
    }
  
    draw(ctx) {
      ctx.clearRect(0, 0, this.width, this.height);
  
      // Чітке малювання маленьких зірочок
      ctx.save();
      for (const star of this.#stars) {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        ctx.fillRect(Math.floor(star.x), Math.floor(star.y), star.size, star.size);
      }
      ctx.restore();
  
      for (const entity of this) {
        if (entity.alive && entity.draw) {
          entity.draw(ctx);
        }
      }
    }
  }