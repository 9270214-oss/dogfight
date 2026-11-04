export class HomingBehavior {
    constructor(targetKind = 'ship', turnRate = 2.0, speed = 250) {
      this.targetKind = targetKind;
      this.turnRate = turnRate;
      this.speed = speed;
    }
  
    update(entity, dt, world) {
      if (!world) return;
  
      let target = null;
      let minDist = Infinity;
  
      for (const other of world.ofKind(this.targetKind)) {
        if (!other.alive) continue;
        const dist = entity.pos.sub(other.pos).length();
        if (dist < minDist) {
          minDist = dist;
          target = other;
        }
      }
  
      if (target) {
        const desiredDir = target.pos.sub(entity.pos).normalize();
        const currentDir = entity.vel.normalize();
        const newDir = currentDir.scale(1 - this.turnRate * dt).add(desiredDir.scale(this.turnRate * dt)).normalize();
        entity.vel = newDir.scale(this.speed);
      }
    }
  }