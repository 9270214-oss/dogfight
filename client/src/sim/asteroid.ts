import { Entity } from './entity.ts';
import { Vector2 } from './vector.ts';
import type { World } from './world.ts';
import type { HomingBehavior } from './composition.ts';

export interface HomingComponent {
  update(entity: Asteroid, dt: number, world?: World): void;
}

export class Asteroid extends Entity {
  homingComponent: HomingBehavior | HomingComponent | null;
  numPoints: number;
  offsets: number[];
  _explodedVFX?: boolean;

  constructor(x: number, y: number, radius = Math.floor(Math.random() * 15) + 22) {
    super(x, y, radius, 'asteroid');
    this.vel = new Vector2((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90);
    this.homingComponent = null;
    this.numPoints = 9 + Math.floor(Math.random() * 4);
    this.offsets = [];
    for (let i = 0; i < this.numPoints; i++) {
      this.offsets.push(0.75 + Math.random() * 0.4);
    }
  }

  get vx(): number {
    return this.vel.x;
  }
  set vx(value: number) {
    this.vel.x = value;
  }

  get vy(): number {
    return this.vel.y;
  }
  set vy(value: number) {
    this.vel.y = value;
  }

  override update(dt: number, world?: World): void {
    if (this.homingComponent) {
      this.homingComponent.update(this, dt, world);
    }
    super.update(dt, world);
    if (world) {
      if (this.pos.x < 0) this.pos.x = world.width;
      if (this.pos.x > world.width) this.pos.x = 0;
      if (this.pos.y < 0) this.pos.y = world.height;
      if (this.pos.y > world.height) this.pos.y = 0;
    }
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.strokeStyle = this.homingComponent ? '#ff5500' : '#d0d0d0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.numPoints; i++) {
      const angle = (i / this.numPoints) * Math.PI * 2;
      const r = this.radius * (this.offsets[i] ?? 1);
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}