export class ParticleSystem {
    constructor() {
      this.particles = [];
      this.shockwaves = [];
    }
  
    // 1. Вогонь та дим з сопла двигуна
    createThruster(x, y, angle) {
      const spreadAngle = angle + Math.PI + (Math.random() - 0.5) * 0.4;
      const speed = Math.random() * 100 + 50;
      this.particles.push({
        x: x - Math.cos(angle) * 12,
        y: y - Math.sin(angle) * 12,
        vx: Math.cos(spreadAngle) * speed,
        vy: Math.sin(spreadAngle) * speed,
        life: 0.25,
        maxLife: 0.25,
        color: Math.random() > 0.4 ? '#ff6600' : (Math.random() > 0.5 ? '#ffcc00' : '#ff0033'),
        size: Math.random() * 4 + 2
      });
    }
  
    // 2. Соковитий вибух з іскрами та кольоровою ударною хвилею
    createExplosion(x, y, color = '#ff9900', count = 30) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 220 + 40;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: Math.random() * 0.4 + 0.3,
          maxLife: 0.7,
          color: color,
          size: Math.random() * 4 + 2
        });
      }
  
      // Додаємо ударну хвилю (Shockwave ring)
      this.shockwaves.push({
        x,
        y,
        radius: 4,
        maxRadius: 50,
        life: 1.0,
        color: color
      });
    }
  
    // 3. Радіальний спалах при підборі аптечки
    createPickupBurst(x, y) {
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const speed = 120;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.35,
          maxLife: 0.35,
          color: '#00ffcc',
          size: 3
        });
      }
    }
  
    update(dt) {
      // Оновлення частинок
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
  
      // Оновлення ударних хвиль
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const sw = this.shockwaves[i];
        sw.radius += (sw.maxRadius - sw.radius) * 10 * dt;
        sw.life -= 3.0 * dt;
        if (sw.life <= 0) this.shockwaves.splice(i, 1);
      }
    }
  
    draw(ctx) {
      ctx.save();
      // Кільця ударних хвиль
      this.shockwaves.forEach((sw) => {
        ctx.globalAlpha = Math.max(0, sw.life);
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      });
  
      // Частинки
      this.particles.forEach((p) => {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  }