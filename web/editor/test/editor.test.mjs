// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord editor tests (node --test): the preview engine plays as the firmware's player does, the suggestions
// colour as described, fill / next work, progressions export a valid MIDI file, the demo FM-1 round-trips a set.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, Player, Synth } from "../engine.js";
import { parseChord, chordName, isEmpty, NKEYS } from "../chord.js";
import { loadPresets, encodeSet } from "../setcodec.js";
import { suggest, suggestNext, fillSet, detectKey, rate } from "../harmony.js";
import { toMidiFile, render } from "../progression.js";
import { Device } from "../device.js";
import { mockFM1 } from "../mock-fm1.js";

const { sets } = loadPresets(JSON.parse(readFileSync(new URL("../presets.json", import.meta.url))));
const set = JSON.parse(JSON.stringify(sets[0]));

function recorder() {
  const ev = [];
  let t = 0;
  return { ev, tick: (n) => (t += n), out: { on: (n, v) => ev.push({ t, n, on: 1, v }), off: (n) => ev.push({ t, n, on: 0 }) } };
}

test("player: chord, strum timing, arp steps, latch (as fc_play.c)", () => {
  const s = JSON.parse(JSON.stringify(set));
  s.play.voice_lead = 0; s.play.humanise = 0;
  let r = recorder(), p = new Player(r.out, 44100);
  p.keyEvent(s, 0, 100);
  assert.equal(r.ev.filter((e) => e.on).length, 5);           // Fm9
  p.keyEvent(s, 0, 0);
  assert.equal(r.ev.filter((e) => !e.on).length, 5);
  s.play.mode = 1; s.play.strum = 30;
  r = recorder(); p = new Player(r.out, 44100);
  p.keyEvent(s, 0, 100);
  for (let i = 0; i < 200; i++) { p.run(s, 128, false); r.tick(128); }
  const ons = r.ev.filter((e) => e.on);
  assert.equal(ons.length, 5);
  assert.ok(ons[1].t - ons[0].t >= 2500 && ons[1].t - ons[0].t <= 2700);
  s.play.mode = 2; s.play.arp_rate = 3; s.tempo = 120; s.play.arp_gate = 50;
  r = recorder(); p = new Player(r.out, 44100);
  p.keyEvent(s, 0, 100);
  for (let t = 0; t < 44100; t += 128) { p.run(s, 128, false); r.tick(128); }
  const n = r.ev.filter((e) => e.on).length;
  assert.ok(n === 8 || n === 9, `arp steps ${n}`);
  s.play.mode = 0; s.play.latch = 1;
  r = recorder(); p = new Player(r.out, 44100);
  p.keyEvent(s, 2, 100); p.keyEvent(s, 2, 0);
  assert.equal(p.key, 2);
  p.keyEvent(s, 2, 100);
  assert.equal(p.key, -1);
});

test("synth: sound for every factory set, silence after release", () => {
  for (const st of sets) {
    const e = new Engine(48000);
    e.message({ type: "set", set: st });
    e.message({ type: "key", key: 0, vel: 100 });
    const L = new Float32Array(128), R = new Float32Array(128);
    let peak = 0;
    for (let i = 0; i < 100; i++) { e.process(L, R, 128); for (const x of L) peak = Math.max(peak, Math.abs(x)); }
    assert.ok(peak > 0.02 && peak <= 1, `${st.name} peak ${peak}`);
    assert.ok(!Number.isNaN(L[0]));
    e.message({ type: "key", key: 0, vel: 0 });
    for (let i = 0; i < 48000 * 20 / 128; i++) e.process(L, R, 128);
    assert.equal(e.synth.active(), 0, st.name);
  }
  assert.ok(new Synth(44100));
});

test("suggestions: the three colours, labelled, with reasons", () => {
  const sel = parseChord("Fm9");
  const list = suggest(sel, 5, 1, { bias: true });
  const tiers = new Set(list.map((x) => x.tier));
  assert.deepEqual([...tiers].sort(), [0, 1, 2]);
  assert.ok(list.every((x) => x.why.length || x.tier === 2));
  // Bbm9 (iv) in F minor from Fm9: strong; Gbmaj7 (phrygian bII) with the jungle bias: strong; without: OK
  assert.equal(rate(parseChord("Bbm9"), sel, 5, 1, false).tier, 0);
  assert.equal(rate(parseChord("Gbmaj7"), sel, 5, 1, true).tier, 0);
  assert.equal(rate(parseChord("Gbmaj7"), sel, 5, 1, false).tier, 1);
  // C7 is the harmonic minor's V: OK (secondary / borrowed); B major far away
  assert.equal(rate(parseChord("C7"), sel, 5, 1, false).tier, 1);
  assert.equal(rate(parseChord("Bmaj7"), sel, 5, 1, false).tier, 2);
  const nx = suggestNext(sel, 5, 1, { bias: true });
  assert.equal(nx.tier, 0);
});

test("key detection and filling a set", () => {
  const d = detectKey(sets[0].chords);
  assert.equal(d.root, 5);                                   // F (minor or a minor mode)
  const empty = Array.from({ length: NKEYS }, () => parseChord("-"));
  empty[0] = parseChord("Am9");
  const f = fillSet(empty, 9, 1, { bias: true });
  assert.ok(f.every((c) => !isEmpty(c)), "every key filled");
  assert.equal(chordName(f[0]), "Am9");
  assert.equal(new Set(f.map(chordName)).size, NKEYS, "no chord twice");
});

test("progression: phrases and a MIDI file", () => {
  const prog = { steps: [{ key: 0, beats: 4 }, { key: 7, beats: 2 }, { key: 9, beats: 2 }], phrase: 2 };
  const { events, beats } = render(sets[0], prog);
  assert.equal(beats, 8);
  assert.equal(events.length, 8);                            // quarters: 4 + 2 + 2
  const mid = toMidiFile(sets[0], prog);
  assert.equal(String.fromCharCode(...mid.slice(0, 4)), "MThd");
  assert.equal(String.fromCharCode(...mid.slice(14, 18)), "MTrk");
  const len = (mid[18] << 24) | (mid[19] << 16) | (mid[20] << 8) | mid[21];
  assert.equal(len, mid.length - 22);
  assert.deepEqual([...mid.slice(-4)], [0, 0xff, 0x2f, 0]);
});

test("device protocol against the demo FM-1", async () => {
  const m = mockFM1(sets);
  const d = new Device();
  const info = await d.connect(m.access);
  assert.match(info.name, /FM1-Chord/);
  assert.equal(info.nuser, 20);
  await d.putSet(3, sets[2]);
  const names = await d.names();
  assert.equal(names[3].name, sets[2].name);
  const back = await d.getSet(3);
  assert.deepEqual([...encodeSet(back)], [...encodeSet(sets[2])]);
  await d.select(3);
  assert.equal((await d.getInfo()).cur, 3);
});
