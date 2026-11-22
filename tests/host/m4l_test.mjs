// SPDX-License-Identifier: GPL-3.0-only
// The Max for Live device's code (build/m4l/fm1chord.js, from tools/gen_m4l.mjs) run with Max's v8 globals faked:
// it must load, play every set's keys exactly as the editor's own player does, pass other notes through, follow the
// panel, and let every note go.
//   node tests/host/m4l_test.mjs DIR     (DIR holds fm1chord.js)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Player } from "../../web/editor/engine.js";
import { loadPresets, cloneSet, bankToFile, setToFile } from "../../web/editor/setcodec.js";
import { KEY0_NOTE, NKEYS } from "../../web/editor/chord.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = process.argv[2];
const src = readFileSync(join(dir, "fm1chord.js"), "utf8");
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log("FAIL", what); } };

const FILES = new Map();                  // Max's File, over a fake disk
class File {
  constructor(path) { this.text = FILES.get(path); this.isopen = this.text !== undefined; this.position = 0;
    this.eof = this.isopen ? this.text.length : 0; }
  readstring(n) { const r = this.text.slice(this.position, this.position + n); this.position += r.length; return r; }
  close() {}
}
function device() {
  const out = [], shown = {}, posts = [];
  const ctx = {
    outlet: (i, a) => { if (i === 0) out.push(a.slice()); else shown[a[0]] = a.slice(1).join(" "); },
    post: (s) => posts.push(s),
    arrayfromargs: (a) => Array.from(a),
    messagename: "",
    console, File, notified: 0,
  };
  ctx.notifyclients = () => ctx.notified++;
  vm.createContext(ctx);
  vm.runInContext(src + "\n;this.__api = { note, tick, tempo, setnum, panic, loadbang, anything, inlets, outlets, read, getvalueof, setvalueof };", ctx);
  const api = ctx.__api;
  const msg = (name, ...a) => { ctx.messagename = name; api.anything(...a); };
  return { api, out, shown, posts, msg, ctx };
}

// 1. it loads, with two outlets and every set
const d = device();
check(d.api.inlets === 1 && d.api.outlets === 2, "inlets/outlets");
d.api.loadbang();
check(/^1\. /.test(d.shown.name || ""), `name shown: ${d.shown.name}`);
check(/118 factory sets/.test(d.shown.info || ""), `info: ${d.shown.info}`);

// 2. every key of every set in chord mode, voice leading on, plays what the editor's player plays
const lib = loadPresets(JSON.parse(readFileSync(join(ROOT, "web/editor/presets.json"), "utf8")));
let compared = 0;
for (let si = 0; si < lib.sets.length; si++) {
  const dev = device();
  dev.api.loadbang();
  dev.api.setnum(si + 1);
  const ref = [], set = cloneSet(lib.sets[si]);
  Object.assign(set.play, { mode: 0, latch: 0, voice_lead: 1, octave: 0, transpose: 0, strum: 15, strum_dir: 0,
    arp_rate: 3, arp_dir: 0, arp_oct: 1, arp_gate: 60, humanise: 0 });
  set.tempo = 120;
  const p = new Player({ on: (n, v) => ref.push([n, v]), off: (n) => ref.push([n, 0]) }, 1000);
  for (const k of [0, 4, 9, 13, 26, 2]) {
    dev.api.note(KEY0_NOTE + k, 100); p.keyEvent(set, k, 100);
    dev.api.tick(5); p.run(set, 5, false);
    dev.api.note(KEY0_NOTE + k, 0); p.keyEvent(set, k, 0);
    dev.api.tick(5); p.run(set, 5, false);
  }
  check(JSON.stringify(dev.out) === JSON.stringify(ref), `set ${si + 1}: notes differ from the editor's player`);
  compared += ref.length;
}

// 3. notes outside the 27 keys pass through untouched
const t = device(); t.api.loadbang();
t.api.note(KEY0_NOTE - 1, 90); t.api.note(KEY0_NOTE + NKEYS, 80); t.api.note(KEY0_NOTE + NKEYS, 0);
check(JSON.stringify(t.out) === JSON.stringify([[KEY0_NOTE - 1, 90], [KEY0_NOTE + NKEYS, 80], [KEY0_NOTE + NKEYS, 0]]), "pass-through");

