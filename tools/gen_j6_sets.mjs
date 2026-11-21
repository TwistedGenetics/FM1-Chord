#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: the J6 factory sets, from the Roland J-6's chord set list (tools/j6_chord_sets.txt), into
// web/editor/presets.json (the sets named "J6 …" are replaced; the others are kept).
//
// Each J-6 set's 12 chords sit on the FM-1's keys by note name: C4–B4 play them at the J-6's own pitch, F3–B3 an
// octave lower and C5–G5 an octave higher, so every C key plays the J-6's C chord and so on. The voicings are kept
// note for note: a chord becomes one of FM1-Chord's named chords when one of its inversions / voicings gives exactly
// those notes, otherwise exact notes ("custom", which FM1-Chord still names from its notes). Voice leading is off in
// these sets, so they play as the J-6 does.
//   node tools/gen_j6_sets.mjs            (prints a summary; --check: fail if any chord doesn't come out exact)
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { readFileSync, writeFileSync } from "node:fs";
import { chordNotes, chordName, formatChord, parseChord, QUALITIES, NQ_NAMED, NOBASS, Q_CUSTOM, NKEYS, KEY0_NOTE } from "../web/editor/chord.js";

const root = new URL("..", import.meta.url);
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(n) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error(`bad note ${n}`);
  return (+m[3] + 1) * 12 + PC[m[1]] + ({ "#": 1, b: -1, "": 0 })[m[2]];
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// the named chord (any root, inversion, voicing, slash bass, octave) that plays exactly these notes, if any
function exact(T) {
  const pcs = new Set(T.map((x) => x % 12));
  for (let k = 0; k < 12; k++) {                     // roots from the lowest note's pitch up, as FM1-Chord names chords
    const r = (T[0] + k) % 12;
    if (!pcs.has(r)) continue;
    for (const bass of [NOBASS, T[0] % 12]) {
      for (let q = 0; q < NQ_NAMED; q++) {
        const qp = new Set(QUALITIES[q].iv.map((x) => (x + r) % 12));
        const all = new Set(qp);
        if (bass !== NOBASS) { if (qp.has(bass)) continue; all.add(bass); }
        if (all.size !== pcs.size || [...all].some((x) => !pcs.has(x))) continue;
        for (let inv = 0; inv < 4; inv++)
          for (let v = 0; v < 5; v++)
            for (let o = -2; o <= 2; o++) {
              const c = { root: r, quality: q, custom: [0, 0, 0, 0], inversion: inv, voicing: v, bass, octave: o };
              if (same(chordNotes(c, 0), T)) return c;
            }
      }
    }
  }
  return null;
}
function custom(T) {
  const lo = T[0], r = lo % 12;
  let m = 0;
  for (const x of T) if (x - lo < 32) m |= 1 << (x - lo);
  const o = (lo - 48 - r) / 12;
  if (o < -2 || o > 2) return null;
  return { root: r, quality: Q_CUSTOM, custom: [m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff, (m >>> 24) & 0xff], inversion: 0,
    voicing: 0, bass: NOBASS, octave: o };
}

// short genre names where "J6 NN GENRE" would pass the 16 characters a set name has
const SHORT = { "Cinematic/Synthwave": "CINE/SYNTHWV", "Cinematic/House": "CINE/HOUSE", "New Age/Cinematic": "NEWAGE/CINE",
  "Synthwave/House": "SYNTHWV/HOUSE", "Gospel/R&B": "GOSPEL/R&B", "House/Techno": "HOUSE/TECHNO" };
// a sound and tempo per genre
function style(g) {
  const G = g.toLowerCase();
  if (/neo|soul|r&b|lofi|jazz|bossa|blues|funk|gospel/.test(G)) return ["LIQUID KEYS", /bossa/.test(G) ? 130 : /lofi/.test(G) ? 80 : 96];
  if (/house|techno|trance|edm/.test(G)) return [/techno|trance/.test(G) ? "RAVE STAB" : "GARAGE ORGAN", /trance/.test(G) ? 138 : 124];
  if (/cinematic|new age|classical|modern/.test(G)) return ["STRINGS", 90];
  if (/synthwave/.test(G)) return ["WARM PAD", 100];
  if (/stack/.test(G)) return ["DARK PAD", 120];
  return ["WARM PAD", 110];
}

