import { Explosion } from './explosion.js';

export function checkCircleCollision(a, b) {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const distSq = dx * dx + dy * dy;
  const radSum = a.radius + b.radius;
  return distSq <= radSum * radSum;
}

export function handleCollisions(world) {
  const entities = Array.from(world);

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];

      if (!a.alive || !b.alive) continue;

      if (checkCircleCollision(a, b)) {
        // 1. Куля vs Астероїд
        if ((a.kind === 'bullet' && b.kind === 'asteroid') || (a.kind === 'asteroid' && b.kind === 'bullet')) {
          const bullet = a.kind === 'bullet' ? a : b;
          const asteroid = a.kind === 'asteroid' ? a : b;

          bullet.alive = false;
          asteroid.alive = false;
          world.score += 100;
          world.spawn(new Explosion(asteroid.pos.x, asteroid.pos.y));
        }

        // 2. Корабель vs Астероїд
        if ((a.kind === 'ship' && b.kind === 'asteroid') || (a.kind === 'asteroid' && b.kind === 'ship')) {
          const ship = a.kind === 'ship' ? a : b;
          const asteroid = a.kind === 'asteroid' ? a : b;

          ship.takeDamage(50);
          asteroid.alive = false;
          world.spawn(new Explosion(asteroid.pos.x, asteroid.pos.y));
        }

        // 3. Корабель vs Бонус (Pickup)
        if ((a.kind === 'ship' && b.kind === 'pickup') || (a.kind === 'pickup' && b.kind === 'ship')) {
          const ship = a.kind === 'ship' ? a : b;
          const pickup = a.kind === 'pickup' ? a : b;

          if (pickup.type === 'heal') {
            ship.heal(40);
          }
          pickup.alive = false;
        }
      }
    }
  }
}