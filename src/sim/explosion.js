import { Entity } from './entity.js';

export class Explosion extends Entity {
  constructor(x, y) {
    super(x, y, 1, 'explosion');
    this.ttl = 0.4;
    this.maxTtl = 0.4;
  }

  update(dt) {
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }

  draw(ctx) {
    const progress = 1 - this.ttl / this.maxTtl;
    const r = 5 + progress * 25;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 100, 0, ${1 - progress})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}