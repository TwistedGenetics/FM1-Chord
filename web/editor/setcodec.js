// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: chord sets in the editor, and the 384 bytes the FM-1 stores and sends (src/core/fc_set.h; offsets in
// docs/FORMAT.md). Also the factory content (presets.json) and the 7-bit packing the SysEx frames use.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { NKEYS, EMPTY, NOBASS, Q_CUSTOM, NQ_NAMED, emptyChord, parseChord } from "./chord.js";

export const SET_BYTES = 384, SET_BYTES_V1 = 336, SET_BYTES_V2 = 376;
export const SOUND_FIELDS = ["type", "wave_a", "wave_b", "detune", "b_level", "sub", "fm", "cutoff", "res", "fenv",
  "ftrack", "amp_a", "amp_d", "amp_s", "amp_r", "flt_a", "flt_d", "flt_s", "flt_r", "chorus", "rev_mix", "rev_size",
  "level", "vel_sens"];
export const PLAY_FIELDS = ["mode", "strum", "strum_dir", "arp_rate", "arp_dir", "arp_oct", "arp_gate", "latch",
  "voice_lead", "humanise", "transpose", "octave", "swing"];
export const WAVES = ["saw", "square", "tri", "sine", "organ", "pulse", "supersaw", "noise", "wt vox", "wt pwm",
  "wt digi", "wt glass"];
export const SCALES = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonic minor",
  "melodic minor"];
export const MODES = ["chord", "strum", "arp"];
export const RATES = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];
export const STRUM_DIRS = ["up", "down", "alt"];
export const ARP_DIRS = ["up", "down", "updown", "random"];
const DIRS = { up: 0, down: 1, alt: 2, updown: 2, random: 3 };
// the sound's part 2 (0.6, fc_sound2_t): names as presets.json writes them, in storage order
export const FMODES = ["lp", "bp", "hp", "notch"];
export const LWAVES = ["sine", "tri", "saw", "square", "s&h"];
export const MSRC = ["none", "lfo1", "lfo2", "menv", "velocity", "key", "macro1", "macro2", "macro3", "macro4"];
export const MDST = ["none", "pitch", "cutoff", "resonance", "osc b", "fm", "pulse width", "amp", "detune", "sub",
  "drive", "filter env", "lfo1 rate", "delay mix", "reverb mix", "chorus", "wt position", "spread", "osc b pitch"];
// part 3 (0.7, fc_sound3_t)
export const OMODES = ["add", "sync", "ring"];
export const CMODES = ["I", "II", "I+II"];
export function defaultS3() {
  return { wt_pos: 0, spread: 50, osc_mode: 0, b_semi: 0, crush_bits: 0, crush_rate: 0, wobble: 0, chorus_mode: 0, phaser: 0 };
}
export function s3Bytes(t) {
  return [t.wt_pos, t.spread, t.osc_mode, t.b_semi & 0xff, t.crush_bits, t.crush_rate, t.wobble,
    ((t.chorus_mode & 3) << 6) | (t.phaser & 63)].map((v) => (v | 0) & 0xff);
}
export function s3FromBytes(b, o = 0) {
  const c = (v, hi) => Math.min(v, hi), cm = b[o + 7] >> 6;
  return { wt_pos: c(b[o], 127), spread: c(b[o + 1], 127), osc_mode: c(b[o + 2], 2),
    b_semi: Math.max(-24, Math.min(24, s8(b[o + 3]))), crush_bits: c(b[o + 4], 127), crush_rate: c(b[o + 5], 127),
    wobble: c(b[o + 6], 127), chorus_mode: cm > 2 ? 0 : cm, phaser: b[o + 7] & 63 };
}
export function s3FromJSON(j) {
  const x = j.x || {};
  return { wt_pos: x.wt_pos || 0, spread: x.spread ?? 50, osc_mode: OMODES.indexOf(x.osc_mode || "add"),
    b_semi: x.b_semi || 0, crush_bits: x.crush_bits || 0, crush_rate: x.crush_rate || 0, wobble: x.wobble || 0,
    chorus_mode: CMODES.indexOf(x.chorus_mode || "I"), phaser: x.phaser || 0 };
}
export const DIVS = ["1/32", "1/16T", "1/16", "1/8T", "1/16D", "1/8", "1/4T", "1/8D", "1/4", "1/4D", "1/2", "1 bar",
  "2 bars", "4 bars", "8 bars"];
