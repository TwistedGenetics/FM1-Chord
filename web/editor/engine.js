// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: the in-browser preview — the FM-1's synth (src/dsp/fc_synth.c) and player (src/core/fc_play.c) in
// JavaScript, the same maths, so a chord set sounds and plays here as it will on the FM-1. Used inside an
// AudioWorklet (worklet.js) or, where there is none, a ScriptProcessor. No DOM here.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { chordNotes, voiceLead, MAXN, NKEYS } from "./chord.js";

const FS = 44100;      // the FM-1's rate; the preview runs at the browser's and scales its time constants to it
const ANTI_DENORMAL = 1e-20;

// ---- fc_math.h ----
export function exp2(x) {
  x = Math.max(-30, Math.min(30, x));
  const i = Math.floor(x), f = x - i;
  const p = 1 + f * (0.69314718 + f * (0.24022650 + f * (0.05550411 + f * (0.00961813 + f * 0.00133336))));
  return Math.pow(2, i) * p;
}
export function sinTurn(t) {
  const u = 2 * t - 1, au = Math.abs(u);
  let y = 4 * u * (1 - au);
  y = 0.225 * (y * Math.abs(y) - y) + y;
  return -y;
}
const soft = (x) => (x > 1.5 ? 1 : x < -1.5 ? -1 : x - (4 / 27) * x * x * x);
const wrap1 = (p) => (p >= 1 ? p - 1 : p < 0 ? p + 1 : p);
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function osc(w, p, dt) {
  switch (w) {
    case 1: return (p < 0.5 ? 1 : -1) + blep(p, dt) - blep(wrap1(p + 0.5), dt);
    case 5: return (p < 0.25 ? 1 : -1) + blep(p, dt) - blep(wrap1(p + 0.75), dt) + 0.5;
    case 2: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 3: return sinTurn(p);
    case 4: {
      let p2 = p * 2, p3 = p * 3;
      p2 -= Math.floor(p2); p3 -= Math.floor(p3);
      return (sinTurn(p) + 0.6 * sinTurn(p2) + 0.45 * sinTurn(p3)) * 0.55;
    }
    default: return 2 * p - 1 - blep(p, dt);
  }
}

