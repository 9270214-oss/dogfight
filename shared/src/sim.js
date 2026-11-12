export const PHYSICS = {
    SHIP_SPEED: 220, // пікселів/сек
    TURN_SPEED: 3.5, // радіан/сек
    FRICTION: 0.98
  };
  
  export function applyInput(ship, input, dt) {
    if (input.turn !== 0) {
      ship.angle += input.turn * PHYSICS.TURN_SPEED * dt;
    }
  
    if (input.thrust) {
      ship.x += Math.cos(ship.angle) * PHYSICS.SHIP_SPEED * dt;
      ship.y += Math.sin(ship.angle) * PHYSICS.SHIP_SPEED * dt;
    }
  }
  
  export function stepWorld(entities, dt) {
    for (const entity of entities) {
      if (entity.vx !== undefined && entity.vy !== undefined) {
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
      }
    }
  }