export const DIV_BEATS = [0.125, 1 / 6, 0.25, 1 / 3, 0.375, 0.5, 2 / 3, 0.75, 1, 1.5, 2, 4, 8, 16, 32];
export const NMOD = 6, NMACRO = 4, DLY_MAX = 11;   // the delay's longest: 1 bar

const s8 = (b) => (b > 127 ? b - 256 : b);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));

export function defaultSound() {
  return { type: 0, wave_a: 0, wave_b: 0, detune: 18, b_level: 100, sub: 20, fm: 0, cutoff: 70, res: 20, fenv: 25,
    ftrack: 40, amp_a: 70, amp_d: 80, amp_s: 110, amp_r: 85, flt_a: 75, flt_d: 90, flt_s: 60, flt_r: 85,
    chorus: 70, rev_mix: 45, rev_size: 90, level: 100, vel_sens: 40 };
}
export function defaultSx() {                    // fc_sound2_default: nothing moving, no delay
  return { flt_mode: 0, flt_slope: 0, drive: 0, lfo_wave: [0, 0], lfo_rate: [64, 40], lfo_sync: [0, 0],
    menv_a: 40, menv_d: 80, menv_s: 0, menv_r: 70,
    mod: Array.from({ length: NMOD }, () => ({ src: 0, dst: 0, amt: 0 })), macro: [64, 64, 64, 64],
    dly_time: 7, dly_fb: 50, dly_mix: 0, dly_tone: 80, dly_mode: 0 };
}
export function ensureSx(s) {                       // sets saved before 0.6 (part 2) and 0.7 (part 3)
  if (s && !s.sx) s.sx = defaultSx();
  if (s && !s.s3) s.s3 = defaultS3();
  return s;
}
export function defaultPlay() {
  return { mode: 0, strum: 15, strum_dir: 0, arp_rate: 3, arp_dir: 0, arp_oct: 1, arp_gate: 60, latch: 0,
    voice_lead: 0, humanise: 0, transpose: 0, octave: 0, swing: 50 };
}
export function newSet(name = "NEW SET") {
  return { name: name.slice(0, 16), keyRoot: 0, keyScale: 1, tempo: 120, flags: 0, sound: defaultSound(),
    sx: defaultSx(), s3: defaultS3(), play: defaultPlay(), chords: Array.from({ length: NKEYS }, emptyChord) };
}
export const cloneSet = (s) => JSON.parse(JSON.stringify(s));

export function encodeSet(s) {
  const b = new Uint8Array(SET_BYTES);
  b[0] = 70; b[1] = 67; b[2] = 3; b[3] = NKEYS;                                   // "FC", version, keys
  const nm = String(s.name || "").replace(/[^\x20-\x7e]/g, "?").slice(0, 16);
  for (let i = 0; i < nm.length; i++) b[4 + i] = nm.charCodeAt(i);
  b[20] = s.keyRoot % 12; b[21] = s.keyScale; b[22] = clamp(s.tempo, 40, 250); b[23] = s.flags & 0xff;
  SOUND_FIELDS.forEach((f, i) => { b[24 + i] = clamp(s.sound[f], 0, 127); });
  PLAY_FIELDS.forEach((f, i) => { b[48 + i] = (s.play[f] | 0) & 0xff; });
  for (let k = 0; k < NKEYS; k++) {
    const c = s.chords[k], o = 64 + 10 * k;
    if (!c || c.quality === EMPTY) { b[o] = 0; b[o + 1] = EMPTY; b[o + 7] = NOBASS; continue; }
    b[o] = c.root % 12; b[o + 1] = c.quality;
    b[o + 2] = c.custom[0] & 0xff; b[o + 3] = c.custom[1] & 0xff; b[o + 4] = c.custom[2] & 0xff;
    b[o + 5] = c.inversion; b[o + 6] = c.voicing; b[o + 7] = c.bass; b[o + 8] = c.octave & 0xff;
    b[o + 9] = c.quality === Q_CUSTOM ? (c.custom[3] | 0) & 0xff : 0;
  }
  sxBytes(s.sx || defaultSx()).forEach((v, i) => { b[336 + i] = v; });
  s3Bytes(s.s3 || defaultS3()).forEach((v, i) => { b[376 + i] = v; });
  return b;
}
export function sxBytes(x) {
  const b = [x.flt_mode, x.flt_slope, x.drive, ...x.lfo_wave, ...x.lfo_rate, ...x.lfo_sync,
    x.menv_a, x.menv_d, x.menv_s, x.menv_r];
  for (let i = 0; i < NMOD; i++) { const m = x.mod[i] || { src: 0, dst: 0, amt: 0 }; b.push(m.src, m.dst, m.amt & 0xff); }
  b.push(...x.macro, x.dly_time, x.dly_fb, x.dly_mix, x.dly_tone, x.dly_mode);
  return b.map((v) => (v | 0) & 0xff);
}
// what fc_set_check does to part 2's values
export function sxFromBytes(b, o = 0) {
  const c = (v, hi) => Math.min(v, hi);
  const x = { flt_mode: c(b[o], 3), flt_slope: b[o + 1] ? 1 : 0, drive: c(b[o + 2], 127),
    lfo_wave: [c(b[o + 3], 4), c(b[o + 4], 4)], lfo_rate: [c(b[o + 5], 127), c(b[o + 6], 127)],
    lfo_sync: [b[o + 7] ? 1 : 0, b[o + 8] ? 1 : 0], menv_a: c(b[o + 9], 127), menv_d: c(b[o + 10], 127),
    menv_s: c(b[o + 11], 127), menv_r: c(b[o + 12], 127), mod: [], macro: [], dly_time: c(b[o + 35], DLY_MAX),
    dly_fb: c(b[o + 36], 127), dly_mix: c(b[o + 37], 127), dly_tone: c(b[o + 38], 127), dly_mode: b[o + 39] ? 1 : 0 };
  for (let i = 0; i < NMOD; i++) {
    let src = b[o + 13 + 3 * i], dst = b[o + 14 + 3 * i];
    const amt = Math.max(-127, s8(b[o + 15 + 3 * i]));
    if (src >= MSRC.length || dst >= MDST.length) src = dst = 0;
    x.mod.push({ src, dst, amt });
  }
  for (let i = 0; i < NMACRO; i++) x.macro.push(c(b[o + 31 + i], 127));
  return x;
}

