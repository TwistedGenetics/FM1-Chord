// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: chord theory for the editor — src/core/fc_chord.c line for line, so the editor plays and shows what the
// FM-1 plays (tests/host/chord_xcheck.mjs checks every quality x inversion x voicing x bass x octave against the C).
// Copyright (C) 2026 Jamie (TwistedGenetics).

export const NKEYS = 27;
export const KEY0_NOTE = 53;          // F3
export const MAXN = 8;
export const EMPTY = 0xff;
export const NOBASS = 0xff;
export const Q_CUSTOM = 31;

// the order of fc_chord.h's FC_Q_* (the storage format)
export const QUALITIES = [
  { s: "", name: "maj", iv: [0, 4, 7] },
  { s: "m", name: "min", iv: [0, 3, 7] },
  { s: "7", name: "7", iv: [0, 4, 7, 10] },
  { s: "maj7", name: "maj7", iv: [0, 4, 7, 11] },
  { s: "m7", name: "m7", iv: [0, 3, 7, 10] },
  { s: "9", name: "9", iv: [0, 4, 7, 10, 14] },
  { s: "m9", name: "m9", iv: [0, 3, 7, 10, 14] },
  { s: "11", name: "11", iv: [0, 4, 7, 10, 14, 17] },
  { s: "13", name: "13", iv: [0, 4, 7, 10, 14, 21] },
  { s: "sus2", name: "sus2", iv: [0, 2, 7] },
  { s: "sus4", name: "sus4", iv: [0, 5, 7] },
  { s: "dim", name: "dim", iv: [0, 3, 6] },
  { s: "aug", name: "aug", iv: [0, 4, 8] },
  { s: "add9", name: "add9", iv: [0, 4, 7, 14] },
  { s: "6", name: "6", iv: [0, 4, 7, 9] },
  { s: "m6", name: "m6", iv: [0, 3, 7, 9] },
  { s: "5", name: "power", iv: [0, 7, 12] },
  { s: "m11", name: "m11", iv: [0, 3, 7, 10, 14, 17] },
  { s: "m7b5", name: "m7b5", iv: [0, 3, 6, 10] },
  { s: "dim7", name: "dim7", iv: [0, 3, 6, 9] },
  { s: "maj9", name: "maj9", iv: [0, 4, 7, 11, 14] },
  { s: "7sus4", name: "7sus4", iv: [0, 5, 7, 10] },
  { s: "7#9", name: "7#9", iv: [0, 4, 7, 10, 15] },          // 0.3
  { s: "7b9", name: "7b9", iv: [0, 4, 7, 10, 13] },
  { s: "7#5", name: "7#5", iv: [0, 4, 8, 10] },
  { s: "mmaj7", name: "m(maj7)", iv: [0, 3, 7, 11] },
  { s: "maj7#11", name: "maj7#11", iv: [0, 4, 7, 11, 18] },
  { s: "7#11", name: "7#11", iv: [0, 4, 7, 10, 18] },
  { s: "m13", name: "m13", iv: [0, 3, 7, 10, 14, 21] },
  { s: "69", name: "6/9", iv: [0, 4, 7, 9, 14] },
];
export const NQ_NAMED = QUALITIES.length;
export const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const VOICINGS = ["close", "open", "drop2", "drop3", "spread"];
export const VOICING_LABELS = ["Close", "Open", "Drop 2", "Drop 3", "Spread"];
export const INVERSION_LABELS = ["Root", "1st", "2nd", "3rd"];
const ALIASES = { maj: "", min: "m", M7: "maj7", "-": "m", "-7": "m7", "ø": "m7b5", o: "dim", o7: "dim7", "+": "aug",
  "6/9": "69", sus: "sus4", power: "5", aug7: "7#5", "m(maj7)": "mmaj7" };

export const emptyChord = () => ({ root: 0, quality: EMPTY, custom: [0, 0, 0], inversion: 0, voicing: 0, bass: NOBASS,
  octave: 0 });
export const isEmpty = (c) => !c || c.quality === EMPTY;

