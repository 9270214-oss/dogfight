import { afterEach, describe, expect, it, vi } from 'vitest';
import { asSeq, PHYSICS, type InputPacket } from 'shared';
import {
  allowInputToken,
  clampNetem,
  isHeartbeatTimedOut,
  isNewerSeq,
  parseServerConfig,
  reconcilePlayerState,
  wrapCoords
} from './logic.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('ServerConfigSchema (валідація конфігурації сервера)', () => {
  it('підставляє значення за замовчуванням при порожньому env', () => {
    const cfg = parseServerConfig({});
    expect(cfg).toEqual({
      PORT: 3000,
      HOST: '0.0.0.0',
      TICK_RATE: 30,
      WORLD_SEED: 1337,
      WIN_SCORE: 100
    });
  });

  it('приводить рядкові змінні середовища до чисел', () => {
    const cfg = parseServerConfig({ PORT: '8080', TICK_RATE: '60', WIN_SCORE: '250' });
    expect(cfg.PORT).toBe(8080);
    expect(cfg.TICK_RATE).toBe(60);
    expect(cfg.WIN_SCORE).toBe(250);
  });

  it('відхиляє некоректний порт або занадто високу частоту тіків', () => {
    expect(() => parseServerConfig({ PORT: '99999' })).toThrow();
    expect(() => parseServerConfig({ TICK_RATE: '500' })).toThrow();
  });

  it('відхиляє від’ємний WORLD_SEED', () => {
    expect(() => parseServerConfig({ WORLD_SEED: '-1' })).toThrow();
  });
});

describe('isNewerSeq (кільцева нумерація пакетів 0..255)', () => {
  it('визначає наступний номер пакета у звичайному діапазоні', () => {
    expect(isNewerSeq(11, 10)).toBe(true);
    expect(isNewerSeq(50, 10)).toBe(true);
  });

  it('відхиляє дублікати та старі пакети', () => {
    expect(isNewerSeq(10, 10)).toBe(false);
    expect(isNewerSeq(9, 10)).toBe(false);
  });

  it('коректно обробляє перехід через 255 -> 0', () => {
    expect(isNewerSeq(0, 255)).toBe(true);
    expect(isNewerSeq(5, 254)).toBe(true);
    expect(isNewerSeq(254, 2)).toBe(false);
  });

  it('відхиляє стрибок >= 128 як застарілий або розсинхронізований', () => {
    expect(isNewerSeq(138, 10)).toBe(false);
  });
});

describe('allowInputToken (Token Bucket rate limiter)', () => {
  it('дозволяє серію пакетів у межах початкового запасу токенів', () => {
    const bucket = { tokens: 3, lastTokenAt: 1000 };
    expect(allowInputToken(bucket, 1000)).toBe(true);
    expect(allowInputToken(bucket, 1000)).toBe(true);
    expect(allowInputToken(bucket, 1000)).toBe(true);
    expect(allowInputToken(bucket, 1000)).toBe(false);
  });

  it('відновлює токени з часом (45 токенів/сек)', () => {
    const bucket = { tokens: 0, lastTokenAt: 1000 };
    expect(allowInputToken(bucket, 1010)).toBe(false); // минуло 0.01с -> 0.45 токена
    expect(allowInputToken(bucket, 1050)).toBe(true); // минуло ще 0.04с -> сумарно 2.25 токена
  });

  it('обмежує максимальний запас у 60 токенів при тривалому простої', () => {
    const bucket = { tokens: 10, lastTokenAt: 1000 };
    expect(allowInputToken(bucket, 10_000)).toBe(true);
    expect(bucket.tokens).toBe(59);
  });

  it('не зменшує токени при зворотному зсуві годинника', () => {
    const bucket = { tokens: 2, lastTokenAt: 2000 };
    expect(allowInputToken(bucket, 1500)).toBe(true);
    expect(bucket.tokens).toBe(1);
  });
});

