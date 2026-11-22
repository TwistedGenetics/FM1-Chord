// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord host test: the FM-1's harmony tiers (src/core/fc_harmony.c) against the editor's (harmony.js rate()).
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { readFileSync } from "node:fs";
import { rate } from "../../web/editor/harmony.js";
import { loadPresets } from "../../web/editor/setcodec.js";
import { emptyChord, NOBASS, isEmpty } from "../../web/editor/chord.js";

const { sets } = loadPresets(JSON.parse(readFileSync(new URL("../../web/editor/presets.json", import.meta.url))));
const mk = (root, quality, bass = NOBASS) => ({ root, quality, custom: [0, 0, 0, 0], inversion: 0, voicing: 0, bass, octave: 0 });
const prev = [emptyChord(), mk(5, 6), mk(1, 3), mk(7, 2, 11), mk(2, 18), mk(10, 10)];
let n = 0, bad = 0;
for (const line of readFileSync(0, "utf8").trim().split("\n")) {
  const f = line.split(" ");
  if (f[0] === "G") {
    const [p, key, sc, b] = f.slice(1, 5).map(Number), got = f[5];
    let i = 0;
    for (let r = 0; r < 12; r++)
      for (let q = 0; q < 30; q++, i++) {
        const t = rate(mk(r, q), prev[p], key, sc, !!b).tier;
        n++;
        if (String(t) !== got[i] && bad++ < 8) console.log(`FAIL root ${r} q ${q} after ${p} in ${key}/${sc} bias ${b}: FM-1 ${got[i]} editor ${t}`);
      }
  } else {
    const s = sets[+f[1]], got = f[2];
    for (let j = 0; j < 27; j++) {
      let pv = null;
      for (let m = j - 1; m >= 0; m--) if (!isEmpty(s.chords[m])) { pv = s.chords[m]; break; }
      const want = isEmpty(s.chords[j]) || !pv ? "-" : String(rate(s.chords[j], pv, s.keyRoot, s.keyScale, true).tier);
      n++;
      if (want !== got[j] && bad++ < 8) console.log(`FAIL set ${s.name} key ${j}: FM-1 ${got[j]} editor ${want}`);
    }
  }
}
if (bad) { console.log(`FAIL harmony_xcheck: ${bad} of ${n} differ`); process.exit(1); }
console.log(`ok   harmony_xcheck: ${n} ratings, the FM-1's red / amber / green the same as the editor's`);
