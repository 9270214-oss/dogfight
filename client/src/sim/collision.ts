import { Explosion } from './explosion.ts';
import { emitGameEvent } from '../events.ts';
import type { Entity } from './entity.ts';
import type { World } from './world.ts';
import type { Ship } from './ship.ts';
import type { Pickup } from './pickup.ts';

export function checkCircleCollision(a: Entity, b: Entity): boolean {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const distSq = dx * dx + dy * dy;
  const radSum = a.radius + b.radius;
  return distSq <= radSum * radSum;
}

export function handleCollisions(world: World): void {
  const entities = Array.from(world);
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      if (!a || !b || !a.alive || !b.alive) continue;

      if (checkCircleCollision(a, b)) {
        // 1. Куля влучає в астероїд
        if ((a.kind === 'bullet' && b.kind === 'asteroid') || (a.kind === 'asteroid' && b.kind === 'bullet')) {
          const bullet = a.kind === 'bullet' ? a : b;
          const asteroid = a.kind === 'asteroid' ? a : b;
          bullet.alive = false;
          asteroid.alive = false;
          world.score += 100;
          world.spawn(new Explosion(asteroid.pos.x, asteroid.pos.y));
          emitGameEvent('asteroidExploded');
        }

        // 2. Корабель врізається в астероїд
        if ((a.kind === 'ship' && b.kind === 'asteroid') || (a.kind === 'asteroid' && b.kind === 'ship')) {
          const ship = (a.kind === 'ship' ? a : b) as Ship;
          const asteroid = a.kind === 'asteroid' ? a : b;
          ship.takeDamage(50);
          asteroid.alive = false;
          world.spawn(new Explosion(asteroid.pos.x, asteroid.pos.y));
          emitGameEvent('shipExploded');
        }

        // 3. Корабель підбирає бонус
        if ((a.kind === 'ship' && b.kind === 'pickup') || (a.kind === 'pickup' && b.kind === 'ship')) {
          const ship = (a.kind === 'ship' ? a : b) as Ship;
          const pickup = (a.kind === 'pickup' ? a : b) as Pickup;
          if (pickup.type === 'heal') {
            ship.heal(40);
            emitGameEvent('heal');
          }
          pickup.alive = false;
        }
      }
    }
  }
}