describe('reconcilePlayerState (чиста функція звірки стану з сервером)', () => {
  it('повертає точну позицію сервера, якщо всі команди підтверджені', () => {
    const pending: InputPacket[] = [
      { seq: asSeq(1), turn: 0, thrust: true, fire: false },
      { seq: asSeq(2), turn: 0, thrust: true, fire: false }
    ];
    const res = reconcilePlayerState({ x: 300, y: 400, angle: 0 }, asSeq(2), pending, 0.1);
    expect(res.x).toBe(300);
    expect(res.y).toBe(400);
    expect(res.remainingInputs).toHaveLength(0);
  });

  it('відкидає підтверджені команди та повторно симулює непідтверджені', () => {
    const pending: InputPacket[] = [
      { seq: asSeq(1), turn: 0, thrust: true, fire: false },
      { seq: asSeq(2), turn: 0, thrust: true, fire: false },
      { seq: asSeq(3), turn: 0, thrust: true, fire: false }
    ];
    const dt = 0.25;
    const res = reconcilePlayerState({ x: 100, y: 200, angle: 0 }, asSeq(1), pending, dt);

    // Команди 2 і 3 мають повторно застосуватися поверх позиції сервера (100, 200)
    expect(res.remainingInputs.map((i) => i.seq)).toEqual([asSeq(2), asSeq(3)]);
    expect(res.x).toBeCloseTo(100 + PHYSICS.THRUST_SPEED * dt * 2, 6);
    expect(res.y).toBeCloseTo(200, 6);
  });

  it('коректно звіряє команди під час переповнення seq 255 -> 1', () => {
    const pending: InputPacket[] = [
      { seq: asSeq(255), turn: 0, thrust: true, fire: false },
      { seq: asSeq(0), turn: 0, thrust: true, fire: false },
      { seq: asSeq(1), turn: 1, thrust: false, fire: false }
    ];
    const res = reconcilePlayerState({ x: 50, y: 50, angle: 0 }, asSeq(255), pending, 0.5);
    expect(res.remainingInputs.map((i) => i.seq)).toEqual([asSeq(0), asSeq(1)]);
    expect(res.x).toBeCloseTo(50 + PHYSICS.THRUST_SPEED * 0.5, 6);
    expect(res.angle).toBeCloseTo(PHYSICS.TURN_SPEED * 0.5, 6);
  });

  it('не мутує вхідний об’єкт стану сервера та масив черги', () => {
    const serverPos = { x: 10, y: 20, angle: 0 };
    const pending: InputPacket[] = [{ seq: asSeq(5), turn: 0, thrust: true, fire: false }];
    reconcilePlayerState(serverPos, asSeq(4), pending, 0.5);
    expect(serverPos).toEqual({ x: 10, y: 20, angle: 0 });
    expect(pending).toHaveLength(1);
  });
});

describe('clampNetem та wrapCoords', () => {
  it('обмежує параметри затримки, джитеру та втрат пакетів безпечними межами', () => {
    expect(clampNetem({ delay: -50, jitter: 5000, loss: 1.5 })).toEqual({
      delay: 0,
      jitter: 1000,
      loss: 0.9
    });
  });

  it('підставляє нулі для нечислових або відсутніх значень Netem', () => {
    expect(clampNetem({ delay: 'invalid', loss: undefined })).toEqual({
      delay: 0,
      jitter: 0,
      loss: 0
    });
  });

  it('wrapCoords зациклює координати в межах 1200×800', () => {
    const p = { x: -5, y: 810 };
    wrapCoords(p);
    expect(p).toEqual({ x: 1195, y: 10 });
  });

  it('wrapCoords переносить координати, більші за ширину арени', () => {
    const p = { x: 1205, y: -10 };
    wrapCoords(p);
    expect(p).toEqual({ x: 5, y: 790 });
  });
});

describe('Heartbeat та періодичний моніторинг з’єднання (vi.useFakeTimers)', () => {
  it('визначає таймаут клієнта лише після перевищення порогу очікування', () => {
    expect(isHeartbeatTimedOut(1000, 4000, 5000)).toBe(false);
    expect(isHeartbeatTimedOut(1000, 6001, 5000)).toBe(true);
  });

  it('періодичний таймер heartbeat перевіряє активність клієнтів за розкладом', () => {
    vi.useFakeTimers();
    let lastPong = Date.now();
    let disconnects = 0;

    const timer = setInterval(() => {
      if (isHeartbeatTimedOut(lastPong, Date.now(), 3000)) {
        disconnects++;
      }
    }, 1000);

    // Через 2 секунди клієнт надсилає PONG — розриву немає
    vi.advanceTimersByTime(2000);
    lastPong = Date.now();
    vi.advanceTimersByTime(2000);
    expect(disconnects).toBe(0);

    // Клієнт перестав відповідати на 4 секунди — спрацьовує таймаут
    vi.advanceTimersByTime(4000);
    expect(disconnects).toBeGreaterThanOrEqual(1);
    clearInterval(timer);
  });
});