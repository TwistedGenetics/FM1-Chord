// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: the editor's chord.js against the firmware's fc_chord.c. Reads `chord_test dump` (JSON lines) on stdin:
// every chord's notes and name, and a voice-led chain, must come out the same in JavaScript.
//   build/host/chord_test dump | node tests/host/chord_xcheck.mjs
import { chordNotes, chordName, voiceLead, NOBASS, Q_CUSTOM } from "../../web/editor/chord.js";

let text = "";
for await (const chunk of process.stdin) text += chunk;
let n = 0, bad = 0, prev = [], prevBass = -1;
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if ("lead" in r) {
    const c = { root: r.root, quality: r.q, custom: [0, 0, 0], inversion: 0, voicing: 0, bass: r.bass, octave: 0 };
    let notes = chordNotes(c, 0);
    const hb = c.bass < 12;
    if (prev.length) notes = voiceLead(prev, prevBass, notes, hb);
    if (JSON.stringify(notes) !== JSON.stringify(r.notes)) {
      if (bad++ < 10) console.log(`FAIL voice leading step ${r.lead}: C ${r.notes} JS ${notes}`);
    }
    prev = notes.slice(hb ? 1 : 0);
    prevBass = hb ? notes[0] : -1;
    n++;
    continue;
  }
  const c = { root: r.root, quality: r.q, custom: r.q === Q_CUSTOM ? [0x89, 0x44, 0x02] : [0, 0, 0], inversion: r.inv,
    voicing: r.v, bass: r.bass === 255 ? NOBASS : r.bass, octave: r.oct };
  const notes = chordNotes(c, 3), name = chordName(c);
  if (JSON.stringify(notes) !== JSON.stringify(r.notes) || name !== r.name) {
    if (bad++ < 10) console.log(`FAIL ${JSON.stringify(r)}: JS ${name} [${notes}]`);
  }
  n++;
}
if (bad || n < 1000) {
  console.log(`chord_xcheck: ${bad} of ${n} differ`);
  process.exit(1);
}
console.log(`ok   chord_xcheck: ${n} chords and a voice-led chain, the editor's chord.js the same as the firmware's`);