// 4. the panel: octave up moves the chord 12 up; strum spreads the notes; arp steps on the clock; base moves key 1
const o = device(); o.api.loadbang(); o.api.setnum(1);
o.api.note(KEY0_NOTE, 100); const a = o.out.filter((e) => e[1]).map((e) => e[0]); o.api.note(KEY0_NOTE, 0);
o.msg("vl", 0); o.msg("octave", 1); o.out.length = 0;
o.api.note(KEY0_NOTE, 100); const b = o.out.filter((e) => e[1]).map((e) => e[0]); o.api.note(KEY0_NOTE, 0);
check(a.length > 0 && b.length === a.length && b.every((n, i) => n === a[i] + 12), `octave: ${a} -> ${b}`);
o.msg("octave", 0); o.msg("mode", 1); o.msg("strum", 40); o.out.length = 0;
o.api.note(KEY0_NOTE, 100); const first = o.out.length;
for (let i = 0; i < 100; i++) o.api.tick(5);
check(first === 1 && o.out.filter((e) => e[1]).length === a.length, `strum: ${first} at once, ${o.out.length} after`);
o.api.note(KEY0_NOTE, 0);
o.msg("mode", 2); o.api.tempo(120); o.out.length = 0;
o.api.note(KEY0_NOTE, 100);
for (let i = 0; i < 200; i++) o.api.tick(5);  // 1 s at 1/16, 120 BPM: 8 steps
const steps = o.out.filter((e) => e[1]).length;
check(steps >= 8 && steps <= 9, `arp: ${steps} steps in 1 s`);
o.api.note(KEY0_NOTE, 0); for (let i = 0; i < 40; i++) o.api.tick(5);
o.msg("base", 60); o.msg("mode", 0); o.out.length = 0;
o.api.note(60, 100); check(o.out.length === a.length && o.out[0][0] !== 60, "base: key 1 moved to C4");
o.api.note(60, 0);

// 5. every note it starts, it stops; panic sends 128 note offs; an unknown message is reported, not thrown
const on = new Map();
for (const [n, v] of o.out) on.set(n, (on.get(n) || 0) + (v ? 1 : -1));
check([...on.values()].every((c) => c === 0), "a note left hanging");
o.out.length = 0; o.api.panic(); check(o.out.length === 128, "panic");
o.msg("nonsense", 1); check(o.posts.some((p) => /nonsense/.test(p)), "unknown message posted");

// 6. my sets: LOAD a bank, play it as the editor would, keep it in the Live set (pattr), switch banks, bad files
const mine = [5, 40, 77].map((i) => { const x = cloneSet(lib.sets[i]); x.name = "MY " + i; x.chords[0] = x.chords[3]; return x; });
FILES.set("Mac:/u/My.fm1bank", bankToFile(mine) + " ".repeat(40000));   // longer than one readstring
FILES.set("Mac:/u/one.chordset", setToFile(mine[2]));
FILES.set("Mac:/u/junk.txt", "hello");
const m = device(); m.api.loadbang();
m.api.read("Mac:/u/My.fm1bank");
check(/^Mine 1\. MY 5/.test(m.shown.name || "") && m.shown.bank === "1" && /3 of my sets/.test(m.shown.info), `bank loaded: ${m.shown.name} / ${m.shown.info}`);
check(m.ctx.notified === 1, "pattr told");
function plays(dev, set, keys) {
  const ref = [], s2 = cloneSet(set);
  Object.assign(s2.play, { mode: 0, latch: 0, voice_lead: 1, octave: 0, transpose: 0, humanise: 0 });
  const p = new Player({ on: (n, v) => ref.push([n, v]), off: (n) => ref.push([n, 0]) }, 1000);
  dev.out.length = 0;
  for (const k of keys) { dev.api.note(KEY0_NOTE + k, 90); p.keyEvent(s2, k, 90); dev.api.note(KEY0_NOTE + k, 0); p.keyEvent(s2, k, 0); }
  return JSON.stringify(dev.out) === JSON.stringify(ref) && ref.length > 0;
}
m.api.setnum(2);
check(plays(m, mine[1], [0, 3, 7, 20]), "my set 2 plays as the editor plays it");
m.api.setnum(9); check(/^Mine 3\./.test(m.shown.name), "set number held to my 3 sets");
const saved = m.api.getvalueof();
check(typeof saved === "string" && saved.length < bankToFile(mine).length + 10, "saved value is the compact bank");
const r = device(); r.api.loadbang(); r.msg("bank", 1);          // a reopened Live set: the switch, then the value
check(/no sets loaded/.test(r.shown.info), `Mine before restore: ${r.shown.info}`);
r.api.setnum(3); r.api.setvalueof(saved);
check(/^Mine 3\. MY 77/.test(r.shown.name || "") && plays(r, mine[2], [0, 1]), `restored from the Live set: ${r.shown.name}`);
r.msg("bank", 0); check(/^1\. /.test(r.shown.name), `back to factory: ${r.shown.name}`);
r.api.read("Mac:/u/one.chordset"); check(/^Mine 1\. MY 77/.test(r.shown.name) && /1 of my sets/.test(r.shown.info), "a .chordset loads");
r.api.read("Mac:/u/junk.txt"); check(/^LOAD: /.test(r.shown.info) && /^Mine 1\./.test(r.shown.name), `junk refused, sets kept: ${r.shown.info}`);
r.api.read("Mac:/u/missing"); check(/^LOAD: /.test(r.shown.info), "missing file refused");
const f = device(); f.api.loadbang(); f.api.setvalueof("none"); f.api.setvalueof("garbage");
check(/^1\. /.test(f.shown.name) && f.api.getvalueof() === "none", "nothing saved: factory");

console.log(fails ? `m4l_test: ${fails} failed` : `m4l_test: ok (${lib.sets.length} sets, ${compared} note events match the editor)`);
process.exit(fails ? 1 : 0);
