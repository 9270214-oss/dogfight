import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector2 } from './sim/vector.ts';
import { wrapAround } from './sim/arena.ts';
import { checkCircleCollision, handleCollisions } from './sim/collision.ts';
import { World } from './sim/world.ts';
import { Ship } from './sim/ship.ts';
import { Bullet } from './sim/bullet.ts';
import { Asteroid } from './sim/asteroid.ts';
import { Pickup } from './sim/pickup.ts';
import { Explosion } from './sim/explosion.ts';
import { HomingBehavior } from './sim/composition.ts';
import { createLoop } from './loop.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Vector2 (математика векторів)', () => {
  it('add, sub, scale та addInPlace коректно обчислюють координати', () => {
    const a = new Vector2(3, 4);
    const b = new Vector2(1, -2);

    expect(a.add(b)).toEqual(new Vector2(4, 2));
    expect(a.sub(b)).toEqual(new Vector2(2, 6));
    expect(a.scale(2)).toEqual(new Vector2(6, 8));

    const mut = new Vector2(10, 20);
    mut.addInPlace(new Vector2(-3, 5));
    expect(mut).toEqual(new Vector2(7, 25));
  });

  it('length та normalize коректно працюють, включно з нульовим вектором', () => {
    const v = new Vector2(3, 4);
    expect(v.length()).toBe(5);

    const norm = v.normalize();
    expect(norm.x).toBeCloseTo(0.6, 6);
    expect(norm.y).toBeCloseTo(0.8, 6);

    const zero = new Vector2(0, 0).normalize();
    expect(zero).toEqual(new Vector2(0, 0));
  });

  it('rotate, dot та Vector2.fromAngle повертають точні геометричні значення', () => {
    const right = new Vector2(1, 0);
    const up = right.rotate(Math.PI / 2);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(1, 6);

    expect(right.dot(up)).toBeCloseTo(0, 6);
    expect(right.dot(new Vector2(5, 3))).toBe(5);

    const angled = Vector2.fromAngle(Math.PI, 10);
    expect(angled.x).toBeCloseTo(-10, 6);
    expect(angled.y).toBeCloseTo(0, 6);
  });
});

describe('Арена та колізії (arena.ts і collision.ts)', () => {
  it('wrapAround переносить координати при виході за межі арени', () => {
    const obj = { x: -10, y: 805 };
    wrapAround(obj, 1200, 800);
    expect(obj).toEqual({ x: 1190, y: 5 });

    const obj2 = { x: 1200, y: -1 };
    wrapAround(obj2, 1200, 800);
    expect(obj2).toEqual({ x: 0, y: 799 });
  });

  it('checkCircleCollision розрізняє дотик, перекриття та промах', () => {
    const a = new Ship(100, 100); // radius = 26
    const touching = new Pickup(140, 100); // radius = 14 -> dist = 40 === 26 + 14
    const overlapping = new Pickup(120, 100); // dist = 20 < 40
    const missed = new Pickup(141, 100); // dist = 41 > 40

    expect(checkCircleCollision(a, touching)).toBe(true);
    expect(checkCircleCollision(a, overlapping)).toBe(true);
    expect(checkCircleCollision(a, missed)).toBe(false);
  });

  it('швидке тунелювання кулі: за великий крок dt куля може проскочити малу ціль без підкроків', () => {
    const asteroid = new Asteroid(100, 100, 10);
    asteroid.vel = new Vector2(0, 0);
    // Куля летить зі швидкістю 2000 px/s зліва направо повз астероїд
    const bullet = new Bullet(50, 100, new Vector2(2000, 0), 1, 5);

    // За один великий крок dt = 0.05s куля перестрибує з x=50 у x=150 (повз x=100±13)
    bullet.update(0.05);
    expect(bullet.pos.x).toBe(150);
    expect(checkCircleCollision(bullet, asteroid)).toBe(false);
  });

  it('handleCollisions обробляє влучання кулі в астероїд, зіткнення корабля та підбір аптечки', () => {
    const world = new World(1200, 800);
    const ship = world.spawn(new Ship(200, 200));
    const asteroid1 = world.spawn(new Asteroid(500, 500, 25));
    const bullet = world.spawn(new Bullet(505, 500, new Vector2(0, 0), ship.id));

    handleCollisions(world);
    expect(bullet.alive).toBe(false);
    expect(asteroid1.alive).toBe(false);
    expect(world.score).toBe(100);
    expect(Array.from(world.ofKind('explosion')).length).toBe(1);

    // Зіткнення корабля з іншим астероїдом (-50 HP)
    const asteroid2 = world.spawn(new Asteroid(210, 200, 25));
    handleCollisions(world);
    expect(ship.hp).toBe(50);
    expect(asteroid2.alive).toBe(false);

    // Підбір аптечки (+40 HP -> 90 HP)
    const heal = world.spawn(new Pickup(205, 200, 'heal'));
    handleCollisions(world);
    expect(ship.hp).toBe(90);
    expect(heal.alive).toBe(false);
  });
});

