// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: harmony suggestions. Works in a key (set by hand or detected from the set's chords) and rates every
// candidate chord against the one selected:
//   GREEN "Strong": in the key and a common move from the selected chord, or sharing two or more notes with it
//   AMBER "OK":     works with care: borrowed from a parallel mode, a secondary dominant, the phrygian bII, or in
//                   the key but with little in common
//   RED   "Far":    far round the circle of fifths, few shared notes
// The dark jungle / DnB bias prefers minor 9ths and 11ths, sus chords, maj7 colours and phrygian moves.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { QUALITIES, NOTE_NAMES, NOBASS, isEmpty, pitchClasses, chordName, isBlack, NKEYS } from "./chord.js";
import { SCALES } from "./setcodec.js";

export const SCALE_STEPS = [
  [0, 2, 4, 5, 7, 9, 11],       // major
  [0, 2, 3, 5, 7, 8, 10],       // minor
  [0, 2, 3, 5, 7, 9, 10],       // dorian
  [0, 1, 3, 5, 7, 8, 10],       // phrygian
  [0, 2, 4, 6, 7, 9, 11],       // lydian
  [0, 2, 4, 5, 7, 9, 10],       // mixolydian
  [0, 1, 3, 5, 6, 8, 10],       // locrian
  [0, 2, 3, 5, 7, 8, 11],       // harmonic minor
  [0, 2, 3, 5, 7, 9, 11],       // melodic minor
];
export const SCALE_LABELS = ["Major", "Minor", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Locrian",
  "Harmonic minor", "Melodic minor"];
const MINORISH = new Set([1, 2, 3, 6, 7, 8]);
const Q = Object.fromEntries(QUALITIES.map((q, i) => [q.s === "" ? "maj" : q.s, i]));
const MINOR_Q = new Set([Q.m, Q.m7, Q.m9, Q.m11, Q.m6, Q.dim, Q.m7b5, Q.dim7]);
const DIM_Q = new Set([Q.dim, Q.m7b5, Q.dim7]);
const PLAIN = [Q.maj, Q.m, Q["7"], Q.maj7, Q.m7, Q.sus2, Q.sus4, Q.dim, Q.m9, Q.add9, Q["9"], Q.maj9, Q.m11, Q["6"],
  Q.m6, Q["7sus4"], Q.m7b5, Q.aug];
const JUNGLE = [Q.m9, Q.m11, Q.m7, Q.maj7, Q.maj9, Q.sus2, Q.sus4, Q["7sus4"], Q.add9, Q.m, Q.m6, Q.m7b5, Q["7"], Q.maj];
const JUNGLE_LIKES = new Set([Q.m9, Q.m11, Q.m7, Q.sus2, Q.sus4, Q["7sus4"], Q.maj7, Q.maj9, Q.add9]);
const JUNGLE_DISLIKES = new Set([Q.maj, Q.aug, Q["7"], Q["13"], Q["9"], Q["6"]]);

// common moves, as (selected chord's root, candidate's root) in semitones above the tonic
const COMMON_MAJOR = [[0, 5], [0, 7], [0, 9], [2, 7], [5, 7], [7, 0], [9, 5], [9, 2], [4, 9], [5, 0], [5, 2], [0, 2],
  [7, 9], [2, 5], [0, 4]];
const COMMON_MINOR = [[0, 5], [0, 8], [0, 10], [5, 7], [5, 0], [8, 10], [10, 0], [8, 5], [0, 7], [2, 7], [7, 0],
  [0, 3], [3, 8], [10, 3], [8, 7], [0, 1], [1, 0], [5, 8]];

const ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];
export function roman(c, keyRoot) {
  if (isEmpty(c)) return "";
  let r = ROMAN[(c.root - keyRoot + 12) % 12];
  if (MINOR_Q.has(c.quality)) r = r.replace(/[IV]+/, (m) => m.toLowerCase());
  if (DIM_Q.has(c.quality)) r += "°";
  return r;
}
export const keyLabel = (root, scale) => `${NOTE_NAMES[root]} ${SCALE_LABELS[scale].toLowerCase()}`;

const inScale = (pcs, root, scale) => pcs.every((p) => SCALE_STEPS[scale].includes((p - root + 12) % 12));
const fifthsSteps = (a, b) => { const k = ((b - a + 12) * 7) % 12; return Math.min(k, 12 - k); };

