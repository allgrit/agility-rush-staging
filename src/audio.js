// Весь звук синтезируется через WebAudio — без ассетов.
// В headless-харнессе AudioContext может отсутствовать/висеть в suspended — все вызовы защищены.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.crowdGain = null;
    this.enabled = true;
    this.musicTimer = null;
  }

  init() {
    if (this.ctx || !this.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this._startCrowd();
    } catch (e) { this.enabled = false; }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  _now() { return this.ctx ? this.ctx.currentTime : 0; }

  // Базовый тон с огибающей
  tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.3, slide = 0, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this._now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  // Шумовой всплеск (шаги, пыль, удары)
  noise({ dur = 0.1, vol = 0.2, freq = 1000, q = 1, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this._now() + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  _startCrowd() {
    // Фоновый гул трибун: зацикленный фильтрованный шум с медленной модуляцией
    if (!this.ctx) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { v = v * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = v * 3; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(f); f.connect(this.crowdGain); this.crowdGain.connect(this.master);
    src.start();
  }

  crowdExcite(level = 0.18) {
    if (!this.crowdGain) return;
    const t = this._now();
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setValueAtTime(level, t);
    this.crowdGain.gain.exponentialRampToValueAtTime(this.crowdBase || 0.05, t + 2.5);
  }

  // База гула толпы зависит от зоны: у трибун громче, в парке тишина
  setCrowdBase(v) {
    if (!this.crowdGain) return;
    if (Math.abs((this.crowdBase || 0.05) - v) < 0.005) return;
    this.crowdBase = v;
    const t = this._now();
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.linearRampToValueAtTime(v, t + 1.5);
  }

  // Лёгкий чиптюн-луп: бас + пентатонический лид + хэт
  startMusic() {
    if (!this.ctx || this.musicOn || !this.enabled) return;
    this.musicOn = true;
    this.musicStep = 0;
    const bass = [0, -1, 7, -1, 5, -1, 7, -1, 3, -1, 10, 3, 5, -1, 12, 7];
    const lead = [12, -1, 16, 19, -1, 16, 12, -1, 15, -1, 19, 22, -1, 19, 24, -1];
    const base = 110; // A2
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const st = this.musicStep % 16;
      const b = bass[st];
      if (b >= 0) this.tone({ freq: base * Math.pow(2, b / 12), type: 'triangle', dur: 0.18, vol: 0.05 });
      const l = lead[st];
      if (l >= 0 && this.musicStep % 32 >= 16) {
        this.tone({ freq: base * 2 * Math.pow(2, l / 12), type: 'square', dur: 0.11, vol: 0.022 });
      }
      if (st % 4 === 0) this.noise({ dur: 0.04, vol: 0.03, freq: 5200, q: 1.2 });
      this.musicStep++;
    }, Math.round(60000 / 132 / 2));
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicOn = false;
  }

  // --- Игровые события ---
  footstep(speed) { this.noise({ dur: 0.05, vol: 0.03 + speed * 0.001, freq: 300, q: 0.8 }); }
  jump() { this.tone({ freq: 380, type: 'sine', dur: 0.18, vol: 0.2, slide: 300 }); this.noise({ dur: 0.08, vol: 0.08, freq: 800 }); }
  land() { this.noise({ dur: 0.09, vol: 0.15, freq: 250, q: 0.7 }); }
  slide() { this.noise({ dur: 0.25, vol: 0.12, freq: 600, q: 0.5 }); }
  laneSwitch() { this.noise({ dur: 0.06, vol: 0.06, freq: 1200 }); }
  barKnock() { this.tone({ freq: 220, type: 'square', dur: 0.3, vol: 0.25, slide: -80 }); this.noise({ dur: 0.2, vol: 0.2, freq: 400 }); }
  clean() { this.tone({ freq: 660, type: 'sine', dur: 0.12, vol: 0.22 }); this.tone({ freq: 880, type: 'sine', dur: 0.15, vol: 0.22, delay: 0.07 }); }
  perfect() {
    this.tone({ freq: 660, dur: 0.1, vol: 0.25 });
    this.tone({ freq: 880, dur: 0.1, vol: 0.25, delay: 0.07 });
    this.tone({ freq: 1320, dur: 0.22, vol: 0.25, delay: 0.14 });
    this.crowdExcite(0.14);
  }
  weaveDing(i) { this.tone({ freq: 700 + i * 90, type: 'triangle', dur: 0.09, vol: 0.22 }); }
  cookie(streak = 0, gold = false) {
    // Полутоновая лесенка: цепочка подборов складывается в мелодию
    const f = 660 * Math.pow(2, Math.min(streak, 8) / 12) * (0.98 + Math.random() * 0.04);
    this.tone({ freq: f, type: 'sine', dur: 0.07, vol: 0.14 });
    if (gold) this.tone({ freq: f * 2, type: 'triangle', dur: 0.1, vol: 0.12, delay: 0.03 });
  }
  powerup() { this.tone({ freq: 500, dur: 0.1, vol: 0.25, slide: 400 }); this.tone({ freq: 1000, dur: 0.2, vol: 0.2, delay: 0.1, slide: 300 }); }
  stumble() { this.noise({ dur: 0.3, vol: 0.3, freq: 200, q: 0.5 }); this.tone({ freq: 160, type: 'sawtooth', dur: 0.25, vol: 0.2, slide: -60 }); }
  whistle() { this.tone({ freq: 2200, type: 'sine', dur: 0.4, vol: 0.2, slide: 150 }); }
  bark() { this.tone({ freq: 320, type: 'sawtooth', dur: 0.09, vol: 0.25, slide: -120 }); this.noise({ dur: 0.07, vol: 0.15, freq: 900 }); }
  crash() {
    this.noise({ dur: 0.5, vol: 0.4, freq: 250, q: 0.4 });
    this.tone({ freq: 120, type: 'sawtooth', dur: 0.5, vol: 0.3, slide: -60 });
    this.whistle();
  }
  applause() { this.crowdExcite(0.25); for (let i = 0; i < 10; i++) this.noise({ dur: 0.04, vol: 0.06, freq: 2000 + Math.random() * 1500, delay: Math.random() * 0.7 }); }
  comboMilestone(n) {
    const base = 520 + Math.min(n, 30) * 12;
    [0, 4, 7, 12].forEach((st, i) => this.tone({ freq: base * Math.pow(2, st / 12), dur: 0.14, vol: 0.2, delay: i * 0.06 }));
    this.crowdExcite(0.2);
  }
  seesawBang() { this.noise({ dur: 0.25, vol: 0.35, freq: 180, q: 0.6 }); }
  tableChant() { this.crowdExcite(0.22); [660, 660, 880].forEach((f, i) => this.tone({ freq: f, dur: 0.12, vol: 0.2, delay: i * 0.22 })); }
  boost() { this.tone({ freq: 300, dur: 0.35, vol: 0.22, slide: 500, type: 'sawtooth' }); }
}
