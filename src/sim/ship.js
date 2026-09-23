export function integrate(ship, input, dt) {
    const rotationSpeed = 3;
    const thrust = 200;
    const drag = 0.99;
    const maxSpeed = 300;
  
    if (input.isDown("ArrowLeft")) {
      ship.angle -= rotationSpeed * dt;
    }
  
    if (input.isDown("ArrowRight")) {
      ship.angle += rotationSpeed * dt;
    }
  
    if (input.isDown("ArrowUp")) {
      ship.vx += Math.cos(ship.angle) * thrust * dt;
      ship.vy += Math.sin(ship.angle) * thrust * dt;
    }
  
    ship.vx *= drag;
    ship.vy *= drag;
  
    const speed = Math.hypot(ship.vx, ship.vy);
  
    if (speed > maxSpeed) {
      ship.vx = (ship.vx / speed) * maxSpeed;
      ship.vy = (ship.vy / speed) * maxSpeed;
    }
  
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
  }