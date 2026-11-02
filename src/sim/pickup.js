import { Entity } from './entity.js';

export class Pickup extends Entity {
  constructor(x, y, type = 'heal') {
    super(x, y, 14, 'pickup');
    this.type = type;
    this.pulse = 0;
  }

  update(dt, world) {
    this.pulse += dt * 3;
    super.update(dt, world);
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    const glow = Math.sin(this.pulse) * 3;

    // Зовнішнє сяйво
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + glow, 0, Math.PI * 2);
    ctx.stroke();

    // Заповнений зелений кружок
    ctx.fillStyle = 'rgba(0, 255, 102, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Білий медичний хрестик всередині
    ctx.fillStyle = '#ffffff';
    // Вертикальна смужка
    ctx.fillRect(-2, -7, 4, 14);
    // Горизонтальна смужка
    ctx.fillRect(-7, -2, 14, 4);

    ctx.restore();
  }
}