// the key the set's chords sit in best
export function detectKey(chords) {
  const cs = chords.filter((c) => !isEmpty(c));
  if (!cs.length) return { root: 0, scale: 1, score: 0 };
  let best = { root: 0, scale: 0, score: -1 };
  for (let root = 0; root < 12; root++)
    for (let scale = 0; scale < SCALE_STEPS.length; scale++) {
      const steps = SCALE_STEPS[scale];
      let score = 0;
      cs.forEach((c, i) => {
        const pcs = pitchClasses(c);
        score += pcs.filter((p) => steps.includes((p - root + 12) % 12)).length / pcs.length;
        if (c.root === root) {
          const minor = MINOR_Q.has(c.quality);
          if (minor === MINORISH.has(scale)) score += i === 0 ? 0.75 : 0.35;
        }
      });
      score += scale <= 1 ? 0.06 : scale <= 3 ? 0.03 : 0;          // the plain keys first when it's a tie
      if (score > best.score) best = { root, scale, score };
    }
  best.score = Math.min(1, best.score / (cs.length + 1));
  return best;
}

function parallelBorrow(pcs, root, scale) {
  const others = scale === 0 ? [1, 2, 3, 5] : MINORISH.has(scale) ? [0, 1, 2, 3, 5] : [0, 1];
  for (const o of others) if (o !== scale && inScale(pcs, root, o)) return o;
  return -1;
}

export const TIERS = [
  { id: "green", label: "Strong" },
  { id: "amber", label: "OK" },
  { id: "red", label: "Far" },
];

// rate one candidate against the selected chord (sel may be empty: then against the key's tonic)
export function rate(cand, sel, keyRoot, scale, bias) {
  const pcs = pitchClasses(cand);
  const ref = isEmpty(sel) ? { root: keyRoot, quality: MINORISH.has(scale) ? Q.m : Q.maj, custom: [0, 0, 0],
    inversion: 0, voicing: 0, bass: NOBASS, octave: 0 } : sel;
  const rpcs = pitchClasses(ref);
  const shared = pcs.filter((p) => rpcs.includes(p)).length;
  const diatonic = inScale(pcs, keyRoot, scale);
  const from = (ref.root - keyRoot + 12) % 12, to = (cand.root - keyRoot + 12) % 12;
  const common = (MINORISH.has(scale) ? COMMON_MINOR : COMMON_MAJOR).some(([a, b]) => a === from && b === to);
  const fall = (cand.root - ref.root + 12) % 12;
  const fd = fifthsSteps(keyRoot, cand.root);
  const borrowed = !diatonic ? parallelBorrow(pcs, keyRoot, scale) : -1;
  const isDom = cand.quality === Q["7"] || cand.quality === Q.maj || cand.quality === Q["9"];
  const secTarget = (cand.root + 5) % 12;            // the chord it resolves to, a fifth below
  const secondary = !diatonic && isDom && SCALE_STEPS[scale].includes((secTarget - keyRoot + 12) % 12);
  const phrygianII = to === 1 && MINORISH.has(scale) && !MINOR_Q.has(cand.quality) && cand.quality !== Q.aug;
  const why = [];
  let s = 0;
  if (diatonic) { s += 3; why.push(`in ${keyLabel(keyRoot, scale)}: ${roman(cand, keyRoot)}`); }
  if (common && !isEmpty(sel)) { s += 2; why.push(`a common move ${roman(ref, keyRoot)} → ${roman(cand, keyRoot)}`); }
  if (shared) { s += 0.6 * Math.min(shared, 4); why.push(`shares ${shared} note${shared > 1 ? "s" : ""}`); }
  if (!isEmpty(sel) && fall === 5) { s += 1.2; why.push("root falls a fifth"); }
  else if (!isEmpty(sel) && fall === 7) s += 0.5;
  if (phrygianII) { s += bias ? 2.5 : 1.5; why.push("the phrygian bII"); }
  else if (borrowed >= 0) { s += 1.2; why.push(`borrowed from ${keyLabel(keyRoot, borrowed)}`); }
  if (secondary) { s += 1.2; why.push(`secondary dominant (V of ${roman({ ...cand, root: secTarget, quality: Q.maj }, keyRoot)})`); }
  if (fd > 2) { s -= 0.4 * (fd - 2); if (!diatonic) why.push(`${fd} steps round the circle of fifths`); }
  if (bias) {
    if (JUNGLE_LIKES.has(cand.quality)) s += 0.8;
    if (JUNGLE_DISLIKES.has(cand.quality)) s -= 0.8;
  }
  let tier;
  if ((diatonic && (common || shared >= 2)) || (bias && phrygianII)) tier = 0;
  else if (diatonic || borrowed >= 0 || secondary || phrygianII || shared >= 2) tier = 1;
  else tier = 2;
  return { chord: cand, name: chordName(cand), roman: roman(cand, keyRoot), tier, score: s, why, shared };
}

