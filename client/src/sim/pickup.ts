import { Entity } from './entity.ts';
import type { World } from './world.ts';

export class Pickup extends Entity {
  type: string;
  pulse: number;

  constructor(x: number, y: number, type = 'heal') {
    super(x, y, 14, 'pickup');
    this.type = type;
    this.pulse = 0;
  }

  override update(dt: number, world?: World): void {
    this.pulse += dt * 3;
    super.update(dt, world);
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    const glow = Math.sin(this.pulse) * 3;

    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + glow, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 255, 102, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-2, -7, 4, 14);
    ctx.fillRect(-7, -2, 14, 4);

    ctx.restore();
  }
}