// ---- fc_synth.c ----
const VOICES = 10, CTRL = 16, CH_LEN = 1024;
export class Synth {
  constructor(rate = FS) {
    this.rate = rate;
    this.v = Array.from({ length: VOICES }, () => ({ note: 0, on: 0, sa: 0, sf: 0, age: 0, pa: 0, pb: 0, ps: 0, ia: 0,
      ib: 0, vel: 1, ea: 0, ef: 0, ic1: 0, ic2: 0, key: 0 }));
    this.age = 0;
    this.ch = new Float32Array(CH_LEN); this.chw = 0; this.chph = 0;
    const sc = rate / FS;
    const CL = [1116, 1188, 1277, 1356], AL = [556, 441];
    this.rc = [0, 1].map((c) => CL.map((l) => new Float32Array(Math.round((l + 23 * c) * sc))));
    this.ra = [0, 1].map((c) => AL.map((l) => new Float32Array(Math.round((l + 23 * c) * sc))));
    this.rci = [[0, 0, 0, 0], [0, 0, 0, 0]]; this.rai = [[0, 0], [0, 0]]; this.rcs = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.damp = 0.25;
    this.mono = new Float32Array(128);
  }
  tsec(v) { return 0.001 * exp2(v * (13 / 127)); }
  env(a, d, s, r) {
    const R = this.rate;
    return { a: 1 / (this.tsec(a) * R), d: exp2(-9.966 / (this.tsec(d) * R)), s: s / 127, r: exp2(-9.966 / (this.tsec(r) * R)) };
  }
  sound(o) {
    this.amp = this.env(o.amp_a, o.amp_d, o.amp_s, o.amp_r);
    this.flt = this.env(o.flt_a, o.flt_d, o.flt_s, o.flt_r);
    const lv = o.level / 127;
    this.level = lv * lv;
    this.cut = 4.3219 + o.cutoff * (9.8 / 127);
    this.fenv = o.fenv * (6 / 127);
    this.track = o.ftrack / 127;
    this.k = 2 - 1.94 * (o.res / 127);
    this.detune = exp2((o.detune * (50 / 127)) / 1200);
    this.bl = o.b_level / 127; this.sub = o.sub / 127; this.fm = o.fm * (0.5 / 127); this.vs = o.vel_sens / 127;
    this.wa = o.wave_a % 6; this.wb = o.wave_b % 6;
    this.chmix = o.chorus / 127; this.rvmix = o.rev_mix / 127; this.fb = 0.7 + 0.28 * (o.rev_size / 127);
  }
  on(note, vel) {
    let v = this.v.find((x) => x.sa && x.note === note);
    if (!v) {
      let old = null, rel = null;
      for (const x of this.v) {
        if (!x.sa) { v = x; break; }
        if (x.sa === 3 && (!rel || x.age < rel.age)) rel = x;
        if (!old || x.age < old.age) old = x;
      }
      if (!v) { v = rel || old; v.ea = v.ef = 0; v.ic1 = v.ic2 = 0; }
    }
    if (!v.sa) { v.ea = v.ef = 0; v.ic1 = v.ic2 = 0; v.pa = 0; v.pb = 0.37; v.ps = 0; }
    v.note = note; v.on = 1; v.sa = 1; v.sf = 1; v.age = ++this.age;
    const hz = 440 * exp2((note - 69) / 12);
    v.ia = hz / this.rate; v.ib = v.ia * this.detune;
    v.vel = 1 - this.vs + this.vs * (vel / 127);
    v.key = note - 60;
  }
  off(note) { for (const v of this.v) if (v.sa && v.on && v.note === note) { v.on = 0; v.sa = 3; v.sf = 3; } }
  allOff() { for (const v of this.v) if (v.sa) { v.on = 0; v.sa = 3; v.sf = 3; } }
  active() { return this.v.filter((v) => v.sa).length; }
  static step(st, e, c, v, which) {
    switch (v[which]) {
      case 1: e += c.a; if (e >= 1) { e = 1; v[which] = 2; } return e;
      case 2: e = c.s + (e - c.s) * c.d; return Math.abs(e - c.s) < 1e-6 ? c.s : e;
      case 3: e *= c.r; if (e < 1e-4) { e = 0; v[which] = 0; } return e;
      default: return 0;
    }
  }
  voice(v, mono, n) {
    const gain = 0.16 * v.vel, nyq = 0.45 * this.rate;
    for (let i = 0; i < n; i += CTRL) {
      const m = Math.min(CTRL, n - i);
      let f = exp2(this.cut + this.fenv * v.ef + this.track * v.key / 12);
      if (f > nyq) f = nyq;
      const g = Math.tan(Math.PI * f / this.rate), a1 = 1 / (1 + g * (g + this.k)), a2 = g * a1, a3 = g * a2;
      for (let j = 0; j < m; j++) {
        let pa = v.pa;
        if (this.fm > 0) pa = wrap1(pa + this.fm * sinTurn(v.pb));
        let x = osc(this.wa, pa, v.ia);
        if (this.bl > 0) x += this.bl * osc(this.wb, v.pb, v.ib);
        if (this.sub > 0) x += this.sub * osc(1, v.ps, v.ia * 0.5);
        v.pa = wrap1(v.pa + v.ia); v.pb = wrap1(v.pb + v.ib); v.ps = wrap1(v.ps + v.ia * 0.5);
        const v3 = x - v.ic2, v1 = a1 * v.ic1 + a2 * v3, v2 = v.ic2 + a2 * v.ic1 + a3 * v3;
        v.ic1 = 2 * v1 - v.ic1; v.ic2 = 2 * v2 - v.ic2;
        v.ea = Synth.step(0, v.ea, this.amp, v, "sa");
        v.ef = Synth.step(0, v.ef, this.flt, v, "sf");
        mono[i + j] += v2 * v.ea * gain;
      }
      if (!v.sa) break;
    }
    if (!v.sa) { v.ic1 = v.ic2 = 0; v.sf = 0; }
  }
  render(L, R, off, n) {
    const mono = this.mono, sc = this.rate / FS;
    for (let done = 0; done < n;) {
      const k = Math.min(128, n - done);
      mono.fill(0, 0, k);
      for (const v of this.v) if (v.sa) this.voice(v, mono, k);
      for (let i = 0; i < k; i++) {
        const x = mono[i];
        let l = x, r = x;
        this.ch[this.chw & (CH_LEN - 1)] = x;
        if (this.chmix > 0) {
          const tri = this.chph < 0.5 ? 4 * this.chph - 1 : 3 - 4 * this.chph;
          const d1 = (154 + 88 * tri) * sc, d2 = (154 - 88 * tri) * sc;
          const i1 = d1 | 0, i2 = d2 | 0, t1 = d1 - i1, t2 = d2 - i2;
          const w1 = this.ch[(this.chw - i1) & (CH_LEN - 1)] * (1 - t1) + this.ch[(this.chw - i1 - 1) & (CH_LEN - 1)] * t1;
          const w2 = this.ch[(this.chw - i2) & (CH_LEN - 1)] * (1 - t2) + this.ch[(this.chw - i2 - 1) & (CH_LEN - 1)] * t2;
          l = x * (1 - 0.4 * this.chmix) + w1 * this.chmix;
          r = x * (1 - 0.4 * this.chmix) + w2 * this.chmix;
          this.chph += 0.5 / this.rate;
          if (this.chph >= 1) this.chph -= 1;
        }
        this.chw++;
        if (this.rvmix > 0) {
          const inp = (l + r) * 0.015, out = [0, 0];
          for (let c = 0; c < 2; c++) {
            let acc = 0;
            for (let q = 0; q < 4; q++) {
              const bf = this.rc[c][q], idx = this.rci[c][q], o = bf[idx];
              this.rcs[c][q] = o * (1 - this.damp) + this.rcs[c][q] * this.damp + ANTI_DENORMAL;
              bf[idx] = inp + this.rcs[c][q] * this.fb;
              this.rci[c][q] = idx + 1 >= bf.length ? 0 : idx + 1;
              acc += o;
            }
            for (let q = 0; q < 2; q++) {
              const bf = this.ra[c][q], idx = this.rai[c][q], bo = bf[idx], o = bo - acc;
              bf[idx] = acc + bo * 0.5 + ANTI_DENORMAL;
              this.rai[c][q] = idx + 1 >= bf.length ? 0 : idx + 1;
              acc = o;
            }
            out[c] = acc;
          }
          l += out[0] * this.rvmix * 3;
          r += out[1] * this.rvmix * 3;
        }
        L[off + done + i] = soft(l * this.level);
        R[off + done + i] = soft(r * this.level);
      }
      done += k;
    }
  }
}

