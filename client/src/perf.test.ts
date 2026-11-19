import { describe, expect, it } from 'vitest';
import { ObjectPool } from './sim/pool.ts';
import { ParticleSystem } from './render/particles.ts';
import { World } from './sim/world.ts';
import { Ship } from './sim/ship.ts';
import { Asteroid } from './sim/asteroid.ts';
import { handleCollisions } from './sim/collision.ts';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

describe('Продуктивність та ObjectPool (M3: P99 < 16.7 мс)', () => {
  it('ObjectPool повторно використовує звільнені об’єкти без додаткових алокацій', () => {
    const pool = new ObjectPool<{ value: number }>(
      () => ({ value: 0 }),
      (item) => {
        item.value = 0;
      },
      10
    );

    expect(pool.createdCount).toBe(10);
    expect(pool.availableCount).toBe(10);

    const a = pool.acquire();
    a.value = 42;
    pool.release(a);

    const b = pool.acquire();
    expect(b).toBe(a);
    expect(b.value).toBe(0);
    expect(pool.createdCount).toBe(10);
  });

  it('ParticleSystem створює та повертає частинки в пул без зростання кількості алокацій', () => {
    const ps = new ParticleSystem();
    const initialAllocated = ps.pooledParticleAllocations;

    for (let wave = 0; wave < 10; wave++) {
      ps.createExplosion(300, 300, '#ff9900', 40);
      expect(ps.activeParticleCount).toBe(40);
      ps.update(1.0);
      expect(ps.activeParticleCount).toBe(0);
    }

    expect(ps.pooledParticleAllocations).toBe(initialAllocated);
  });

  it('симуляція 500 кадрів із колізіями та 400+ частинками вкладається у бюджет P99 < 16.7 мс', () => {
    const world = new World(1200, 800);
    const ps = new ParticleSystem();

    const ship = world.spawn(new Ship(600, 400));
    for (let i = 0; i < 40; i++) {
      world.spawn(new Asteroid((i * 31) % 1200, (i * 47) % 800, 24));
    }

    const dt = 1 / 60;

    // Прогрів JIT-компілятора (30 кадрів) перед замірами
    for (let warmup = 0; warmup < 30; warmup++) {
      ps.createThruster(ship.pos.x, ship.pos.y, ship.angle);
      world.step(dt, { right: true, thrust: true });
      handleCollisions(world);
      ps.update(dt);
    }

    const frameTimesMs: number[] = [];

    for (let frame = 0; frame < 500; frame++) {
      const t0 = performance.now();

      if (frame % 5 === 0) {
        ps.createThruster(ship.pos.x, ship.pos.y, ship.angle);
      }
      if (frame % 30 === 0) {
        ps.createExplosion(400, 300, '#ffaa00', 30);
      }

      world.step(dt, { right: true, thrust: true });
      handleCollisions(world);
      ps.update(dt);

      frameTimesMs.push(performance.now() - t0);
    }

    frameTimesMs.sort((a, b) => a - b);
    const p50 = percentile(frameTimesMs, 50);
    const p95 = percentile(frameTimesMs, 95);
    const p99 = percentile(frameTimesMs, 99);

    console.log(
      `[Perf Benchmark] 500 frames -> P50: ${p50.toFixed(3)} ms | P95: ${p95.toFixed(3)} ms | P99: ${p99.toFixed(3)} ms`
    );

    expect(p99).toBeLessThan(16.7);
  });
});