// the suggestions for a selected chord: up to `max`, the strongest first, at most two qualities per root
export function suggest(sel, keyRoot, scale, { bias = false, max = 24, far = 6 } = {}) {
  const quals = bias ? JUNGLE : PLAIN;
  const all = [];
  for (let root = 0; root < 12; root++)
    for (const q of quals) {
      const c = { root, quality: q, custom: [0, 0, 0], inversion: 0, voicing: 0, bass: NOBASS, octave: 0 };
      if (!isEmpty(sel) && sel.root === root && sel.quality === q) continue;
      all.push(rate(c, sel, keyRoot, scale, bias));
    }
  all.sort((a, b) => a.tier - b.tier || b.score - a.score);
  const perRoot = new Map(), out = [], reds = [];
  for (const r of all) {                             // the "Far" ones keep their places at the end
    const k = `${r.tier}:${r.chord.root}`;
    if ((perRoot.get(k) || 0) >= 2) continue;
    if (r.tier === 2) { if (reds.length < far) { reds.push(r); perRoot.set(k, (perRoot.get(k) || 0) + 1); } continue; }
    if (out.length >= max - Math.min(far, max)) continue;
    perRoot.set(k, (perRoot.get(k) || 0) + 1);
    out.push(r);
  }
  return [...out, ...reds];
}

// a seeded pick among the best few: the same press gives the same chord, the next press the next one
function pick(list, n) { return list.length ? list[n % Math.min(3, list.length)] : null; }

export function suggestNext(sel, keyRoot, scale, { bias = false, nth = 0, avoid = [] } = {}) {
  const greens = suggest(sel, keyRoot, scale, { bias, max: 40, far: 0 })
    .filter((r) => r.tier === 0 && !avoid.includes(r.name));
  return pick(greens, nth) || pick(suggest(sel, keyRoot, scale, { bias, max: 40, far: 0 }), nth);
}

// fill the set: white keys walk a chain of strong moves, black keys take colour chords (OK). Only empty keys unless
// all is set. Returns the new chords array.
export function fillSet(chords, keyRoot, scale, { bias = false, all = false, seed = 0 } = {}) {
  const out = chords.map((c) => ({ ...c, custom: [...c.custom] }));
  const used = new Set(out.filter((c) => !isEmpty(c) && !all).map(chordName));
  let prev = out.find((c) => !isEmpty(c) && !all) || null;
  if (!prev) {
    const q = MINORISH.has(scale) ? (bias ? Q.m9 : Q.m) : (bias ? Q.maj7 : Q.maj);
    prev = { root: keyRoot, quality: q, custom: [0, 0, 0], inversion: 0, voicing: 0, bass: NOBASS, octave: 0 };
  }
  let n = seed;
  for (let k = 0; k < NKEYS; k++) {
    if (!all && !isEmpty(out[k])) { if (!isBlack(k)) prev = out[k]; continue; }
    if (k === 0 && (all || isEmpty(chords[0])) && !used.has(chordName(prev))) {
      out[k] = { ...prev, custom: [0, 0, 0] };
      used.add(chordName(prev));
      continue;
    }
    let r;
    if (isBlack(k)) {
      const ambers = suggest(prev, keyRoot, scale, { bias, max: 40, far: 0 }).filter((x) => x.tier === 1 && !used.has(x.name));
      r = ambers[n % Math.max(1, Math.min(4, ambers.length))] || null;
    } else {
      r = suggestNext(prev, keyRoot, scale, { bias, nth: n, avoid: [...used] });
    }
    n++;
    if (!r) continue;
    const c = { ...r.chord, custom: [0, 0, 0] };
    if (k >= 19 && c.root < 5) c.octave = 1;          // the top of the keyboard a little higher
    out[k] = c;
    used.add(r.name);
    if (!isBlack(k)) prev = c;
  }
  return out;
}

export { SCALES };
