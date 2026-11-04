export function drawShip(context, ship, isThrusting) {
    context.save();
  
    context.translate(ship.x, ship.y);
    context.rotate(ship.angle);
  
    context.beginPath();
    context.moveTo(30, 0);
    context.lineTo(-20, -15);
    context.lineTo(-12, 0);
    context.lineTo(-20, 15);
    context.closePath();

    context.strokeStyle = "white";
    context.lineWidth = 2;
    context.stroke();

    if (isThrusting) {
        context.beginPath();
        context.moveTo(-12, -6);
        context.lineTo(-28, 0);
        context.lineTo(-12, 6);
        context.closePath();
      
        context.strokeStyle = "orange";
        context.stroke();
      }
  
    context.restore();
  }
  
  export function drawStars(context, width, height) {
    context.fillStyle = "white";
  
    for (let i = 0; i < 100; i++) {
      const x = (i * 137) % width;
      const y = (i * 83) % height;
  
      context.fillRect(x, y, 1, 1);
    }
  }

  export function drawGrid(context, width, height) {
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = 1;
  
    const gridSize = 50;
  
    context.beginPath();
  
    for (let x = 0; x <= width; x += gridSize) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
  
    for (let y = 0; y <= height; y += gridSize) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
  
    context.stroke();
  }