export function noteName(pc) { return NOTE_NAMES[((pc % 12) + 12) % 12]; }
export function midiName(n) { return noteName(n) + (Math.floor(n / 12) - 1); }

export function tones(c) {
  if (c.quality === Q_CUSTOM) {
    const m = (c.custom[0] | (c.custom[1] << 8) | (c.custom[2] << 16) | ((c.custom[3] | 0) << 24)) >>> 0, iv = [];
    for (let i = 0; i < 32 && iv.length < MAXN - 1; i++) if ((m >>> i) & 1) iv.push(i);
    return iv;
  }
  if (c.quality >= NQ_NAMED) return [];
  return QUALITIES[c.quality].iv.slice();
}

const asc = (a, b) => a - b;

function voice(t, v) {
  const n = t.length;
  switch (v) {
    case 1: if (n >= 3) for (let i = 1; i < n; i += 2) t[i] += 12; break;          // open
    case 2: if (n >= 3) t[n - 2] -= 12; break;                                     // drop 2
    case 3: if (n >= 4) t[n - 3] -= 12; else if (n === 3) t[1] -= 12; break;        // drop 3
    case 4: if (n >= 2) { t[0] -= 12; for (let i = 2; i < n; i += 2) t[i] += 12; } break;   // spread
    default: break;
  }
  t.sort(asc);
}

function clampShift(lo, hi, t) {
  let s = 0;
  const n = t.length;
  while (n && t[0] + s < lo) s += 12;
  while (n && t[n - 1] + s > hi && t[0] + s - 12 >= lo) s -= 12;
  return s;
}

// fc_chord_notes: MIDI notes ascending, the slash bass first
export function chordNotes(c, shift = 0) {
  if (isEmpty(c)) return [];
  const iv = tones(c);
  if (!iv.length) return [];
  const t = iv.slice();
  const n = t.length;
  const inv = Math.min(c.inversion, n - 1);
  for (let i = 0; i < inv; i++) { t[0] += 12; t.sort(asc); }
  voice(t, c.voicing);
  const base = 48 + (c.root % 12) + 12 * c.octave + shift;
  for (let i = 0; i < n; i++) t[i] += base;
  const s = clampShift(24, 108, t);
  for (let i = 0; i < n; i++) t[i] += s;
  const out = [];
  if (c.bass < 12) {
    let b = t[0] - ((((t[0] - c.bass) % 12) + 12) % 12);
    if (b === t[0]) b -= 12;
    if (b < 12) b += 12;
    out.push(b);
  }
  for (let i = 0; i < n && out.length < MAXN; i++) out.push(Math.max(0, Math.min(127, t[i])));
  return out;
}

function leadCost(a, b) {
  let cost = 0;
  for (const x of a) { let best = 1000; for (const y of b) best = Math.min(best, Math.abs(x - y)); cost += best; }
  for (const y of b) { let best = 1000; for (const x of a) best = Math.min(best, Math.abs(x - y)); cost += best; }
  return cost;
}

// fc_voice_lead: notes moved (by octaves and inversions, as a whole) nearest to prev (upper notes); returns new array
export function voiceLead(prev, prevBass, notes, hasBass) {
  const off = hasBass ? 1 : 0;
  if (!prev.length || notes.length <= off) return notes.slice();
  const nu = notes.length - off;
  const t = notes.slice(off);
  let best = t.slice(), bestc = 0x7fffffff, bestd = 0;
  const center0 = t.reduce((a, b) => a + b, 0);
  for (let r = 0; r < nu; r++) {
    for (let k = -3; k <= 3; k++) {
      const cand = t.map((x) => x + 12 * k);
      if (cand[0] < 36 || cand[nu - 1] > 96) continue;
      const c = leadCost(cand, prev);
      const d = Math.abs(cand.reduce((a, b) => a + b, 0) - center0);
      if (c < bestc || (c === bestc && d < bestd)) { bestc = c; bestd = d; best = cand; }
    }
    t[0] += 12;
    t.sort(asc);
  }
  best = best.slice().sort(asc);
  if (!off) return best;
  const pc = notes[0] % 12, lo = best[0];
  let b = lo - ((((lo - pc) % 12) + 12) % 12);
  if (b === lo) b -= 12;
  let bb = b;
  if (prevBass >= 0) {
    const c1 = Math.abs(b - prevBass), c2 = Math.abs(b - 12 - prevBass);
    if (c2 < c1 && b - 12 >= 24) bb = b - 12;
  }
  return [bb < 12 ? bb + 12 : bb, ...best];
}

