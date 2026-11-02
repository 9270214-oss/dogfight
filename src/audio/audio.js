import { eventBus } from '../events.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = {};
  }

  init(audioBuffers) {
    this.buffers = audioBuffers || {};

    const unlock = () => {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    };

    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);

    // Роздільні події для різних дій у грі
    eventBus.addEventListener('fired', () => this.playSound('shoot'));
    eventBus.addEventListener('asteroidExploded', () => this.playSound('asteroidExploded'));
    eventBus.addEventListener('shipExploded', () => this.playSound('shipExploded'));
    eventBus.addEventListener('heal', () => this.playSound('heal'));
  }

  playSound(name) {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (this.buffers[name]) {
      try {
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        source.connect(this.ctx.destination);
        source.start(0);
        return;
      } catch (e) {
        console.warn(e);
      }
    }

    this.synthesizeSound(name);
  }

  // М'які процедурні звуки без різкого шуму
  synthesizeSound(type) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (type === 'shoot') {
      // 1. ПОСТРІЛ: Дуже тихий і м'який світловий імпульс (чиста синусоїда)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.07);

      gain.gain.setValueAtTime(0.05, now); // Знижена гучність
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);

    } else if (type === 'asteroidExploded') {
      // 2. РУЙНУВАННЯ АСТЕРОЇДА: Приємний короткий глухий "поп"-глушник
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
      // 3. ЗНИЩЕННЯ КОРАБЛЯ: Глибокий та низький басовий гул
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
      // 4. ПІДБІР АПТЕЧКИ: Легкий висхідний дзвіночок
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