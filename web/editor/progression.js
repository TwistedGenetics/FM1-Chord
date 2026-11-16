// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: progressions and J-6-style rhythm phrases, and their export as a Standard MIDI File.
// A progression is a list of steps {key, beats}; a phrase is a rhythm of chord hits over one bar of 16 steps, played
// through each step's span. Copyright (C) 2026 Jamie (TwistedGenetics).
import { chordNotes, voiceLead, isEmpty } from "./chord.js";

// [start, length] in 16ths over one bar
export const PHRASES = [
  { name: "Hold", hits: [[0, 16]] },
  { name: "Halves", hits: [[0, 7], [8, 7]] },
  { name: "Quarters", hits: [[0, 3], [4, 3], [8, 3], [12, 3]] },
  { name: "Offbeat skank", hits: [[2, 1], [6, 1], [10, 1], [14, 1]] },
  { name: "Two-step stabs", hits: [[0, 3], [10, 2]] },
  { name: "Jungle stabs", hits: [[0, 1], [3, 1], [6, 2], [10, 1], [14, 2]] },
  { name: "Garage shuffle", hits: [[0, 2], [3, 1], [6, 2], [10, 1], [13, 2]] },
  { name: "Rave 8ths", hits: [[0, 1], [2, 1], [4, 1], [6, 1], [8, 1], [10, 1], [12, 1], [14, 1]] },
  { name: "Liquid push", hits: [[0, 6], [6, 2], [8, 8]] },
  { name: "Charleston", hits: [[0, 3], [6, 4]] },
  { name: "Dotted 8ths", hits: [[0, 2], [3, 2], [6, 2], [9, 2], [12, 2]] },
  { name: "Reggae chop", hits: [[4, 1], [12, 1]] },
];

// the progression as timed notes: [{t (beats), len (beats), notes, key}], the set's transpose, octave and voice
// leading applied as the FM-1 would
export function render(set, prog) {
  const out = [];
  const phrase = PHRASES[prog.phrase] || PHRASES[0];
  let t = 0, prev = [], prevBass = -1;
  const spans = [];
  for (const st of prog.steps) {                     // each step's chord, voice-led from the one before
    const c = set.chords[st.key];
    const span = Math.max(0.25, st.beats);
    let notes = [];
    if (!isEmpty(c)) {
      notes = chordNotes(c, set.play.transpose + 12 * set.play.octave);
      const hb = notes.length && c.bass < 12 ? 1 : 0;
      if (set.play.voice_lead && prev.length) notes = voiceLead(prev, prevBass, notes, hb);
      prev = notes.slice(hb);
      prevBass = hb ? notes[0] : -1;
    }
    spans.push({ t0: t, t1: t + span, notes, key: st.key });
    t += span;
  }
  // the phrase runs on the bar grid from the start; a hit plays the chord of the step it falls in, and a chord change
  // in the middle of a hit starts the new chord there
  for (let bar = 0; bar * 4 < t; bar++)
    for (const [s16, l16] of phrase.hits) {
      const hs = bar * 4 + s16 / 4, he = hs + l16 / 4;
      for (const sp of spans) {
        const a = Math.max(hs, sp.t0), b = Math.min(he, sp.t1);
        if (b - a > 1e-9 && sp.notes.length) out.push({ t: a, len: b - a, notes: sp.notes, key: sp.key });
      }
    }
  out.sort((x, y) => x.t - y.t);
  return { events: out, beats: t };
}

// ---- Standard MIDI File, format 0 ----
function vlq(n) {
  const b = [n & 0x7f];
  while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80);
  return b;
}
export function toMidiFile(set, prog, { ppq = 96, channel = 0, velocity = 100 } = {}) {
  const { events } = render(set, prog);
  const ev = [];
  for (const e of events)
    for (const n of e.notes) {
      ev.push({ tick: Math.round(e.t * ppq), on: 1, n });
      ev.push({ tick: Math.round((e.t + e.len) * ppq) - 1, on: 0, n });
    }
  ev.sort((a, b) => a.tick - b.tick || a.on - b.on);
  const tr = [];
  const usPerQ = Math.round(60000000 / Math.max(40, set.tempo));
  tr.push(0, 0xff, 0x51, 3, (usPerQ >> 16) & 0xff, (usPerQ >> 8) & 0xff, usPerQ & 0xff);
  tr.push(0, 0xff, 0x58, 4, 4, 2, 24, 8);
  const name = Array.from(new TextEncoder().encode(`FM1-Chord ${set.name}`));
  tr.push(0, 0xff, 0x03, ...vlq(name.length), ...name);
  let last = 0;
  for (const e of ev) {
    tr.push(...vlq(Math.max(0, e.tick - last)));
    last = Math.max(last, e.tick);
    tr.push((e.on ? 0x90 : 0x80) | channel, e.n & 0x7f, e.on ? velocity : 0);
  }
  tr.push(0, 0xff, 0x2f, 0);
  const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const len = tr.length;
  return Uint8Array.from([...hdr, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff,
    len & 0xff, ...tr]);
}
