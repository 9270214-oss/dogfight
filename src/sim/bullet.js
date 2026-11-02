import { Entity } from './entity.js';

export class Bullet extends Entity {
  constructor(x, y, vel, ownerId, ttl = 2) {
    super(x, y, 3, 'bullet');
    this.vel = vel;
    this.ownerId = ownerId;
    this.ttl = ttl;
    this.damage = 25;
    this.homingComponent = null;
  }

  update(dt, world) {
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

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = this.homingComponent ? '#ff0055' : '#ffff00';
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}