export function decodeSet(b) {
  if (b.length < SET_BYTES_V1 || b[0] !== 70 || b[1] !== 67 || !b[2] || b[2] > 3 || b[3] !== NKEYS) return null;
  if ((b[2] === 2 && b.length < SET_BYTES_V2) || (b[2] === 3 && b.length < SET_BYTES)) return null;
  let name = "";
  for (let i = 0; i < 16 && b[4 + i]; i++) name += String.fromCharCode(b[4 + i] & 0x7f);
  const s = { name: name.trimEnd(), keyRoot: b[20] % 12, keyScale: Math.min(b[21], SCALES.length - 1),
    tempo: clamp(b[22], 40, 250), flags: b[23], sound: {}, play: {}, chords: [] };
  SOUND_FIELDS.forEach((f, i) => { s.sound[f] = b[24 + i]; });
  s.sound.wave_a = Math.min(s.sound.wave_a, WAVES.length - 1);
  s.sound.wave_b = Math.min(s.sound.wave_b, WAVES.length - 1);
  PLAY_FIELDS.forEach((f, i) => { s.play[f] = f === "transpose" || f === "octave" ? s8(b[48 + i]) : b[48 + i]; });
  for (let k = 0; k < NKEYS; k++) {
    const o = 64 + 10 * k;
    let q = b[o + 1];
    if (q !== EMPTY && q !== Q_CUSTOM && q >= NQ_NAMED) q = EMPTY;
    if (q === Q_CUSTOM && !(b[o + 2] | b[o + 3] | b[o + 4] | b[o + 9])) q = EMPTY;
    if (q === EMPTY) { s.chords.push(emptyChord()); continue; }
    s.chords.push({ root: b[o] % 12, quality: q, custom: [b[o + 2], b[o + 3], b[o + 4], b[o + 9]], inversion: Math.min(b[o + 5], 3),
      voicing: Math.min(b[o + 6], 4), bass: b[o + 7] === NOBASS ? NOBASS : b[o + 7] % 12,
      octave: clamp(s8(b[o + 8]), -2, 2) });
  }
  s.sx = b[2] >= 2 ? sxFromBytes(b, 336) : defaultSx();          // a version 1 set: part 2's defaults
  s.s3 = b[2] >= 3 ? s3FromBytes(b, 376) : defaultS3();
  return s;
}