const lines = readFileSync(new URL("tools/j6_chord_sets.txt", root), "utf8").split("\n").filter((l) => /^\d/.test(l));
const json = JSON.parse(readFileSync(new URL("web/editor/presets.json", root), "utf8"));
const sets = [];
let nExact = 0, nCustom = 0, bad = [], adjusted = [];
const KEY_NAMES = Array.from({ length: NKEYS }, (_, k) => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][(KEY0_NOTE + k) % 12] + (Math.floor((KEY0_NOTE + k) / 12) - 1));
for (const line of lines) {
  const [num, genre, rest] = line.split("|").map((x) => x.trim());
  const chords = rest.split(";").map((x) => x.trim());
  if (chords.length !== 12) throw new Error(`set ${num}: ${chords.length} chords`);
  const notes = chords.map((c) => c.slice(c.lastIndexOf(":") + 1).trim().split(/\s+/).map(midi).sort((a, b) => a - b));
  const out = [];
  for (let k = 0; k < NKEYS; k++) {
    const note = KEY0_NOTE + k, j = note % 12;
    let shift = note < 60 ? -12 : note >= 72 ? 12 : 0;
    let T = [...new Set(notes[j].map((x) => x + shift))].sort((a, b) => a - b);   // (a unison doubled in the list: once)
    if (T[0] < 24 || T[T.length - 1] > 108) { shift = 0; T = notes[j].slice(); }
    if (T[T.length - 1] - T[0] > 31) {                // wider than an exact-note chord holds: the bass up an octave
      const up = T[0] + 12;
      T = [...new Set([up, ...T.slice(1)])].sort((a, b) => a - b);
      adjusted.push(`J6 ${num} key ${k + 1} (${KEY_NAMES[k]}): the lowest note raised an octave`);
    }
    let c = exact(T);
    if (c) nExact++;
    else { c = custom(T); nCustom++; }
    const text = c ? formatChord(c) : "-";
    const back = c ? chordNotes(parseChord(text), 0) : [];
    if (!c || !same(back, T)) bad.push(`J6 ${num} key ${k + 1}: wanted ${T}, got ${back} (${text})`);
    out.push(text);
  }
  const short = SHORT[genre] || genre.toUpperCase();
  const name = `J6 ${num.padStart(2, "0")} ${short}`.slice(0, 16);
  const [sound, tempo] = style(genre);
  sets.push({ name, key: "C", scale: /min/i.test(genre) ? "minor" : "major", tempo, sound,
    play: { mode: "chord", strum: 0, strum_dir: "up", arp_rate: "1/16", arp_dir: "up", arp_oct: 1, arp_gate: 60, latch: 0,
      voice_lead: 0, humanise: 0, transpose: 0, octave: 0 }, chords: out, j6: +num });
}
json.sets = json.sets.filter((s) => !s.name.startsWith("J6 ")).concat(sets.map(({ j6, ...s }) => s));
writeFileSync(new URL("web/editor/presets.json", root), JSON.stringify(json, null, 1) + "\n");
console.log(`J6 sets: ${sets.length}; chords: ${nExact} as named chords, ${nCustom} as exact notes; ${bad.length} not exact; ${adjusted.length} adjusted`);
for (const a of adjusted) console.log("  " + a);
for (const b of bad.slice(0, 20)) console.log("  " + b);
if (process.argv.includes("--check") && bad.length) process.exit(1);
// a few names, to look at
for (const s of sets.slice(0, 3)) console.log(`  ${s.name}: ${s.chords.slice(7, 19).map((t) => chordName(parseChord(t))).join(" · ")}`);