describe('Сутності та World.step (ship, bullet, asteroid, homing, world)', () => {
  it('Ship: пошкодження, лікування, респавн та постріл', () => {
    const world = new World(1200, 800);
    const ship = world.spawn(new Ship(300, 300));

    ship.takeDamage(30);
    expect(ship.hp).toBe(70);
    ship.heal(100);
    expect(ship.hp).toBe(100);

    const bullet = ship.fire(world);
    expect(bullet).not.toBeNull();
    expect(Array.from(world.ofKind('bullet')).length).toBe(1);

    ship.takeDamage(150);
    expect(ship.alive).toBe(false);
    expect(ship.fire(world)).toBeNull();

    ship.respawn(600, 400);
    expect(ship.alive).toBe(true);
    expect(ship.hp).toBe(100);
    expect(ship.pos).toEqual(new Vector2(600, 400));
  });

  it('Ship.update інтегрує поворот, прискорення та гальмування в межах світу', () => {
    const world = new World(1200, 800);
    const ship = new Ship(100, 100);
    ship.update(0.1, world, { right: true, thrust: true });

    expect(ship.angle).toBeGreaterThan(0);
    expect(ship.pos.x).toBeGreaterThan(100);
    expect(ship.isThrusting).toBe(true);
  });

  it('Bullet зникає після закінчення ttl або виходу за межі світу', () => {
    const world = new World(800, 600);
    const b1 = new Bullet(100, 100, new Vector2(10, 0), 1, 0.2);
    b1.update(0.25, world);
    expect(b1.alive).toBe(false);

    const b2 = new Bullet(795, 100, new Vector2(200, 0), 1, 5);
    b2.update(0.1, world);
    expect(b2.alive).toBe(false);
  });

  it('HomingBehavior наводить астероїд у бік найближчого живого корабля', () => {
    const world = new World(1200, 800);
    const ship = world.spawn(new Ship(500, 100));
    const asteroid = world.spawn(new Asteroid(100, 100, 25));
    asteroid.vel = new Vector2(0, 100); // спочатку летить вниз
    asteroid.homingComponent = new HomingBehavior('ship', 2.0, 200);

    asteroid.update(0.2, world);
    expect(asteroid.vel.x).toBeGreaterThan(0); // почав повертати праворуч до корабля
    expect(ship.alive).toBe(true);
  });

  it('World.step оновлює всі сутності та видаляє мертві під час sweep', () => {
    const world = new World(1200, 800);
    const exp = world.spawn(new Explosion(50, 50));
    const pickup = world.spawn(new Pickup(100, 100));

    world.step(0.5); // ttl вибуху = 0.4s -> має зникнути
    expect(exp.alive).toBe(false);
    expect(world.get(exp.id)).toBeUndefined();
    expect(world.get(pickup.id)).toBeDefined();
    expect(pickup.pulse).toBeCloseTo(1.5, 6);
  });
});

describe('Ігровий цикл createLoop із фейковими таймерами (vi.useFakeTimers)', () => {
  it('виконує фіксовану кількість кроків симуляції згідно з акумулятором часу', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      return setTimeout(() => cb(performance.now()), 16);
    });

    const simulate = vi.fn();
    const render = vi.fn();

    const stats = createLoop({ step: 1 / 60, simulate, render });

    // За 64 мс (4 тіки по 16 мс): 0.064 / (1/60) = 3.84 -> рівно 3 кроки симуляції та 4 кадри рендеру
    vi.advanceTimersByTime(64);
    expect(simulate).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenCalledTimes(4);

    // Після 1 секунди оновлюється статистика FPS та stepsPerSecond
    vi.advanceTimersByTime(1000);
    expect(stats.stepsPerSecond).toBeGreaterThan(55);
    expect(stats.framesPerSecond).toBeGreaterThan(55);
  });

  it('обмежує великий стрибок frameTime до 0.25 с (захист від spiral of death)', () => {
    vi.useFakeTimers();
    let savedCb: ((time: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      savedCb = cb;
      return 1;
    });

    const simulate = vi.fn();
    const render = vi.fn();
    createLoop({ step: 1 / 60, simulate, render });

    // Імітуємо зависання вкладки на 2000 мс (2 секунди)
    vi.advanceTimersByTime(2000);
    expect(savedCb).not.toBeNull();
    savedCb!(performance.now());

    // Замість 120 кроків виконується максимум 15 кроків (0.25 / (1/60) = 15)
    expect(simulate).toHaveBeenCalledTimes(15);
  });
});