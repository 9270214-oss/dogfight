import { Entity } from './entity.ts';

export class Explosion extends Entity {
  ttl: number;
  maxTtl: number;

  constructor(x: number, y: number) {
    super(x, y, 1, 'explosion');
    this.ttl = 0.4;
    this.maxTtl = 0.4;
  }

  override update(dt: number): void {
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }

  override draw(ctx: CanvasRenderingContext2D): void {
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