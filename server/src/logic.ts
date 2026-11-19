import { z } from 'zod';
import { applyInput, type InputPacket, type Seq } from 'shared';

export const ServerConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  TICK_RATE: z.coerce.number().int().min(10).max(120).default(30),
  WORLD_SEED: z.coerce.number().int().nonnegative().default(1337),
  WIN_SCORE: z.coerce.number().int().positive().default(100)
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  return ServerConfigSchema.parse(env);
}

export interface NetemConfig {
  delay: number;
  jitter: number;
  loss: number;
}

export interface TokenBucketState {
  tokens: number;
  lastTokenAt: number;
}

export interface ReconcilableState {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export function isNewerSeq(seq: number, lastSeq: number): boolean {
  const diff = ((seq & 0xff) - (lastSeq & 0xff) + 256) % 256;
  return diff > 0 && diff < 128;
}

export function wrapCoords(obj: { x: number; y: number }, width = 1200, height = 800): void {
  if (obj.x < 0) obj.x += width;
  if (obj.x > width) obj.x -= width;
  if (obj.y < 0) obj.y += height;
  if (obj.y > height) obj.y -= height;
}

export function clampNetem(cfg: Partial<Record<keyof NetemConfig, unknown>> = {}): NetemConfig {
  return {
    delay: Math.max(0, Math.min(2000, Number(cfg.delay) || 0)),
    jitter: Math.max(0, Math.min(1000, Number(cfg.jitter) || 0)),
    loss: Math.max(0, Math.min(0.9, Number(cfg.loss) || 0))
  };
}

export function allowInputToken(player: TokenBucketState, now = performance.now()): boolean {
  const elapsedSec = Math.max(0, (now - player.lastTokenAt) / 1000);
  player.lastTokenAt = now;
  player.tokens = Math.min(60, player.tokens + elapsedSec * 45);
  if (player.tokens < 1) return false;
  player.tokens -= 1;
  return true;
}

export function reconcilePlayerState(
  authoritative: ReconcilableState,
  lastAckSeq: Seq,
  pendingInputs: readonly InputPacket[],
  dt: number
): { x: number; y: number; angle: number; remainingInputs: InputPacket[] } {
  const remainingInputs = pendingInputs.filter((inp) => isNewerSeq(inp.seq, lastAckSeq));
  const state = {
    x: authoritative.x,
    y: authoritative.y,
    angle: authoritative.angle
  };

  for (const inp of remainingInputs) {
    applyInput(state, inp, dt);
  }

  return {
    x: state.x,
    y: state.y,
    angle: state.angle,
    remainingInputs
  };
}

export function isHeartbeatTimedOut(lastSeenMs: number, nowMs: number, timeoutMs = 5000): boolean {
  return nowMs - lastSeenMs > timeoutMs;
}