// ---- fc_play.c ----
const RATE_TICKS = [24, 12, 8, 6, 4, 3];
export class Player {
  constructor(out, rate = FS) {
    this.out = out; this.rate = rate;
    this.key = -1; this.held = 0; this.notes = []; this.hasBass = 0; this.prev = []; this.prevBass = -1; this.prevShift = 0; this.vel = 100;
    this.sounding = new Set(); this.strum = []; this.stAlt = 0;
    this.arp = []; this.arpI = 0; this.arpUp = 1; this.arpNote = -1; this.arpPhase = 0; this.arpTicks = 0;
    this.now = 0; this.rng = 0x2545f491; this.chordCount = 0;
  }
  rnd() { let x = this.rng; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.rng = x; return x; }
  noteOn(n, v) { if (this.sounding.has(n)) this.out.off(n); this.sounding.add(n); this.out.on(n, v); }
  noteOff(n) { if (this.sounding.delete(n)) this.out.off(n); }
  allOff() { for (const n of [...this.sounding].sort((a, b) => a - b)) this.noteOff(n); this.strum = []; this.arpNote = -1; }
  human(s, v) {
    const h = s.play.humanise;
    if (!h) return v;
    const r = (this.rnd() % (2 * h + 1)) - h;
    return Math.max(1, Math.min(127, v + Math.trunc((r * 40) / 127)));
  }
  preview(s, key) {
    const c = s.chords[key];
    let notes = chordNotes(c, s.play.transpose + 12 * s.play.octave);
    const hb = notes.length && c.bass < 12 ? 1 : 0;
    if (notes.length && s.play.voice_lead && this.prev.length) {   // led from the last chord at today's octave
      const d = s.play.transpose + 12 * s.play.octave - this.prevShift, cl = (v) => Math.max(0, Math.min(127, v));
      notes = voiceLead(this.prev.map((v) => cl(v + d)), this.prevBass >= 0 ? cl(this.prevBass + d) : -1, notes, hb);
    }
    return { notes, hasBass: hb };
  }
  start(s, key, vel) {
    this.allOff();
    const { notes, hasBass } = this.preview(s, key);
    this.notes = notes; this.hasBass = hasBass; this.key = notes.length ? key : -1; this.vel = vel;
    if (!notes.length) return;
    this.chordCount++;
    this.prev = notes.slice(hasBass); this.prevBass = hasBass ? notes[0] : -1;
    this.prevShift = s.play.transpose + 12 * s.play.octave;
    if (s.play.mode === 2) {
      const oct = s.play.arp_oct || 1;
      this.arp = [];
      for (let o = 0; o < oct; o++) for (const n of notes) if (n + 12 * o <= 127 && this.arp.length < 24) this.arp.push(n + 12 * o);
      this.arpI = 0; this.arpUp = 1; this.arpPhase = 0; this.arpTicks = 0; this.arpNote = -1;
      if (this.arp.length) {
        let v = s.play.arp_dir === 1 ? this.arp[this.arp.length - 1] : this.arp[0];
        if (s.play.arp_dir === 3) v = this.arp[this.rnd() % this.arp.length];
        if (s.play.arp_dir === 1) this.arpI = this.arp.length - 1;
        this.noteOn(v, this.human(s, vel));
        this.arpNote = v;
      }
      return;
    }
    if (s.play.mode === 1 && s.play.strum) {
      const down = s.play.strum_dir === 1 || (s.play.strum_dir === 2 && (this.stAlt & 1));
      const gap = Math.floor((s.play.strum * 2 * this.rate) / 1000);
      this.stAlt++;
      this.strum = notes.map((_, i) => notes[down ? notes.length - 1 - i : i])
        .map((n, i) => ({ n, v: this.human(s, vel), at: this.now + i * gap }));
      this.run(s, 0, true);
      return;
    }
    for (const n of notes) this.noteOn(n, this.human(s, vel));
  }
  release() { this.allOff(); this.key = -1; }
  stop() { this.release(); this.held = 0; }
  keyEvent(s, key, vel) {
    if (key < 0 || key >= NKEYS) return;
    if (vel) {
      this.held |= 1 << key;
      if (s.play.latch && this.key === key) { this.release(); return; }
      this.start(s, key, vel);
      return;
    }
    this.held &= ~(1 << key);
    if (this.key === key && !s.play.latch) this.release();
  }
  arpStep(s) {
    if (this.arpNote >= 0) this.noteOff(this.arpNote);
    this.arpNote = -1;
    const n = this.arp.length;
    if (!n || this.key < 0) return;
    switch (s.play.arp_dir) {
      case 1: this.arpI = this.arpI ? this.arpI - 1 : n - 1; break;
      case 2:
        if (n < 2) this.arpI = 0;
        else if (this.arpUp) { if (++this.arpI >= n - 1) { this.arpI = n - 1; this.arpUp = 0; } }
        else if (this.arpI === 0 || --this.arpI === 0) this.arpUp = 1;
        break;
      case 3: this.arpI = this.rnd() % n; break;
      default: this.arpI = (this.arpI + 1) % n;
    }
    const v = this.arp[this.arpI];
    this.noteOn(v, this.human(s, this.vel));
    this.arpNote = v;
  }
  stepSamples(s) {
    const bpm = Math.max(40, s.tempo);
    return Math.floor((Math.floor((this.rate * 60) / bpm) * RATE_TICKS[s.play.arp_rate % 6]) / 24);
  }
  run(s, frames, extClock) {
    this.strum = this.strum.filter((e) => {
      if (e.at - (this.now + frames) <= 0) { this.noteOn(e.n, e.v); return false; }
      return true;
    });
    if (s.play.mode === 2 && this.key >= 0 && this.arp.length) {
      const len = this.stepSamples(s), gate = Math.floor((len * s.play.arp_gate) / 100);
      if (this.arpNote >= 0 && this.arpPhase < gate && this.arpPhase + frames >= gate && s.play.arp_gate < 100) {
        this.noteOff(this.arpNote); this.arpNote = -1;
      }
      this.arpPhase += frames;
      if (!extClock && this.arpPhase >= len) {
        this.arpPhase -= len;
        if (this.arpPhase >= len) this.arpPhase = 0;
        this.arpStep(s);
      }
    }
    this.now += frames;
  }
}

