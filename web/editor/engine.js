// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: the in-browser preview — the FM-1's synth (src/dsp/fc_synth.c) and player (src/core/fc_play.c) in
// JavaScript, the same maths, so a chord set sounds and plays here as it will on the FM-1. Used inside an
// AudioWorklet (worklet.js) or, where there is none, a ScriptProcessor. No DOM here.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { chordNotes, voiceLead, MAXN, NKEYS } from "./chord.js";
import { WT, WT_N, WT_FRAMES } from "./wavetables.js";

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
const soft = (x) => (Math.abs(x) < 1e-5 ? x : x > 1.5 ? 1 : x < -1.5 ? -1 : x - (4 / 27) * x * x * x);   // fc_soft
const wrap1 = (p) => (p >= 1 ? p - 1 : p < 0 ? p + 1 : p);
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// pw: the pulse width's move from its own (square 50 %, pulse 25 %)
function osc(w, p, dt, pw) {
  switch (w) {
    case 1: case 5: {
      const h = Math.max(0.04, Math.min(0.96, (w === 1 ? 0.5 : 0.25) + pw));
      return (p < h ? 1 : -1) + blep(p, dt) - blep(wrap1(p + 1 - h), dt) - (2 * h - 1);
    }
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
// fc_tanf: the same series, so the filter matches the FM-1's
function tanS(x) {
  const x2 = x * x;
  const s = x * (1 - x2 * (1 / 6 - x2 * (1 / 120 - x2 * (1 / 5040 - x2 * (1 / 362880)))));
  const c = 1 - x2 * (0.5 - x2 * (1 / 24 - x2 * (1 / 720 - x2 * (1 / 40320 - x2 * (1 / 3628800)))));
  return s / c;
}
const clampf = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ---- fc_synth.c ----
const VOICES = 10, CTRL = 16, CH_LEN = 1024, BLOCK = 128, DLY_LEN = 32768;
const MD = { PITCH: 1, CUT: 2, RES: 3, BLEV: 4, FM: 5, PW: 6, AMP: 7, DETUNE: 8, SUB: 9, DRIVE: 10, FENV: 11,
  L1RATE: 12, DLYMIX: 13, REVMIX: 14, CHORUS: 15, WTPOS: 16, SPREAD: 17, BPITCH: 18, N: 19 };
const mdGlobal = (d) => d >= MD.L1RATE && d <= MD.CHORUS;
const W = { SUPERSAW: 6, NOISE: 7, WT0: 8 }, OM = { ADD: 0, SYNC: 1, RING: 2 };
const CH_RATE = [0.5, 0.83, 8], CH_DEPTH = [88, 88, 18];
const SS_OFF = [-0.11002313, -0.06288439, -0.01952356, 0.01991221, 0.06216538, 0.10745242];
const SS_P0 = [0.11, 0.53, 0.29, 0.71, 0.89, 0.43];
function supersaw(ph, p, dt, d) {
  let y = 0.6 * (2 * p - 1 - blep(p, dt)), sides = 0;
  for (let k = 0; k < 6; k++) {
    let q = ph[k] + dt * (1 + SS_OFF[k] * d);
    q = q >= 1 ? q - 1 : q;
    ph[k] = q;
    sides += 2 * q - 1;
  }
  return (y + (0.15 + 0.25 * d) * sides) * 0.55;
}
function wavetable(t, pos, p) {
  const f = pos * (WT_FRAMES - 1), x = p * WT_N;
  let i = f | 0, j = x | 0;
  if (i >= WT_FRAMES - 1) i = WT_FRAMES - 2;
  const u = f - i, w = x - j;
  j &= WT_N - 1;
  const j1 = (j + 1) & (WT_N - 1), b0 = (t * WT_FRAMES + i) * WT_N, b1 = b0 + WT_N;
  const a = WT[b0 + j] + (WT[b0 + j1] - WT[b0 + j]) * w, b = WT[b1 + j] + (WT[b1 + j1] - WT[b1 + j]) * w;
  return (a + (b - a) * u) / 32767;
}
const MS = { LFO1: 1, LFO2: 2, MENV: 3, VEL: 4, KEY: 5, M1: 6, N: 10 };
const DIV_BEATS = [0.125, 1 / 6, 0.25, 1 / 3, 0.375, 0.5, 2 / 3, 0.75, 1, 1.5, 2, 4, 8, 16, 32];
function modScale(dst, amt) {
  const a = amt / 127;
  switch (dst) {
    case MD.PITCH: case MD.BPITCH: return 24 * a * Math.abs(a);
    case MD.CUT: case MD.FENV: return 6 * a;
    case MD.FM: return 0.5 * a;
    case MD.PW: return 0.45 * a;
    case MD.DETUNE: return 50 * a;
    case MD.L1RATE: return 3 * a;
    default: return a;
  }
}
export const defaultSx = () => ({ flt_mode: 0, flt_slope: 0, drive: 0, lfo_wave: [0, 0], lfo_rate: [64, 40],
  lfo_sync: [0, 0], menv_a: 40, menv_d: 80, menv_s: 0, menv_r: 70,
  mod: Array.from({ length: 6 }, () => ({ src: 0, dst: 0, amt: 0 })), macro: [64, 64, 64, 64], dly_time: 7, dly_fb: 50,
  dly_mix: 0, dly_tone: 80, dly_mode: 0 });

export const defaultS3 = () => ({ wt_pos: 0, spread: 50, osc_mode: 0, b_semi: 0, crush_bits: 0, crush_rate: 0,
  wobble: 0, chorus_mode: 0, phaser: 0 });

export class Synth {
  constructor(rate = FS) {
    this.rate = rate;
    this.v = Array.from({ length: VOICES }, () => ({ note: 0, on: 0, sa: 0, sf: 0, sm: 0, age: 0, pa: 0, pb: 0, ps: 0,
      ia: 0, ib: 0, vel: 1, velr: 0, ea: 0, ef: 0, em: 0, ic1: 0, ic2: 0, ic3: 0, ic4: 0, key: 0,
      ssa: new Float32Array(6), ssb: new Float32Array(6) }));
    this.age = 0;
    this.ch = new Float32Array(CH_LEN); this.chw = 0; this.chph = 0;
    const sc = rate / FS;
    const CL = [1116, 1188, 1277, 1356], AL = [556, 441];
    this.rc = [0, 1].map((c) => CL.map((l) => new Float32Array(Math.round((l + 23 * c) * sc))));
    this.ra = [0, 1].map((c) => AL.map((l) => new Float32Array(Math.round((l + 23 * c) * sc))));
    this.rci = [[0, 0, 0, 0], [0, 0, 0, 0]]; this.rai = [[0, 0], [0, 0]]; this.rcs = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.damp = 0.25;
    this.mono = new Float32Array(BLOCK);
    this.dl = [new Int16Array(DLY_LEN), new Int16Array(DLY_LEN)]; this.dlw = 0; this.dlLen = 1;
    this.dlLp = [0, 0]; this.dlHp = [0, 0];
    this.lfoPh = [0, 0]; this.lfoHz = [1, 1]; this.lfoSh = [0, 0]; this.lfoBlk = [new Float32Array(8), new Float32Array(8)];
    this.rng = 0x9e3779b9; this.tempoBpm = 120; this.maxv = VOICES;
    this.sx = defaultSx();
    this.wob = 1; this.wobPh = [0, 0]; this.crPh = 0; this.crHold = 0;
    this.phPh = 0; this.phA = [0, 0]; this.phZ = [[0, 0, 0, 0], [0, 0, 0, 0]]; this.phY = [0, 0];
    this.s3x(defaultS3());
  }
  s3x(t) {
    this.s3 = t;
    this.wtPos = t.wt_pos / 127; this.spread = t.spread / 127; this.omode = t.osc_mode % 3;
    this.bRatio = exp2(t.b_semi / 12); this.wobDepth = t.wobble / 127;
    this.crStep = t.crush_rate ? exp2(-t.crush_rate * (5 / 127)) : 1;
    this.crQ = t.crush_bits ? exp2(15 - t.crush_bits * (13 / 127)) : 0;
    this.phMix = t.phaser / 63;
    this.chRate = CH_RATE[t.chorus_mode % 3]; this.chDepth = CH_DEPTH[t.chorus_mode % 3];
  }
  tsec(v) { return 0.001 * exp2(v * (13 / 127)); }
  env(a, d, s, r) {
    const R = this.rate;
    return { a: 1 / (this.tsec(a) * R), d: exp2(-9.966 / (this.tsec(d) * R)), s: s / 127, r: exp2(-9.966 / (this.tsec(r) * R)) };
  }
  sound(o, x = defaultSx(), t = defaultS3()) {
    this.sx = x;
    this.s3x(t);
    this.amp = this.env(o.amp_a, o.amp_d, o.amp_s, o.amp_r);
    this.flt = this.env(o.flt_a, o.flt_d, o.flt_s, o.flt_r);
    this.menv = this.env(x.menv_a, x.menv_d, x.menv_s, x.menv_r);
    const lv = o.level / 127;
    this.level = lv * lv;
    this.cut = 4.3219 + o.cutoff * (9.8 / 127);
    this.fenv = o.fenv * (6 / 127);
    this.track = o.ftrack / 127;
    this.res = o.res / 127;
    this.detuneC = o.detune * (50 / 127);
    this.bl = o.b_level / 127; this.sub = o.sub / 127; this.fm = o.fm * (0.5 / 127); this.vs = o.vel_sens / 127;
    this.drive = x.drive / 127;
    this.wa = o.wave_a % 12; this.wb = o.wave_b % 12;
    this.chmix = o.chorus / 127; this.rvmix = o.rev_mix / 127; this.fb = 0.7 + 0.28 * (o.rev_size / 127);
    this.mv = []; this.mg = []; this.useMenv = false;
    for (const m of x.mod) {
      if (!m.src || !m.dst || !m.amt || m.src >= MS.N || m.dst >= MD.N) continue;
      if (mdGlobal(m.dst)) {
        if (m.src === MS.MENV || m.src === MS.VEL || m.src === MS.KEY) continue;
        this.mg.push({ src: m.src, dst: m.dst, amt: modScale(m.dst, m.amt) });
      } else {
        this.mv.push({ src: m.src, dst: m.dst, amt: modScale(m.dst, m.amt) });
        if (m.src === MS.MENV) this.useMenv = true;
      }
    }
    this.macro = x.macro.map((v) => v / 127);
    this.dlFb = 0.95 * (x.dly_fb / 127);
    this.dlMix = x.dly_mix / 127;
    this.dlC = 1 - Math.exp(-2 * Math.PI * (500 * exp2(x.dly_tone * (5 / 127))) / this.rate);
    this.dlHc = 0.0171 * FS / this.rate;              // about 120 Hz, as the FM-1
    this.delayLen(); this.lfoRates();
  }
  tempo(bpm) { this.tempoBpm = clampf(bpm, 20, 300); this.delayLen(); this.lfoRates(); }
  delayLen() {
    let n = DIV_BEATS[this.sx.dly_time % 15] * 60 / this.tempoBpm * this.rate;
    while (n > DLY_LEN - 1) n *= 0.5;
    this.dlLen = n < 1 ? 1 : Math.floor(n);
  }
  lfoRates() {
    for (let i = 0; i < 2; i++) {
      const r = this.sx.lfo_rate[i];
      this.lfoHz[i] = this.sx.lfo_sync[i] ? this.tempoBpm / 60 / DIV_BEATS[14 - ((r * 15) >> 7)] : 0.03 * exp2(r * (10 / 127));
    }
  }
  on(note, vel) {
    let v = this.v.find((x) => x.sa && x.note === note);
    if (!v) {
      let old = null, rel = null;
      for (const x of this.v.slice(0, this.maxv)) {
        if (!x.sa) { v = x; break; }
        if (x.sa === 3 && (!rel || x.age < rel.age)) rel = x;
        if (!old || x.age < old.age) old = x;
      }
      if (!v) { v = rel || old; v.ea = 0; v.ef = v.em = 0; v.ic1 = v.ic2 = v.ic3 = v.ic4 = 0; }
    }
    if (!v.sa) {
      v.ea = v.ef = v.em = 0; v.ic1 = v.ic2 = v.ic3 = v.ic4 = 0; v.pa = 0; v.pb = 0.37; v.ps = 0;
      for (let k = 0; k < 6; k++) { v.ssa[k] = SS_P0[k]; v.ssb[k] = SS_P0[5 - k]; }
    }
    v.note = note; v.on = 1; v.sa = 1; v.sf = 1; v.sm = 1; v.age = ++this.age;
    const hz = 440 * exp2((note - 69) / 12);
    v.ia = hz / this.rate; v.ib = v.ia * this.bRatio * exp2(this.detuneC / 1200);
    v.velr = vel / 127;
    v.vel = 1 - this.vs + this.vs * v.velr;
    v.key = note - 60;
  }
  off(note) { for (const v of this.v) if (v.sa && v.on && v.note === note) { v.on = 0; v.sa = 3; v.sf = 3; v.sm = 3; } }
  allOff() { for (const v of this.v) if (v.sa) { v.on = 0; v.sa = 3; v.sf = 3; v.sm = 3; } }
  active() { return this.v.filter((v) => v.sa).length; }
  static step(st, e, c, v, which) {
    switch (v[which]) {
      case 1: e += c.a; if (e >= 1) { e = 1; v[which] = 2; } return e;
      case 2: e = c.s + (e - c.s) * c.d; return Math.abs(e - c.s) < 1e-6 ? c.s : e;
      case 3: e *= c.r; if (e < 1e-4) { e = 0; v[which] = 0; } return e;
      default: return 0;
    }
  }
  src(v, src, blk) {
    switch (src) {
      case MS.LFO1: return this.lfoBlk[0][blk];
      case MS.LFO2: return this.lfoBlk[1][blk];
      case MS.MENV: return v ? v.em : 0;
      case MS.VEL: return v ? v.velr : 0;
      case MS.KEY: return v ? v.key / 60 : 0;
      default: return src >= MS.M1 && src < MS.N ? this.macro[src - MS.M1] : 0;
    }
  }
  noise() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return (this.rng | 0) / 2147483648;
  }
  oscAny(w, p, dt, pw, ss, spread, pos) {
    if (w === W.SUPERSAW) return supersaw(ss, p, dt, spread);
    if (w === W.NOISE) return this.noise();
    if (w >= W.WT0) return wavetable(w - W.WT0, pos, p);
    return osc(w, p, dt, pw);
  }
  static svfOut(mode, x, v1, v2, k) {
    switch (mode) { case 1: return v1; case 2: return x - k * v1 - v2; case 3: return x - k * v1; default: return v2; }
  }
  voice(v, mono, n) {
    const nyq = 0.45 * this.rate, mode = this.sx.flt_mode, slope = this.sx.flt_slope, R2 = 1.41421356;
    const md = new Float32Array(MD.N);
    for (let i = 0; i < n; i += CTRL) {
      const m = Math.min(CTRL, n - i), blk = (i / CTRL) | 0;
      md.fill(0);
      for (const q of this.mv) md[q.dst] += q.amt * this.src(v, q.src, blk);
      let ia = v.ia, ib = v.ib, bl = this.bl, sub = this.sub, fm = this.fm, pw = 0, drv = this.drive;
      let pos = this.wtPos, spr = this.spread;
      if (this.mv.length || this.wob !== 1) {
        if (md[MD.PITCH] !== 0 || md[MD.DETUNE] !== 0 || md[MD.BPITCH] !== 0 || this.wob !== 1) {
          ia = v.ia * exp2(md[MD.PITCH] / 12) * this.wob;
          ib = ia * this.bRatio * exp2((this.detuneC + md[MD.DETUNE]) / 1200 + md[MD.BPITCH] / 12);
        }
        pos = clampf(pos + md[MD.WTPOS], 0, 1); spr = clampf(spr + md[MD.SPREAD], 0, 1);
        bl = clampf(bl + md[MD.BLEV], 0, 1); sub = clampf(sub + md[MD.SUB], 0, 1);
        fm = clampf(fm + md[MD.FM], 0, 0.5); pw = md[MD.PW]; drv = clampf(drv + md[MD.DRIVE], 0, 1);
      }
      const gain = 0.16 * v.vel * clampf(1 + md[MD.AMP], 0, 2);
      let f = exp2(this.cut + (this.fenv + md[MD.FENV]) * v.ef + this.track * v.key / 12 + md[MD.CUT]);
      if (f > nyq) f = nyq;
      const g = tanS(Math.PI * f / this.rate), k = 2 - 1.94 * clampf(this.res + md[MD.RES], 0, 1);
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const b1 = 1 / (1 + g * (g + R2)), b2 = g * b1, b3 = g * b2;
      const dg = 0.5 + 3.5 * drv, dc = 2 / (1 + drv);
      const ga = this.omode === OM.ADD ? 1 : 1 - bl, gb = this.omode === OM.RING ? 1.4 * bl : bl;
      for (let j = 0; j < m; j++) {
        let pa = v.pa;
        if (fm > 0) pa = wrap1(pa + fm * sinTurn(v.pb));
        let x = this.oscAny(this.wa, pa, ia, pw, v.ssa, spr, pos);
        if (bl > 0) {
          const y2 = this.oscAny(this.wb, v.pb, ib, pw, v.ssb, spr, pos);
          x = ga * x + gb * (this.omode === OM.RING ? x * y2 : y2);
        }
        if (sub > 0) x += sub * osc(1, v.ps, ia * 0.5, 0);
        v.pa += ia;
        if (v.pa >= 1) { v.pa -= 1; if (this.omode === OM.SYNC) v.pb = v.pa * (ib / ia); }
        v.pb = wrap1(v.pb + ib); v.ps = wrap1(v.ps + ia * 0.5);
        if (drv > 0) { const u = x * dg; x = dc * u / (1 + Math.abs(u)); }
        const v3 = x - v.ic2, v1 = a1 * v.ic1 + a2 * v3, v2 = v.ic2 + a2 * v.ic1 + a3 * v3;
        v.ic1 = 2 * v1 - v.ic1 + ANTI_DENORMAL; v.ic2 = 2 * v2 - v.ic2;
        let y = Synth.svfOut(mode, x, v1, v2, k);
        if (slope) {
          const w3 = y - v.ic4, w1 = b1 * v.ic3 + b2 * w3, w2 = v.ic4 + b2 * v.ic3 + b3 * w3;
          v.ic3 = 2 * w1 - v.ic3 + ANTI_DENORMAL; v.ic4 = 2 * w2 - v.ic4;
          y = Synth.svfOut(mode, y, mode === 1 ? R2 * w1 : w1, w2, R2);
        }
        v.ea = Synth.step(0, v.ea, this.amp, v, "sa");
        v.ef = Synth.step(0, v.ef, this.flt, v, "sf");
        if (this.useMenv) v.em = Synth.step(0, v.em, this.menv, v, "sm");
        mono[i + j] += y * v.ea * gain;
      }
      if (!v.sa) break;
    }
    if (!v.sa) { v.ic1 = v.ic2 = v.ic3 = v.ic4 = 0; v.sf = 0; v.sm = 0; v.em = 0; }
  }
  lfoVal(i) {
    const p = this.lfoPh[i];
    switch (this.sx.lfo_wave[i]) {
      case 1: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      case 2: return 1 - 2 * p;
      case 3: return p < 0.5 ? 1 : -1;
      case 4: return this.lfoSh[i];
      default: return sinTurn(p);
    }
  }
  render(L, R, off, n) {
    const mono = this.mono, sc = this.rate / FS;
    for (let done = 0; done < n;) {
      const k = Math.min(BLOCK, n - done);
      const g = new Float32Array(MD.N);
      for (const q of this.mg) g[q.dst] += q.amt * this.src(null, q.src, 0);
      const l1 = g[MD.L1RATE] !== 0 ? exp2(g[MD.L1RATE]) : 1;
      for (let i = 0; i < k; i += CTRL) {
        const m = Math.min(CTRL, k - i);
        for (let c = 0; c < 2; c++) {
          this.lfoBlk[c][(i / CTRL) | 0] = this.lfoVal(c);
          this.lfoPh[c] += this.lfoHz[c] * (c ? 1 : l1) * m / this.rate;
          if (this.lfoPh[c] >= 1) {
            this.lfoPh[c] -= Math.floor(this.lfoPh[c]);
            this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
            this.lfoSh[c] = (this.rng >>> 8) * (2 / 16777216) - 1;
          }
        }
      }
      if (this.wobDepth > 0) {
        this.wobPh[0] += 0.55 * k / this.rate; this.wobPh[1] += 6.3 * k / this.rate;
        for (let c = 0; c < 2; c++) if (this.wobPh[c] >= 1) this.wobPh[c] -= 1;
        this.wob = exp2(this.wobDepth * (0.25 * sinTurn(this.wobPh[0]) + 0.04 * sinTurn(this.wobPh[1])) / 12);
      } else this.wob = 1;
      const chmix = clampf(this.chmix + g[MD.CHORUS], 0, 1), rvmix = clampf(this.rvmix + g[MD.REVMIX], 0, 1);
      const dlmix = clampf(this.dlMix + g[MD.DLYMIX], 0, 1);
      mono.fill(0, 0, k);
      for (const v of this.v) if (v.sa) this.voice(v, mono, k);
      if (this.crQ > 0 || this.crStep < 1) {
        const step = this.crStep * FS / this.rate;     // the same rate in Hz whatever the browser's
        for (let i = 0; i < k; i++) {
          let x = mono[i];
          if (this.crStep < 1) {
            this.crPh += step;
            if (this.crPh >= 1) { this.crPh -= 1; this.crHold = x; }
            x = this.crHold;
          }
          if (this.crQ > 0) { const y = x * this.crQ; x = Math.trunc(y + (y < 0 ? -0.5 : 0.5)) / this.crQ; }
          mono[i] = x;
        }
      }
      if (this.phMix > 0) {
        this.phPh += 0.3 * k / this.rate;
        if (this.phPh >= 1) this.phPh -= 1;
        for (let c = 0; c < 2; c++) {
          let p = this.phPh + 0.25 * c;
          p = p >= 1 ? p - 1 : p;
          const tri = p < 0.5 ? 2 * p : 2 - 2 * p, tn = tanS(Math.PI * 300 * exp2(3.32 * tri) / this.rate);
          this.phA[c] = (tn - 1) / (tn + 1);
        }
      }
      for (let i = 0; i < k; i++) {
        const x = mono[i];
        let l = x, r = x;
        this.ch[this.chw & (CH_LEN - 1)] = x;
        if (chmix > 0) {
          const tri = this.chph < 0.5 ? 4 * this.chph - 1 : 3 - 4 * this.chph;
          const d1 = (154 + this.chDepth * tri) * sc, d2 = (154 - this.chDepth * tri) * sc;
          const i1 = d1 | 0, i2 = d2 | 0, t1 = d1 - i1, t2 = d2 - i2;
          const w1 = this.ch[(this.chw - i1) & (CH_LEN - 1)] * (1 - t1) + this.ch[(this.chw - i1 - 1) & (CH_LEN - 1)] * t1;
          const w2 = this.ch[(this.chw - i2) & (CH_LEN - 1)] * (1 - t2) + this.ch[(this.chw - i2 - 1) & (CH_LEN - 1)] * t2;
          l = x * (1 - 0.4 * chmix) + w1 * chmix;
          r = x * (1 - 0.4 * chmix) + w2 * chmix;
          this.chph += this.chRate / this.rate;
          if (this.chph >= 1) this.chph -= 1;
        }
        this.chw++;
        if (this.phMix > 0) {
          const io = [l, r];
          for (let c = 0; c < 2; c++) {
            let y = io[c] + 0.4 * this.phY[c];
            const z = this.phZ[c], a = this.phA[c];
            for (let q = 0; q < 4; q++) { const o2 = a * y + z[q]; z[q] = y - a * o2 + ANTI_DENORMAL; y = o2; }
            this.phY[c] = y;
            io[c] += this.phMix * y;
          }
          l = io[0] * (1 - 0.3 * this.phMix); r = io[1] * (1 - 0.3 * this.phMix);
        }
        if (dlmix > 0) {
          const rd = (this.dlw - this.dlLen) & (DLY_LEN - 1), w = this.dlw & (DLY_LEN - 1);
          const dlv = this.dl[0][rd] / 32767, drv = this.dl[1][rd] / 32767;
          this.dlLp[0] += this.dlC * (dlv - this.dlLp[0]) + ANTI_DENORMAL;
          this.dlLp[1] += this.dlC * (drv - this.dlLp[1]) + ANTI_DENORMAL;
          this.dlHp[0] += this.dlHc * (this.dlLp[0] - this.dlHp[0]);
          this.dlHp[1] += this.dlHc * (this.dlLp[1] - this.dlHp[1]);
          const fl = (this.dlLp[0] - this.dlHp[0]) * this.dlFb, fr = (this.dlLp[1] - this.dlHp[1]) * this.dlFb;
          let il, ir;
          if (this.sx.dly_mode) { il = (l + r) * 0.5 + fr; ir = fl; } else { il = l + fl; ir = r + fr; }
          this.dl[0][w] = Math.trunc(soft(il) * 32767);
          this.dl[1][w] = Math.trunc(soft(ir) * 32767);
          l += dlv * dlmix;
          r += drv * dlmix;
        }
        this.dlw++;
        if (rvmix > 0) {
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
          l += out[0] * rvmix * 3;
          r += out[1] * rvmix * 3;
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
        const was = this.set, sx = m.set.sx || defaultSx(), s3 = m.set.s3 || defaultS3();
        const changedSound = !was || JSON.stringify(was.sound) !== JSON.stringify(m.set.sound) ||
          JSON.stringify(was.sx || null) !== JSON.stringify(m.set.sx || null) ||
          JSON.stringify(was.s3 || null) !== JSON.stringify(m.set.s3 || null);
        this.set = m.set;
        if (changedSound) this.synth.sound(m.set.sound, sx, s3);
        if (!was || was.tempo !== m.set.tempo) this.synth.tempo(m.set.tempo);
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
