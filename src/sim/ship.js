import { Entity } from './entity.js';
import { Vector2 } from './vector.js';
import { Bullet } from './bullet.js';
import { emitGameEvent } from '../events.js';

export class Ship extends Entity {
  #hp = 100;
  #maxHp = 100;

  constructor(x = 400, y = 300) {
    super(x, y, 26, 'ship'); // Збільшено радіус до 26
    this.rotationSpeed = Math.PI * 1.5;
    this.thrustPower = 380;
    this.isThrusting = false;
  }

  get hp() { return this.#hp; }
  get maxHp() { return this.#maxHp; }

  takeDamage(amount) {
    if (!this.alive) return;
    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.#hp = 0;
      this.alive = false;
    }
  }

  heal(amount) {
    this.#hp = Math.min(this.#maxHp, this.#hp + amount);
  }

  respawn(x, y) {
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(0, 0);
    this.angle = 0;
    this.#hp = this.#maxHp;
    this.alive = true;
  }

  fire = (world) => {
    if (!this.alive || !world) return null;
    const noseOffset = Vector2.fromAngle(this.angle, this.radius + 8);
    const bulletPos = this.pos.add(noseOffset);
    const bulletVel = this.vel.add(Vector2.fromAngle(this.angle, 500));

    const bullet = new Bullet(bulletPos.x, bulletPos.y, bulletVel, this.id);
    world.spawn(bullet);
    emitGameEvent('fired');
    return bullet;
    
  };

  update(dt, world, inputs) {
    if (!this.alive) return;

    this.isThrusting = !!inputs?.thrust;

    if (inputs?.left) this.angle -= this.rotationSpeed * dt;
    if (inputs?.right) this.angle += this.rotationSpeed * dt;

    if (inputs?.thrust) {
      const dir = Vector2.fromAngle(this.angle, this.thrustPower * dt);
      this.vel = this.vel.add(dir);
    }

    this.vel = this.vel.scale(1 - 0.5 * dt);

    super.update(dt, world);

    if (world) {
      if (this.pos.x < 0) this.pos.x = world.width;
      if (this.pos.x > world.width) this.pos.x = 0;
      if (this.pos.y < 0) this.pos.y = world.height;
      if (this.pos.y > world.height) this.pos.y = 0;
    }
  }

  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    // Яскравий великий вогонь із трьох шарів
    if (this.isThrusting) {
      const flameLength = 28 + Math.random() * 12;

      // 1. Зовнішнє червоне полум'я
      ctx.fillStyle = '#ff2200';
      ctx.beginPath();
      ctx.moveTo(-10, -9);
      ctx.lineTo(-10 - flameLength, (Math.random() - 0.5) * 8);
      ctx.lineTo(-10, 9);
      ctx.closePath();
      ctx.fill();

      // 2. Внутрішнє жовте сяйво
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(-8, -5);
      ctx.lineTo(-8 - flameLength * 0.65, 0);
      ctx.lineTo(-8, 5);
      ctx.closePath();
      ctx.fill();

      // 3. Гаряче біле ядро
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.lineTo(-6 - flameLength * 0.35, 0);
      ctx.lineTo(-6, 2);
      ctx.closePath();
      ctx.fill();
    }

    // Великий корпус з підсвічуванням
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(26, 0);       // Ніс
    ctx.lineTo(-16, -18);    // Ліве крило
    ctx.lineTo(-8, 0);       // Заднє сопло
    ctx.lineTo(-16, 18);     // Праве крило
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }
}