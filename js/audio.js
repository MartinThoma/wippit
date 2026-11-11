// Wippit! — tiny WebAudio synthesiser. No audio files needed, so it works offline.

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('wippit.muted') === '1'; } catch (e) { /* ignore */ }
  }

  /** Must be called from a user gesture before anything can be heard. */
  unlock() {
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem('wippit.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  tone({ freq = 440, end = null, type = 'sine', dur = 0.15, gain = 0.3, delay = 0, curve = 'exp' }) {
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end !== null) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(end, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.3, gain = 0.3, freq = 800, delay = 0 }) {
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq / 8), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    switch (name) {
      case 'move':
        this.tone({ freq: 520, end: 640, dur: 0.045, gain: 0.08, type: 'square' });
        break;
      case 'drop':
        this.tone({ freq: 420, end: 140, dur: 0.12, gain: 0.12, type: 'triangle' });
        break;
      case 'land':
        this.tone({ freq: 170, end: 70, dur: 0.13, gain: 0.3 });
        this.noise({ dur: 0.08, gain: 0.12, freq: 1200 });
        break;
      case 'tilt':
        this.tone({ freq: 260, end: 180, dur: 0.14, gain: 0.12, type: 'triangle' });
        break;
      case 'boing':
        this.tone({ freq: 160, end: 760, dur: 0.28, gain: 0.22, type: 'triangle' });
        this.tone({ freq: 320, end: 1500, dur: 0.22, gain: 0.08, type: 'sine', delay: 0.02 });
        break;
      case 'pop':
        this.tone({ freq: 620, end: 1300, dur: 0.14, gain: 0.22 });
        this.noise({ dur: 0.1, gain: 0.1, freq: 3000 });
        break;
      case 'chain':
        for (let i = 0; i < 3; i++) this.tone({ freq: 700 + i * 180, end: 1400 + i * 300, dur: 0.14, gain: 0.18, delay: i * 0.06 });
        break;
      case 'boom':
        this.noise({ dur: 0.5, gain: 0.45, freq: 600 });
        this.tone({ freq: 90, end: 28, dur: 0.45, gain: 0.35, type: 'sawtooth' });
        break;
      case 'level':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.22, gain: 0.18, type: 'triangle', delay: i * 0.09 }));
        break;
      case 'over':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, end: f * 0.92, dur: 0.38, gain: 0.2, type: 'sawtooth', delay: i * 0.24 }));
        break;
      case 'start':
        [392, 523, 659].forEach((f, i) => this.tone({ freq: f, dur: 0.16, gain: 0.15, type: 'triangle', delay: i * 0.07 }));
        break;
      default:
        break;
    }
  }
}