export function qualitySuffix(q) {
  if (q === Q_CUSTOM) return "*";
  return q < NQ_NAMED ? QUALITIES[q].s : "?";
}

// the named chord the notes come nearest (fc_chord.c guess): every note a chord tone, the fewest tones missing (a
// missing 5th counts 1, any other 2; at most 2); roots from the lowest note's pitch upwards; the earlier quality on a tie
function guess(nt) {
  let have = 0, best = 3, out = null;
  for (const x of nt) have |= 1 << (x % 12);
  const low = nt[0] % 12;
  for (let k = 0; k < 12; k++) {
    const r = (low + k) % 12;
    if (!(have & (1 << r))) continue;
    for (let q = 0; q < NQ_NAMED; q++) {
      const qm = pcMask(QUALITIES[q].iv, r);
      if (have & ~qm) continue;
      const miss = qm & ~have;
      let cost = 0;
      const big = QUALITIES[q].iv.length >= 5;
      for (let b = 0; b < 12; b++) if (miss & (1 << b)) { const d = (b + 12 - r) % 12; cost += d === 7 || (big && (d === 2 || d === 5)) ? 1 : 2; }
      if (cost < best) { best = cost; out = { root: r, q }; }
    }
  }
  return best <= 2 ? out : null;
}

// a custom chord is named from its notes (fc_chord.c custom_name)
function customName(c) {
  const nt = chordNotes(c, 0);
  const out = { root: c.root % 12, q: Q_CUSTOM, bass: NOBASS };
  if (!nt.length) return out;
  if (nt.every((x) => x % 12 === nt[0] % 12)) return { root: nt[0] % 12, q: EMPTY, bass: NOBASS };
  const g = guess(nt) || (nt.length > 2 ? guess(nt.slice(1)) : null);
  if (!g) return out;
  return { root: g.root, q: g.q, bass: nt[0] % 12 !== g.root ? nt[0] % 12 : NOBASS };
}

// fc_chord_name: "Cm9/G"
export function chordName(c) {
  if (isEmpty(c)) return "";
  let root = c.root % 12, q = c.quality, bass = c.bass;
  if (q === Q_CUSTOM) ({ root, q, bass } = customName(c));
  let s = noteName(root) + (q === EMPTY ? "" : qualitySuffix(q));
  if (bass < 12 && bass !== root) s += "/" + noteName(bass);
  return s;
}

function pcMask(iv, root) { let m = 0; for (const x of iv) m |= 1 << ((x + root) % 12); return m; }

function place(c, low) {
  let best = 0, bd = 1000;
  for (let o = -2; o <= 2; o++) {
    c.octave = o;
    const t = chordNotes(c, 0);
    if (!t.length) return;
    const d = Math.abs(t[0] - low);
    if (d < bd) { bd = d; best = o; }
  }
  c.octave = best;
}

// fc_chord_identify (LEARN): notes played -> a chord
export function identify(notes) {
  if (!notes.length) return null;
  const s = notes.slice(0, 16).sort(asc);
  const low = s[0];
  let have = 0;
  for (const x of s) have |= 1 << (x % 12);
  const c = { root: 0, quality: 0, custom: [0, 0, 0], inversion: 0, voicing: 0, bass: NOBASS, octave: 0 };
  for (let k = 0; k < 12; k++) {
    const r = (low + k) % 12;
    if (!(have & (1 << r))) continue;
    for (let q = 0; q < NQ_NAMED; q++) {
      const iv = QUALITIES[q].iv;
      if (pcMask(iv, r) !== have) continue;
      let inv = 0;
      for (let i = 0; i < iv.length; i++) if ((iv[i] + r) % 12 === low % 12) { inv = i; break; }
      c.root = r;
      c.quality = q;
      if (inv <= 3) c.inversion = inv;
      else { c.inversion = 0; c.bass = low % 12; }
      place(c, c.bass < 12 ? low + 12 : low);
      return c;
    }
  }
  let m = 0;
  for (const x of s) if (x - low < 32) m |= 1 << (x - low);
  c.root = low % 12;
  c.quality = Q_CUSTOM;
  c.custom = [m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff, (m >>> 24) & 0xff];
  place(c, low);
  return c;
}

