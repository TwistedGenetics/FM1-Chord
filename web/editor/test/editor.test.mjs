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
    if (st.play.latch) e.message({ type: "key", key: 0, vel: 100 });   // latched: the same key again stops it
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

test("live sync: editor edits reach the FM-1, the FM-1's panel reaches the editor", async () => {
  const { LiveSync, EVT } = await import("../live.js");
  const m = mockFM1(sets);
  const dev = new Device();
  await dev.connect(m.access);
  const live = new LiveSync(dev, { delay: 10 });
  const got = [];
  live.onremote = (e) => got.push(e);
  // opening a factory set selects it on the FM-1
  live.open(sets[3], 128 + 3);
  await live.idle();
  assert.equal(m.cur, 131);
  // a burst of edits: only the newest has to land, and it does
  const s = structuredClone(sets[3]);
  for (let i = 0; i < 5; i++) { s.play.octave = i - 2; live.edit(s); }
  await new Promise((r) => setTimeout(r, 60));
  await live.idle();
  assert.equal(m.working.play.octave, 2);
  // the FM-1's panel: load a set, edit it, save it
  m.panel.load(128 + 7);
  await new Promise((r) => setTimeout(r, 60)); await live.idle();
  assert.equal(got.at(-1).kind, EVT.LOADED);
  assert.equal(got.at(-1).cur, 135);
  assert.equal(got.at(-1).set.name, sets[7].name);
  m.panel.edit((x) => { x.name = "EDITED ON FM1"; });
  await new Promise((r) => setTimeout(r, 60)); await live.idle();
  assert.equal(got.at(-1).kind, EVT.EDITED);
  assert.equal(got.at(-1).set.name, "EDITED ON FM1");
  m.panel.save(4);
  await new Promise((r) => setTimeout(r, 60)); await live.idle();
  assert.equal(got.at(-1).kind, EVT.SAVED);
  assert.equal(got.at(-1).cur, 4);
  assert.equal(m.user[4] !== null, true);
  // off: nothing goes out
  live.on = false;
  s.play.octave = -3; live.edit(s);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.working.name, "EDITED ON FM1");
});

test("paste chords: lenient symbols, named sets, merged repeats, unreadable reported", async () => {
  const { readChordText, readChord } = await import("../chordtext.js");
  const name = (t) => chordName(readChord(t));
  assert.equal(name("CΔ7"), "Cmaj7"); assert.equal(name("C-7"), "Cm7"); assert.equal(name("F#ø"), "F#m7b5");
  assert.equal(name("G7(b9)"), "G7b9"); assert.equal(name("Bb7sus"), "Bb7sus4"); assert.equal(name("Em/D"), "Em/D");
  assert.equal(name("E♭6/9"), chordName(parseChord("Eb69"))); assert.equal(name("C°7"), "Cdim7"); assert.equal(name("Dm7-5"), "Dm7b5");
  assert.equal(readChord("Chorus"), null); assert.equal(readChord("At"), null);
  const sets = readChordText("Intro: Fm9 | Dbmaj7 | Ebsus4 | Cm7\n\nVerse\nAm F C G Am F C G\nDm Zz7\n\nnot chords at all here");
  assert.deepEqual(sets.map((s) => s.name), ["INTRO", "VERSE"]);
  assert.equal(sets[0].chords.length, 4);
  assert.deepEqual(sets[1].chords.map(chordName), ["Am", "F", "C", "G", "Dm"]);
  assert.equal(sets[1].merged, 4);
  assert.deepEqual(sets[1].bad, ["Zz7"]);
});

test("expand a progression: rows of the same chords, then chords that fit; only empty keys", async () => {
  const { expandSet, EXPAND_ROWS } = await import("../harmony.js");
  const ch = Array.from({ length: NKEYS }, () => parseChord("-"));
  ["Am", "F", "C", "G"].forEach((t, i) => (ch[i] = parseChord(t)));
  const k = detectKey(ch);
  const r = expandSet(ch, k.root, k.scale);
  assert.equal(r.chords.filter((c) => !isEmpty(c)).length, NKEYS);
  assert.deepEqual(r.chords.slice(0, 4).map(chordName), ["Am", "F", "C", "G"]);
  assert.deepEqual(r.chords.slice(4, 8).map(chordName), ["Am7", "Fmaj7", "Cmaj7", "Gadd9"]);   // richer, in the key
  assert.deepEqual(r.chords.slice(16, 20).map(chordName), ["Am/E", "F/C", "C/E", "G/B"]);       // a walking bass
  assert.equal(r.made.filter((m) => m.row === EXPAND_ROWS[0]).length, 4);
  assert.ok(r.made.some((m) => m.row === "new"));
  for (const c of r.chords) assert.ok(encodeSet({ ...sets[0], chords: r.chords }).length > 0 && !isEmpty(c));
});
