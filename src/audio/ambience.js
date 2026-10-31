// Synthesised evening ambience, all generated in code: wind that swells with
// the same gusts that move the tree, a soft rustle of blossoms, and now and
// then a plucked note from a Japanese in-scale (Karplus–Strong strings in a
// generated reverb).

export class Ambience {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      this.enabled = true;
      this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 1.2);
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.enabled = true;
    const master = (this.master = ctx.createGain());
    master.gain.value = 0;
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.5);
    master.connect(ctx.destination);

    // Reverb from a generated impulse response.
    const reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 4.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(master);
    this.reverb = reverb;

    // Brown noise source shared by wind and rustle.
    const nlen = ctx.sampleRate * 6;
    const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nlen; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      nd[i] = last * 3.5;
    }
    const mkNoise = () => {
      const s = ctx.createBufferSource();
      s.buffer = nb;
      s.loop = true;
      s.start(0, Math.random() * 5);
      return s;
    };

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.2;
    mkNoise().connect(windFilter).connect(windGain).connect(master);
    this.windFilter = windFilter;
    this.windGain = windGain;

    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = 'highpass';
    rustleFilter.frequency.value = 2600;
    const rustleGain = ctx.createGain();
    rustleGain.gain.value = 0.0;
    mkNoise().connect(rustleFilter).connect(rustleGain).connect(master);
    this.rustleGain = rustleGain;

    // The stream: a bright babble over the low rush of the waterfall.
    const wlen = ctx.sampleRate * 4;
    const wb = ctx.createBuffer(2, wlen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = wb.getChannelData(c);
      for (let i = 0; i < wlen; i++) d[i] = Math.random() * 2 - 1;
    }
    const water = ctx.createBufferSource();
    water.buffer = wb;
    water.loop = true;
    water.start(0);
    const babble = ctx.createBiquadFilter();
    babble.type = 'bandpass';
    babble.frequency.value = 1400;
    babble.Q.value = 0.9;
    const babbleGain = ctx.createGain();
    babbleGain.gain.value = 0.02;
    water.connect(babble).connect(babbleGain).connect(master);
    babbleGain.connect(reverb);
    const rush = ctx.createBiquadFilter();
    rush.type = 'lowpass';
    rush.frequency.value = 420;
    const rushGain = ctx.createGain();
    rushGain.gain.value = 0.05;
    mkNoise().connect(rush).connect(rushGain).connect(master);
    this.babble = babble;
    this.babbleGain = babbleGain;

    // Pre-render a few plucked strings.
    const scale = [293.66, 311.13, 392.0, 440.0, 466.16, 587.33, 622.25, 783.99];
    this.notes = scale.map((f) => this.pluck(f));
    this.nextNote = ctx.currentTime + 4;
  }

  // The shishi-odoshi's hollow bamboo knock against its stone, then the
  // small splash of the emptied tube.
  knock() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 820;
    body.Q.value = 9;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(body).connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    src.start(t);
    // Hollow resonance of the culm.
    const osc = ctx.createOscillator();
    osc.frequency.value = 410;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.12, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(og);
    og.connect(this.master);
    og.connect(this.reverb);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  stop() {
    if (!this.ctx) return;
    this.enabled = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
  }

  pluck(freq) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * 4);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const period = Math.round(sr / freq);
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[idx];
      const b = ring[(idx + 1) % period];
      const v = 0.5 * (a + b) * 0.9965;
      ring[idx] = v;
      d[i] = a * Math.min(1, i / 40) * (1 - i / n);
      idx = (idx + 1) % period;
    }
    return buf;
  }

  update(gust) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.12 + gust * 0.32, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(320 + gust * 420, t, 1.2);
    this.rustleGain.gain.setTargetAtTime(0.004 + gust * gust * 0.05, t, 0.6);
    // Gurgles: the babble's level and pitch jump about many times a second.
    this.babbleGain.gain.setTargetAtTime(0.012 + Math.random() * 0.028, t, 0.04);
    this.babble.frequency.setTargetAtTime(900 + Math.random() * 1500, t, 0.05);
    if (t > this.nextNote) {
      const count = Math.random() < 0.3 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.notes[Math.floor(Math.random() * this.notes.length)];
        const g = this.ctx.createGain();
        g.gain.value = 0.08 + Math.random() * 0.06;
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        if (pan) {
          pan.pan.value = Math.random() * 1.2 - 0.6;
          src.connect(g).connect(pan);
          pan.connect(this.reverb);
          pan.connect(this.master);
        } else {
          src.connect(g);
          g.connect(this.reverb);
          g.connect(this.master);
        }
        src.start(t + k * (0.25 + Math.random() * 0.3));
      }
      this.nextNote = t + 7 + Math.random() * 11;
    }
  }
}