// presets.json -> sound list and set objects (the same bytes tools/gen_presets.py builds for the firmware)
export function soundFromJSON(j, idx) {
  const s = {};
  for (const f of SOUND_FIELDS) s[f] = f === "type" ? idx : f.startsWith("wave") ? WAVES.indexOf(j[f]) : j[f];
  return s;
}
// a sound's "x" (all optional; tools/gen_presets.py reads the same) -> part 2
export function sxFromJSON(j) {
  const x = j.x || {}, d = defaultSx();
  const l1 = { wave: "sine", rate: 64, sync: 0, ...(x.lfo1 || {}) }, l2 = { wave: "sine", rate: 40, sync: 0, ...(x.lfo2 || {}) };
  const dl = { time: "1/8D", fb: 50, mix: 0, tone: 80, mode: "stereo", ...(x.delay || {}) };
  const menv = x.menv || [40, 80, 0, 70];
  return { flt_mode: FMODES.indexOf(x.filter || "lp"), flt_slope: (x.slope || 12) === 24 ? 1 : 0, drive: x.drive || 0,
    lfo_wave: [LWAVES.indexOf(l1.wave), LWAVES.indexOf(l2.wave)], lfo_rate: [l1.rate, l2.rate], lfo_sync: [l1.sync, l2.sync],
    menv_a: menv[0], menv_d: menv[1], menv_s: menv[2], menv_r: menv[3],
    mod: d.mod.map((m, i) => (x.mod && x.mod[i] ? { src: MSRC.indexOf(x.mod[i][0]), dst: MDST.indexOf(x.mod[i][1]), amt: x.mod[i][2] } : m)),
    macro: x.macros ? [...x.macros] : d.macro, dly_time: DIVS.indexOf(dl.time), dly_fb: dl.fb, dly_mix: dl.mix,
    dly_tone: dl.tone, dly_mode: dl.mode === "pingpong" ? 1 : 0 };
}
export function setFromJSON(j, sounds) {
  const si = sounds.findIndex((x) => x.name === j.sound);
  const p = j.play;
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const m = /^([A-G])([#b]?)/.exec(j.key);
  return {
    name: j.name.slice(0, 16), keyRoot: (PC[m[1]] + ({ "#": 1, b: -1, "": 0 })[m[2]] + 12) % 12,
    keyScale: SCALES.indexOf(j.scale), tempo: j.tempo, flags: 0, sound: { ...sounds[si].sound },
    sx: structuredClone(sounds[si].sx), s3: { ...sounds[si].s3 },
    play: { mode: MODES.indexOf(p.mode), strum: p.strum, strum_dir: DIRS[p.strum_dir], arp_rate: RATES.indexOf(p.arp_rate),
      arp_dir: DIRS[p.arp_dir], arp_oct: p.arp_oct, arp_gate: p.arp_gate, latch: p.latch, voice_lead: p.voice_lead,
      humanise: p.humanise, transpose: p.transpose, octave: p.octave, swing: 50 },
    chords: j.chords.map(parseChord),
  };
}
export function loadPresets(json) {
  const sounds = json.sounds.map((j, i) => ({ name: j.name, file: j.file, sound: soundFromJSON(j, i), sx: sxFromJSON(j),
    s3: s3FromJSON(j) }));
  const sets = json.sets.map((j) => setFromJSON(j, sounds));
  return { sounds, sets };
}

// 7-bit packing (Felucca's editor frames): a byte of high bits, then up to seven 7-bit bytes
export function pack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 7) {
    let m = 0;
    const n = Math.min(7, bytes.length - i);
    for (let j = 0; j < n; j++) m |= (bytes[i + j] >> 7) << j;
    out.push(m);
    for (let j = 0; j < n; j++) out.push(bytes[i + j] & 0x7f);
  }
  return out;
}
export function unpack7(a, max = Infinity) {
  const out = [];
  let i = 0;
  while (i < a.length && out.length < max) {
    const m = a[i++];
    for (let j = 0; j < 7 && i < a.length && out.length < max; j++) out.push(a[i++] | (((m >> j) & 1) << 7));
  }
  return Uint8Array.from(out);
}

// a set as a file (.chordset): JSON with the bytes too, so either reads back
export function setToFile(s) {
  return JSON.stringify({ format: "fm1-chord-set", version: 1, set: s,
    bytes: Array.from(encodeSet(s)).map((x) => x.toString(16).padStart(2, "0")).join("") }, null, 1);
}
export function setFromFile(text) {
  const j = JSON.parse(text);
  if (j.format !== "fm1-chord-set") throw new Error("not an FM1-Chord set file");
  if (j.bytes) {
    const b = Uint8Array.from(j.bytes.match(/../g).map((h) => parseInt(h, 16)));
    const s = decodeSet(b);
    if (s) return s;
  }
  return ensureSx(j.set);
}
