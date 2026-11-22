// SPDX-License-Identifier: GPL-3.0-only
// The Ableton device's code (fm1chord.js, from tools/gen_m4l.mjs) run with Max's v8 globals faked: every set,
// chosen as the strip chooses it, plays exactly as the editor's player does; other notes pass through; the
// editor's messages (set, key, notes, mine, origin) do what they say; the state kept in the Live set comes back
// (and a 0.10-0.12 device's My sets); every note it starts it stops. The pages themselves: m4l_pages.py.
//   node tests/host/m4l_test.mjs DIR     (DIR holds fm1chord.js)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Player } from "../../web/editor/engine.js";
import { loadPresets, cloneSet, setToFile, bankToFile } from "../../web/editor/setcodec.js";
import { KEY0_NOTE, NKEYS } from "../../web/editor/chord.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(process.argv[2], "fm1chord.js"), "utf8");
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log("FAIL", what); } };

function device() {
  const midi = [], strip = [], editor = [], posts = [], num = [], octs = [];
  const ctx = { console, notified: 0, patcher: { filepath: "Macintosh HD:/Users/jamie/Music/FM1-Chord/FM1-Chord.amxd" }, messagename: "", post: (s) => posts.push(s), arrayfromargs: (a) => Array.from(a) };
  ctx.outlet = (o, a) => {
    if (o === 0) { midi.push(a.slice()); return; }
    if (o === 4) { octs.push(a[1]); return; }
    if (o === 3) { if (a[0] !== "set") throw new Error("the SET number: " + a.join(" ")); num.push(a[1]); return; }
    if (a[0] === "readfile") { (o === 1 ? strip : editor).push(["readfile", a[1]]); return; }
    const m = /^window\.__fcIn && window\.__fcIn\(("[^"]*"),([\s\S]*)\)$/.exec(a[1]);
    if (a[0] !== "executejavascript" || !m) throw new Error("not a call into a page: " + a.join(" "));
    (o === 1 ? strip : editor).push([JSON.parse(m[1]), JSON.parse(m[2])]);
  };
  ctx.notifyclients = () => ctx.notified++;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const send = (name, ...a) => {               // as Max: the function the message names, else anything()
    ctx.messagename = name;
    const f = vm.runInContext(`typeof ${name} === "function" ? ${name} : null`, ctx);
    return (f || vm.runInContext("anything", ctx))(...a);
  };
  const last = (list, name) => [...list].reverse().find((x) => x[0] === name)?.[1];
  const get = (expr) => vm.runInContext(expr, ctx);
  return { midi, strip, editor, posts, num, octs, send, last, get, ctx };
}

const lib = loadPresets(JSON.parse(readFileSync(join(ROOT, "web/editor/presets.json"), "utf8")));
const d0 = device();
d0.send("loadbang");
check(d0.get("inlets") === 1 && d0.get("outlets") === 5, "inlets / outlets");
const L = d0.last(d0.strip, "list");
check(L && L.factory.length === lib.sets.length && L.mine.length === 0, "the strip gets every set");
check(d0.last(d0.strip, "show")?.chords.length === NKEYS, "the strip gets 27 chord names");

// 1. every set, chosen as the strip does, plays what the editor's player plays (ticks for strum and arp)
let compared = 0;
for (let si = 0; si < lib.sets.length; si++) {
  const dev = device();
  dev.send("loadbang");
  dev.send("tempo", 120);
  dev.send("choose", "factory", si);
  check(dev.last(dev.editor, "open")?.[1] === si, `set ${si + 1}: the editor is told to open it`);
  dev.midi.length = 0;
  const ref = [], set = cloneSet(lib.sets[si]);
  set.tempo = 120;
  const p = new Player({ on: (n, v) => ref.push([n, v]), off: (n) => ref.push([n, 0]) }, 1000);
  for (const k of [0, 4, 9, 13, 26, 2]) {
    dev.send("note", KEY0_NOTE + k, 100); p.keyEvent(set, k, 100);
    for (let t = 0; t < 40; t++) { dev.send("tick", 5); p.run(set, 5, false); }
    dev.send("note", KEY0_NOTE + k, 0); p.keyEvent(set, k, 0);
    for (let t = 0; t < 40; t++) { dev.send("tick", 5); p.run(set, 5, false); }
  }
  check(JSON.stringify(dev.midi) === JSON.stringify(ref), `set ${si + 1} (${set.name}): notes differ from the editor's player`);
  compared += ref.length;
}

// 2. the track: keys light both pages; other notes pass through; Key 1 moves; panic
const t = device(); t.send("loadbang");
t.midi.length = 0;
t.send("note", KEY0_NOTE - 1, 90); t.send("note", KEY0_NOTE + NKEYS, 80); t.send("note", KEY0_NOTE + NKEYS, 0);
check(JSON.stringify(t.midi) === JSON.stringify([[KEY0_NOTE - 1, 90], [KEY0_NOTE + NKEYS, 80], [KEY0_NOTE + NKEYS, 0]]), "pass-through");
t.send("note", KEY0_NOTE + 3, 100);
check(JSON.stringify(t.last(t.strip, "lit")) === "[3,1]" && JSON.stringify(t.last(t.editor, "lit")) === "[3,1]", "a key lights both pages");
t.send("note", KEY0_NOTE + 3, 0);
t.send("base", 60); t.midi.length = 0;
t.send("note", 60, 100); t.send("note", 60, 0);
check(t.midi.length >= 6 && t.midi[0][0] !== 60, "Key 1 moved to C4");
t.midi.length = 0; t.send("panic"); check(t.midi.length === 128, "panic");
t.send("nonsense", 1); check(t.posts.some((p) => /nonsense/.test(p)), "an unknown message is reported");

// 3. the editor: hello gets the state; set, key, notes, origin, mine
const e = device(); e.send("loadbang");
e.send("hello");
const r0 = e.last(e.editor, "restore");
check(r0 && r0.kind === "factory" && r0.i === 0 && r0.mine === "none" && /fm1-chord-set/.test(r0.cur), "hello: the editor gets the set");
const mySet = cloneSet(lib.sets[40]); mySet.name = "MY JUNGLE"; mySet.chords[0] = { ...mySet.chords[5] };
e.send("set", setToFile(mySet));
check(e.get("cur.name") === "MY JUNGLE" && e.last(e.strip, "show").name === "MY JUNGLE" && e.ctx.notified > 0, "set: the device plays the editor's set");
e.midi.length = 0;
e.send("key", 0, 100);
const ref = [], p2 = new Player({ on: (n, v) => ref.push([n, v]), off: (n) => ref.push([n, 0]) }, 1000);
const s2 = cloneSet(mySet); s2.tempo = 120; p2.keyEvent(s2, 0, 100);
for (let i = 0; i < 40; i++) { e.send("tick", 5); p2.run(s2, 5, false); }
e.send("key", 0, 0); p2.keyEvent(s2, 0, 0);
check(JSON.stringify(e.midi) === JSON.stringify(ref) && ref.length > 0, "key: the editor's key plays the edited chord");
e.midi.length = 0;
e.send("notes", 60, 64, 67); e.send("notes", 62, 67); e.send("notes");
check(JSON.stringify(e.midi) === "[[60,100],[64,100],[67,100],[60,0],[64,0],[62,100],[62,0],[67,0]]", `notes: previews (${JSON.stringify(e.midi)})`);
e.send("mine", bankToFile([mySet, lib.sets[3]]));
check(e.last(e.strip, "list").mine.join("|") === "MY JUNGLE|" + lib.sets[3].name, "mine: My sets on the strip");
e.send("origin", "mine", 0, 1);
check(e.last(e.strip, "show").kind === "mine", "origin");
e.send("step", -1);                                // My sets come first: from mine 0 back to the last factory set
check(e.get("where.kind") === "factory" && e.get("where.i") === lib.sets.length - 1, "step wraps round");
e.send("choose", "mine", 1);
check(e.get("cur.name") === lib.sets[3].name && JSON.stringify(e.last(e.editor, "open")) === '["mine",1]', "choose mine");
e.send("set", setToFile(mySet)); e.send("origin", "mine", 0, 1);

// 4. the Live set: the state comes back in a new device (and the editor gets it); a 0.10-0.12 bank; junk
const saved = e.send("getvalueof");
const f = device(); f.send("loadbang"); f.send("setvalueof", saved);
const r1 = f.last(f.editor, "restore");
check(f.get("cur.name") === "MY JUNGLE" && f.get("MINE.length") === 2 && r1 && r1.kind === "mine" && r1.dirty === 1, "the Live set's state comes back");
check(f.last(f.strip, "show").name === "MY JUNGLE" && f.last(f.strip, "list").mine.length === 2, "and shows on the strip");
const g = device(); g.send("loadbang"); g.send("setvalueof", bankToFile([mySet]));
check(g.get("MINE.length") === 1, "a 0.10-0.12 device's My sets come in");
const h = device(); h.send("loadbang"); h.send("setvalueof", "garbage"); h.send("setvalueof", "none");
check(h.get("cur.name") === lib.sets[0].name && h.posts.length === 1, "junk in the Live set: reported, nothing changes");

// 5. Live's own controls: SET number (ignored at start: the Live set decides), and it follows the strip and editor
const n = device(); n.send("loadbang"); n.send("stripready"); n.send("hello");
n.send("setnum", 7);
check(n.get("where.i") === 0, "the SET number's stored value at start is left alone");
for (let i = 0; i < 210; i++) n.send("tick", 5);
n.send("setnum", 7);
check(n.get("where.kind") === "factory" && n.get("where.i") === 6 && n.get("cur.name") === lib.sets[6].name, "SET 7 plays factory set 7");
check(JSON.stringify(n.last(n.editor, "open")) === '["factory",6]' && n.last(n.strip, "show").i === 6, "and the strip and editor follow");
n.send("choose", "factory", 20);
check(n.num[n.num.length - 1] === 21, "a set chosen on the strip moves the SET number");
n.send("mine", bankToFile([lib.sets[1], lib.sets[2]]));
check(n.num[n.num.length - 1] === 23, "My sets come first in the numbering");
n.send("setnum", 1);
check(n.get("where.kind") === "mine" && n.get("where.i") === 0, "SET 1 is my first set");
n.send("setnum", 999);
check(n.get("where.i") === lib.sets.length - 1, "SET past the end: the last set");
check(n.posts.some((p) => /FM1-Chord: set 118 /.test(p)), "set changes are written to the Max window");

// 5b. octave: OCT + plays the same chord 12 up, stays when the set changes, -3..+3, shows on the strip
const o = device(); o.send("loadbang"); o.send("choose", "factory", 0);
const play = (dev, k) => { dev.midi.length = 0; dev.send("note", KEY0_NOTE + k, 100); for (let i = 0; i < 40; i++) dev.send("tick", 5);
  const on = dev.midi.filter((m) => m[1]).map((m) => m[0]); dev.send("note", KEY0_NOTE + k, 0); for (let i = 0; i < 40; i++) dev.send("tick", 5); return on; };
o.send("panic"); const a0 = play(o, 0);
o.send("panic"); o.send("octstep", 1); const a1 = play(o, 0);
check(a0.length > 0 && a1.length === a0.length && a1.every((n, i) => n === a0[i] + 12), `OCT +: 12 up (${a0} / ${a1})`);
check(o.octs[o.octs.length - 1] === 1 && o.last(o.strip, "show").oct === 1, "OCT shows on the panel and the strip");
o.send("choose", "factory", 0); o.send("panic"); const a2 = play(o, 0);
check(a2.join() === a1.join(), "the octave stays when the set changes");
for (let i = 0; i < 9; i++) o.send("octstep", 1);
check(o.get("oct") === 3, "no higher than +3");
o.send("octave", -2); check(o.get("oct") === -2 && o.octs[o.octs.length - 1] === -2, "OCT number");

// 5c. an error anywhere shows on the strip and in the Max window, and nothing stops
const x = device(); x.send("loadbang");
x.get("Object.defineProperty(LIB.sets, 3, { get() { throw new Error('boom'); } })");
x.send("choose", "factory", 3);
check(/boom/.test(x.last(x.strip, "error") || "") && x.posts.some((p) => /FM1-Chord: .*boom/.test(p)), "an error shows on the strip");
x.send("note", KEY0_NOTE, 100);
check(x.midi.length > 0, "and the device goes on playing");

// 6. a page that doesn't say hello is loaded again by the device's folder; one that does isn't
const q = device(); q.send("loadbang"); q.send("stripready");
for (let i = 0; i < 310; i++) q.send("tick", 5);
check(q.last(q.editor, "readfile") === "Macintosh HD:/Users/jamie/Music/FM1-Chord/FM1-Chord-editor.html" && !q.last(q.strip, "readfile"),
  "the editor's page reloaded by its full path, the strip's left alone");
const q2 = device(); q2.send("loadbang"); q2.send("stripready"); q2.send("hello");
for (let i = 0; i < 310; i++) q2.send("tick", 5);
check(!q2.last(q2.editor, "readfile") && !q2.last(q2.strip, "readfile"), "both pages answered: nothing reloaded");

// 7. every note started, stopped
const on = new Map();
for (const dev of [t, e]) for (const [n, v] of dev.midi) on.set(n, (on.get(n) || 0) + (v ? 1 : -1));
check([...on.values()].every((c) => c <= 0), "a note left hanging");

console.log(fails ? `m4l_test: ${fails} failed` : `ok   m4l_test: ${lib.sets.length} sets, ${compared} note events match the editor; the editor's and strip's messages; the Live set's state`);
process.exit(fails ? 1 : 0);
