// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: every factory chord, as the firmware plays and names it (build/host/sets_dump), must be what the
// editor plays and shows. build/host/sets_dump | node tests/host/sets_xcheck.mjs
import { readFileSync } from "node:fs";
import { loadPresets } from "../../web/editor/setcodec.js";
import { chordNotes, chordName } from "../../web/editor/chord.js";

const { sets } = loadPresets(JSON.parse(readFileSync(new URL("../../web/editor/presets.json", import.meta.url))));
let text = "", n = 0, bad = 0;
for await (const c of process.stdin) text += c;
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line), c = sets[r.set].chords[r.key];
  const notes = chordNotes(c, 0), name = chordName(c);
  if (name !== r.name || JSON.stringify(notes) !== JSON.stringify(r.notes))
    if (bad++ < 10) console.log(`FAIL ${sets[r.set].name} key ${r.key + 1}: firmware ${r.name} [${r.notes}] editor ${name} [${notes}]`);
  n++;
}
if (bad || n !== sets.length * 27) { console.log(`sets_xcheck: ${bad} of ${n} differ`); process.exit(1); }
console.log(`ok   sets_xcheck: all ${n} factory chords (${sets.length} sets) play and are named the same on the FM-1 and in the editor`);
