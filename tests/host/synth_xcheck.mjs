// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord host test: the editor's synth (web/editor/engine.js) against the firmware's (src/dsp/fc_synth.c), from
// synth_dump's levels: every factory sound and one with all of part 2 on, 50 ms at a time, within 2 %.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { readFileSync } from "node:fs";
import { Synth, defaultSx } from "../../web/editor/engine.js";
import { loadPresets } from "../../web/editor/setcodec.js";

const c = readFileSync(0, "utf8").trim().split("\n").map((l) => {
  const i = l.indexOf(":");
  return { name: l.slice(0, i), lv: l.slice(i + 1).trim().split(/\s+/).map(Number) };
});
const { sounds } = loadPresets(JSON.parse(readFileSync(new URL("../../web/editor/presets.json", import.meta.url))));

function play(o, x, bpm) {
  const s = new Synth(44100), n = 44100 * 5 / 2, L = new Float32Array(n), R = new Float32Array(n);
  s.sound(o, x); s.tempo(bpm);
  [45, 52, 55, 59, 60].forEach((nt, i) => s.on(nt, 100 - 10 * i));
  for (let i = 0; i < n; i += 128) {
    if (i === Math.floor(44100 * 3 / 2 / 128) * 128) for (const nt of [45, 52, 55, 59, 60]) s.off(nt);
    s.render(L, R, i, Math.min(128, n - i));
  }
  const out = [];
  for (let w = 0; w + 2205 <= n; w += 2205) {
    let l = 0, r = 0;
    for (let i = w; i < w + 2205; i++) { l += L[i] * L[i]; r += R[i] * R[i]; }
    out.push(Math.sqrt(l / 2205), Math.sqrt(r / 2205));
  }
  return out;
}
const x = defaultSx();
Object.assign(x, { flt_mode: 1, flt_slope: 1, drive: 70, lfo_wave: [1, 4], lfo_rate: [80, 100], lfo_sync: [0, 1],
  menv_a: 20, menv_d: 70, menv_s: 30, macro: [64, 100, 64, 64], dly_time: 7, dly_fb: 90, dly_mix: 40, dly_tone: 60,
  dly_mode: 1 });
x.mod = [[1, 2, 40], [3, 1, 30], [2, 6, 90], [4, 7, -50], [7, 13, 60], [2, 12, 50]].map(([src, dst, amt]) => ({ src, dst, amt }));
const everything = { ...sounds[3].sound, wave_a: 5, wave_b: 1 };
let bad = 0, worst = 0;
c.forEach((row, i) => {
  const js = i < sounds.length ? play(sounds[i].sound, sounds[i].sx, 140) : play(everything, x, 170);
  row.lv.forEach((v, j) => {
    const d = Math.abs(v - js[j]) / Math.max(v, 1e-3);
    if (v > 1e-3) worst = Math.max(worst, d);
    if (d > 0.02 && Math.abs(v - js[j]) > 2e-4) {
      if (bad++ < 10) console.log(`FAIL ${row.name}: window ${j >> 1} ${j & 1 ? "R" : "L"} firmware ${v} editor ${js[j].toFixed(5)}`);
    }
  });
});
if (bad) { console.log(`FAIL synth_xcheck: ${bad} windows differ`); process.exit(1); }
console.log(`ok   synth_xcheck: ${c.length} sounds, the editor's synth the same as the firmware's (worst ${(worst * 100).toFixed(2)} %)`);