// ---- the engine: a set, the player and the synth, driven by messages; renders blocks ----
export class Engine {
  constructor(rate, post) {
    this.rate = rate;
    this.post = post || (() => {});                 // note events out (MIDI to other synths, the keyboard's lights)
    this.synth = new Synth(rate);
    this.local = true;
    this.set = null;
    this.player = new Player({
      on: (n, v) => { if (this.local) this.synth.on(n, v); this.post({ type: "note", on: 1, note: n, vel: v }); },
      off: (n) => { this.synth.off(n); this.post({ type: "note", on: 0, note: n }); },
    }, rate);
    this.raw = new Set();
  }
  message(m) {
    switch (m.type) {
      case "set": {
        const changedSound = !this.set || JSON.stringify(this.set.sound) !== JSON.stringify(m.set.sound);
        this.set = m.set;
        if (changedSound) this.synth.sound(m.set.sound);
        break;
      }
      case "key": if (this.set) this.player.keyEvent(this.set, m.key, m.vel); break;
      case "notes": {                                // play notes directly (suggestions, learn, progression)
        for (const n of this.raw) { this.synth.off(n); this.post({ type: "note", on: 0, note: n }); }
        this.raw.clear();
        for (const n of m.notes || []) {
          if (this.local) this.synth.on(n, m.vel || 100);
          this.post({ type: "note", on: 1, note: n, vel: m.vel || 100 });
          this.raw.add(n);
        }
        break;
      }
      case "stop": this.player.stop(); for (const n of this.raw) this.synth.off(n); this.raw.clear(); this.synth.allOff(); break;
      case "local": this.local = !!m.on; break;
      default: break;
    }
  }
  process(L, R, n) {
    if (this.set) this.player.run(this.set, n, false);
    this.synth.render(L, R, 0, n);
  }
}
export { MAXN };