// ---- the text form presets.json uses (tools/gen_presets.py parses the same) ----
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitch(s) {
  const m = /^([A-G])([#b]?)/.exec(s);
  if (!m) throw new Error(`no note in "${s}"`);
  return [((PC[m[1]] + ({ "#": 1, b: -1, "": 0 })[m[2]]) + 12) % 12, m[0].length];
}
export function parseChord(text) {
  text = String(text || "").trim();
  if (text === "" || text === "-") return emptyChord();
  const words = text.split(/\s+/);
  const sym = words[0];
  const [root, k] = pitch(sym);
  let tail = sym.slice(k), bass = NOBASS;
  const cm = /^\*([0-9.]+)(?:\/(.+))?$/.exec(tail);     // custom notes: "C*0.3.7.14" (semitones above the root)
  if (cm) {
    let m = 0;
    for (const x of cm[1].split(".")) { const v = +x; if (!(v >= 0 && v < 32)) throw new Error(`bad custom note in "${text}"`); m |= 1 << v; }
    const c = { root, quality: Q_CUSTOM, custom: [m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff, (m >>> 24) & 0xff], inversion: 0, voicing: 0,
      bass: cm[2] ? pitch(cm[2])[0] : NOBASS, octave: 0 };
    for (const w of words.slice(1)) {
      if (/^[+-][0-2]$/.test(w)) c.octave = +w;
      else throw new Error(`unknown word "${w}" in "${text}"`);
    }
    return c;
  }
  if (tail.includes("/")) {
    const i = tail.lastIndexOf("/");
    const b = tail.slice(i + 1);
    tail = tail.slice(0, i);
    const [pb, kb] = pitch(b);
    if (kb !== b.length) throw new Error(`bad bass in "${text}"`);
    bass = pb;
  }
  if (tail in ALIASES) tail = ALIASES[tail];
  const q = QUALITIES.findIndex((x) => x.s === tail);
  if (q < 0) throw new Error(`unknown chord quality "${tail}" in "${text}"`);
  const c = { root, quality: q, custom: [0, 0, 0], inversion: 0, voicing: 0, bass, octave: 0 };
  for (const w of words.slice(1)) {
    if (/^i[0-3]$/.test(w)) c.inversion = +w[1];
    else if (VOICINGS.includes(w)) c.voicing = VOICINGS.indexOf(w);
    else if (/^[+-][0-2]$/.test(w)) c.octave = +w;
    else throw new Error(`unknown word "${w}" in "${text}"`);
  }
  return c;
}
export function formatChord(c) {
  if (isEmpty(c)) return "-";
  if (c.quality === Q_CUSTOM) {
    const w = [noteName(c.root) + "*" + tones(c).join(".") + (c.bass < 12 ? "/" + noteName(c.bass) : "")];
    if (c.octave) w.push((c.octave > 0 ? "+" : "") + c.octave);
    return w.join(" ");
  }
  const w = [chordName(c)];
  if (c.inversion) w.push("i" + c.inversion);
  if (c.voicing) w.push(VOICINGS[c.voicing]);
  if (c.octave) w.push((c.octave > 0 ? "+" : "") + c.octave);
  return w.join(" ");
}

// the pitch classes a chord holds (for the harmony suggestions)
export function pitchClasses(c) {
  if (isEmpty(c)) return [];
  const set = new Set(tones(c).map((x) => (x + c.root) % 12));
  if (c.bass < 12) set.add(c.bass);
  return [...set];
}

// the keys: white or black, and the note name of key k
export const isBlack = (k) => [1, 3, 6, 8, 10].includes((KEY0_NOTE + k) % 12);
export const keyName = (k) => midiName(KEY0_NOTE + k);
