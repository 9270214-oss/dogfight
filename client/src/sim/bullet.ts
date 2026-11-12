import { Entity } from './entity.ts';
import type { Vector2 } from './vector.ts';
import type { World } from './world.ts';
import type { HomingBehavior } from './composition.ts';

export class Bullet extends Entity {
  ownerId: number;
  ttl: number;
  damage: number;
  homingComponent: HomingBehavior | null;

  constructor(x: number, y: number, vel: Vector2, ownerId: number, ttl = 2) {
    super(x, y, 3, 'bullet');
    this.vel = vel;
    this.ownerId = ownerId;
    this.ttl = ttl;
    this.damage = 25;
    this.homingComponent = null;
  }

  override update(dt: number, world?: World): void {
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.alive = false;
      return;
    }
    if (this.homingComponent) {
      this.homingComponent.update(this, dt, world);
    }
    super.update(dt, world);
    if (world) {
      if (this.pos.x < 0 || this.pos.x > world.width || this.pos.y < 0 || this.pos.y > world.height) {
        this.alive = false;
      }
    }
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = this.homingComponent ? '#ff0055' : '#ffff00';
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}