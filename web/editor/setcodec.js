// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: chord sets in the editor, and the 336 bytes the FM-1 stores and sends (src/core/fc_set.h; offsets in
// docs/FORMAT.md). Also the factory content (presets.json) and the 7-bit packing the SysEx frames use.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { NKEYS, EMPTY, NOBASS, Q_CUSTOM, NQ_NAMED, emptyChord, parseChord } from "./chord.js";

export const SET_BYTES = 336;
export const SOUND_FIELDS = ["type", "wave_a", "wave_b", "detune", "b_level", "sub", "fm", "cutoff", "res", "fenv",
  "ftrack", "amp_a", "amp_d", "amp_s", "amp_r", "flt_a", "flt_d", "flt_s", "flt_r", "chorus", "rev_mix", "rev_size",
  "level", "vel_sens"];
export const PLAY_FIELDS = ["mode", "strum", "strum_dir", "arp_rate", "arp_dir", "arp_oct", "arp_gate", "latch",
  "voice_lead", "humanise", "transpose", "octave", "swing"];
export const WAVES = ["saw", "square", "tri", "sine", "organ", "pulse"];
export const SCALES = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonic minor",
  "melodic minor"];
export const MODES = ["chord", "strum", "arp"];
export const RATES = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];
export const STRUM_DIRS = ["up", "down", "alt"];
export const ARP_DIRS = ["up", "down", "updown", "random"];
const DIRS = { up: 0, down: 1, alt: 2, updown: 2, random: 3 };

const s8 = (b) => (b > 127 ? b - 256 : b);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));

export function defaultSound() {
  return { type: 0, wave_a: 0, wave_b: 0, detune: 18, b_level: 100, sub: 20, fm: 0, cutoff: 70, res: 20, fenv: 25,
    ftrack: 40, amp_a: 70, amp_d: 80, amp_s: 110, amp_r: 85, flt_a: 75, flt_d: 90, flt_s: 60, flt_r: 85,
    chorus: 70, rev_mix: 45, rev_size: 90, level: 100, vel_sens: 40 };
}
export function defaultPlay() {
  return { mode: 0, strum: 15, strum_dir: 0, arp_rate: 3, arp_dir: 0, arp_oct: 1, arp_gate: 60, latch: 0,
    voice_lead: 0, humanise: 0, transpose: 0, octave: 0, swing: 50 };
}
export function newSet(name = "NEW SET") {
  return { name: name.slice(0, 16), keyRoot: 0, keyScale: 1, tempo: 120, flags: 0, sound: defaultSound(),
    play: defaultPlay(), chords: Array.from({ length: NKEYS }, emptyChord) };
}
export const cloneSet = (s) => JSON.parse(JSON.stringify(s));

export function encodeSet(s) {
  const b = new Uint8Array(SET_BYTES);
  b[0] = 70; b[1] = 67; b[2] = 1; b[3] = NKEYS;                                   // "FC", version, keys
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
  }
  return b;
}

export function decodeSet(b) {
  if (b.length < SET_BYTES || b[0] !== 70 || b[1] !== 67 || !b[2] || b[2] > 1 || b[3] !== NKEYS) return null;
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
    if (q === EMPTY) { s.chords.push(emptyChord()); continue; }
    s.chords.push({ root: b[o] % 12, quality: q, custom: [b[o + 2], b[o + 3], b[o + 4]], inversion: Math.min(b[o + 5], 3),
      voicing: Math.min(b[o + 6], 4), bass: b[o + 7] === NOBASS ? NOBASS : b[o + 7] % 12,
      octave: clamp(s8(b[o + 8]), -2, 2) });
  }
  return s;
}

// presets.json -> sound list and set objects (the same bytes tools/gen_presets.py builds for the firmware)
export function soundFromJSON(j, idx) {
  const s = {};
  for (const f of SOUND_FIELDS) s[f] = f === "type" ? idx : f.startsWith("wave") ? WAVES.indexOf(j[f]) : j[f];
  return s;
}
export function setFromJSON(j, sounds) {
  const si = sounds.findIndex((x) => x.name === j.sound);
  const p = j.play;
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const m = /^([A-G])([#b]?)/.exec(j.key);
  return {
    name: j.name.slice(0, 16), keyRoot: (PC[m[1]] + ({ "#": 1, b: -1, "": 0 })[m[2]] + 12) % 12,
    keyScale: SCALES.indexOf(j.scale), tempo: j.tempo, flags: 0, sound: { ...sounds[si].sound },
    play: { mode: MODES.indexOf(p.mode), strum: p.strum, strum_dir: DIRS[p.strum_dir], arp_rate: RATES.indexOf(p.arp_rate),
      arp_dir: DIRS[p.arp_dir], arp_oct: p.arp_oct, arp_gate: p.arp_gate, latch: p.latch, voice_lead: p.voice_lead,
      humanise: p.humanise, transpose: p.transpose, octave: p.octave, swing: 50 },
    chords: j.chords.map(parseChord),
  };
}
export function loadPresets(json) {
  const sounds = json.sounds.map((j, i) => ({ name: j.name, file: j.file, sound: soundFromJSON(j, i) }));
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
  return j.set;
}
