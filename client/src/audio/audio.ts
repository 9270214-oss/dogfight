import { eventBus } from '../events.ts';

type AudioContextConstructor = typeof AudioContext;

function createAudioContext(): AudioContext {
  const win = window as Window & { webkitAudioContext?: AudioContextConstructor };
  const Ctor = window.AudioContext ?? win.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Web Audio API не підтримується у цьому браузері');
  }
  return new Ctor();
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private buffers: Record<string, AudioBuffer | null> = {};

  init(audioBuffers?: Record<string, AudioBuffer | null>): void {
    this.buffers = audioBuffers ?? {};

    const unlock = (): void => {
      if (!this.ctx) {
        this.ctx = createAudioContext();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    };

    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);

    eventBus.addEventListener('fired', () => this.playSound('shoot'));
    eventBus.addEventListener('asteroidExploded', () => this.playSound('asteroidExploded'));
    eventBus.addEventListener('shipExploded', () => this.playSound('shipExploded'));
    eventBus.addEventListener('heal', () => this.playSound('heal'));
  }

  play(name: string): void {
    this.playSound(name);
  }

  playSound(name: string): void {
    if (!this.ctx) {
      this.ctx = createAudioContext();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const buffer = this.buffers[name];
    if (buffer) {
      try {
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
        return;
      } catch (e: unknown) {
        console.warn(e);
      }
    }

    this.synthesizeSound(name);
  }

  synthesizeSound(type: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (type === 'shoot') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.07);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
    } else if (type === 'asteroidExploded') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);

      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'shipExploded') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(25, now + 0.35);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'heal') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.12);

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  }
}

export const audioManager = new AudioManager();