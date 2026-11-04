import { Entity } from './entity.js';
import { Vector2 } from './vector.js';

export class Asteroid extends Entity {
  constructor(x, y, radius = Math.floor(Math.random() * 15) + 22) { // Збільшено розмір
    super(x, y, radius, 'asteroid');
    this.vel = new Vector2((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90);
    this.homingComponent = null;

    this.numPoints = 9 + Math.floor(Math.random() * 4);
    this.offsets = [];
    for (let i = 0; i < this.numPoints; i++) {
      this.offsets.push(0.75 + Math.random() * 0.4);
    }
  }

  update(dt, world) {
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

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.strokeStyle = this.homingComponent ? '#ff5500' : '#d0d0d0';
    ctx.lineWidth = 2;

    ctx.beginPath();
    for (let i = 0; i < this.numPoints; i++) {
      const angle = (i / this.numPoints) * Math.PI * 2;
      const r = this.radius * this.offsets[i];
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