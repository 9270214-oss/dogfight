import { ObjectPool } from '../sim/pool.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  color: string;
}

export class ParticleSystem {
  private readonly particles: Particle[] = [];
  private readonly shockwaves: Shockwave[] = [];

  private readonly particlePool = new ObjectPool<Particle>(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#ffffff', size: 2 }),
    (p) => {
      p.x = 0;
      p.y = 0;
      p.vx = 0;
      p.vy = 0;
      p.life = 0;
      p.maxLife = 1;
      p.color = '#ffffff';
      p.size = 2;
    },
    512
  );

  private readonly shockwavePool = new ObjectPool<Shockwave>(
    () => ({ x: 0, y: 0, radius: 0, maxRadius: 50, life: 0, color: '#ffffff' }),
    (sw) => {
      sw.x = 0;
      sw.y = 0;
      sw.radius = 0;
      sw.maxRadius = 50;
      sw.life = 0;
      sw.color = '#ffffff';
    },
    32
  );

  get activeParticleCount(): number {
    return this.particles.length;
  }

  get pooledParticleAllocations(): number {
    return this.particlePool.createdCount;
  }

  // 1. Вогонь та дим з сопла двигуна
  createThruster(x: number, y: number, angle: number): void {
    const spreadAngle = angle + Math.PI + (Math.random() - 0.5) * 0.4;
    const speed = Math.random() * 100 + 50;
    const p = this.particlePool.acquire();
    p.x = x - Math.cos(angle) * 12;
    p.y = y - Math.sin(angle) * 12;
    p.vx = Math.cos(spreadAngle) * speed;
    p.vy = Math.sin(spreadAngle) * speed;
    p.life = 0.25;
    p.maxLife = 0.25;
    p.color = Math.random() > 0.4 ? '#ff6600' : Math.random() > 0.5 ? '#ffcc00' : '#ff0033';
    p.size = Math.random() * 4 + 2;
    this.particles.push(p);
  }

  // 2. Вибух з іскрами та ударною хвилею
  createExplosion(x: number, y: number, color = '#ff9900', count = 30): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 220 + 40;
      const p = this.particlePool.acquire();
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = Math.random() * 0.4 + 0.3;
      p.maxLife = 0.7;
      p.color = color;
      p.size = Math.random() * 4 + 2;
      this.particles.push(p);
    }

    const sw = this.shockwavePool.acquire();
    sw.x = x;
    sw.y = y;
    sw.radius = 4;
    sw.maxRadius = 50;
    sw.life = 1.0;
    sw.color = color;
    this.shockwaves.push(sw);
  }

  // 3. Радіальний спалах при підборі аптечки
  createPickupBurst(x: number, y: number): void {
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const speed = 120;
      const p = this.particlePool.acquire();
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.35;
      p.maxLife = 0.35;
      p.color = '#00ffcc';
      p.size = 3;
      this.particles.push(p);
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.particles.length) {
      const p = this.particles[i];
      if (!p) {
        i++;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        const last = this.particles.pop();
        if (last && i < this.particles.length) {
          this.particles[i] = last;
        }
        this.particlePool.release(p);
      } else {
        i++;
      }
    }

    let j = 0;
    while (j < this.shockwaves.length) {
      const sw = this.shockwaves[j];
      if (!sw) {
        j++;
        continue;
      }
      sw.radius += (sw.maxRadius - sw.radius) * Math.min(1, 10 * dt);
      sw.life -= 3.0 * dt;
      if (sw.life <= 0) {
        const last = this.shockwaves.pop();
        if (last && j < this.shockwaves.length) {
          this.shockwaves[j] = last;
        }
        this.shockwavePool.release(sw);
      } else {
        j++;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!sw) continue;
      ctx.globalAlpha = Math.max(0, sw.life);
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}