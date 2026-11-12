import type { PlayerInput } from './types.ts';

export const PHYSICS = {
  TURN_SPEED: 3.5,
  THRUST_SPEED: 240
} as const;

export interface SimShip {
  x: number;
  y: number;
  angle: number;
}

export interface MovingBody {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
}

export function applyInput(
  ship: SimShip,
  input: PlayerInput,
  dt: number
): void {
  ship.angle += input.turn * PHYSICS.TURN_SPEED * dt;

  if (input.thrust) {
    ship.x += Math.cos(ship.angle) * PHYSICS.THRUST_SPEED * dt;
    ship.y += Math.sin(ship.angle) * PHYSICS.THRUST_SPEED * dt;
  }
}

export function stepWorld(
  bodies: readonly MovingBody[],
  dt: number
): void {
  for (const body of bodies) {
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }
}