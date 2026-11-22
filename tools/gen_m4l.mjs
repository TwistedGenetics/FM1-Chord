#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord for Ableton Live: a Max for Live MIDI effect made from the editor's own code. The device's strip shows
// the set, the chord playing and the 27 keys; EDITOR opens the whole web editor (every preset, chord editing, the
// suggestions and colour-coded help, playing settings, progressions) in its own window. The chord player (the
// FM-1's: same chords, voicings, voice leading, strum and arpeggio) plays the track's instrument. No synth.
//
//   node tools/gen_m4l.mjs OUTDIR [VERSION]
//
// writes into OUTDIR:
//   FM1-Chord.amxd          the device
//   fm1chord.js             its code (Max's v8): chord.js, setcodec.js, harmony.js, the player from engine.js, the
//                           factory sets, and the glue below
//   FM1-Chord-strip.html    the strip (web/m4l/strip.html), in the device
//   FM1-Chord-editor.html   the editor (web/editor) as one page: its modules bundled, its style and presets inside
//   FM1-Chord.maxpat        the same patch, to paste into an empty Max MIDI Effect if Live won't open the .amxd
//   README.txt
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
const version = process.argv[3] || readFileSync(join(ROOT, "VERSION"), "utf8").trim();
if (!out) { console.error("usage: node tools/gen_m4l.mjs OUTDIR [VERSION]"); process.exit(2); }
mkdirSync(out, { recursive: true });
const ed = (f) => readFileSync(join(ROOT, "web", "editor", f), "utf8");
const presetsText = ed("presets.json");
const presets = JSON.parse(presetsText);

// ================================================================================ the device's code (v8) ===
// Max's v8 object takes one plain script: the modules' tops become globals (they share no names)
function plain(src, name) {
  const lines = src.split("\n").filter((l) => !/^import\s/.test(l) && !/^export\s*\{[^}]*\};?\s*$/.test(l));
  const body = lines.map((l) => l.replace(/^export\s+(const|let|function|class)\b/, "$1")).join("\n");
  if (/^\s*(import|export)\b/m.test(body)) throw new Error(`${name}: an import or export is left`);
  return `// ---- ${name} ----\n${body}\n`;
}
const engine = ed("engine.js");
const p0 = engine.indexOf("// ---- fc_play.c ----"), p1 = engine.indexOf("// ---- the engine:");
if (p0 < 0 || p1 < 0) throw new Error("engine.js: the player's markers have moved");
const player = engine.slice(p0, p1).replace(/^export class Player/m, "class Player");

const glue = String.raw`
// ---- the device ----
// in:   note PITCH VEL (the track's MIDI, from midiparse), tick MS (a 5 ms metro), tempo BPM (Live's), base NOTE (the
//       panel's Key 1), panic
//       from the editor: hello, set TEXT, origin KIND I DIRTY, dirty D, key K VEL, notes N..., mine TEXT
//       from the strip: stripready, choose KIND I, step D, key K VEL
// (Max calls the function a message names: none of these may share a name with the library above)
// out 0: PITCH VEL (to midiformat); out 1: to the strip's web view; out 2: to the editor's
// The set playing, where it came from and My sets are kept in the Live set (pattr, getvalueof / setvalueof).
inlets = 1;
outlets = 3;
autowatch = 1;

const LIB = loadPresets(PRESETS);
let base = KEY0_NOTE, tempoNow = 120, MINE = [], mineText = "none";
let cur = cloneSet(LIB.sets[0]), where = { kind: "factory", i: 0 }, dirty = 0, raw = [];
const held = new Map();                  // incoming note -> key, so a note off finds its key whatever has changed
const player = new Player({ on: (n, v) => outlet(0, [n, v]), off: (n) => outlet(0, [n, 0]) }, 1000);   // ms
cur.tempo = 120;

function js(o, name, data) {             // call window.__fcIn(name, data) in a web view
  outlet(o, ["executejavascript", "window.__fcIn && window.__fcIn(" + JSON.stringify(name) + "," + JSON.stringify(data) + ")"]);
}
const toStrip = (n, d) => js(1, n, d), toEditor = (n, d) => js(2, n, d);
function saved() { if (typeof notifyclients === "function") notifyclients(); }
function show() {
  toStrip("show", { name: cur.name, kind: where.kind, i: where.i,
    chords: cur.chords.map((c) => (isEmpty(c) ? "" : chordName(c))),
    mode: String(MODES[cur.play.mode] || "").toUpperCase() });
}
function list() {
  toStrip("list", { factory: LIB.sets.map((s) => s.name), mine: MINE.map((s, i) => s.name || "SET " + (i + 1)) });
}
function restore() { toEditor("restore", { cur: setToFile(cur), kind: where.kind, i: where.i, dirty, mine: mineText }); }
function lit(k, on) { toStrip("lit", [k, on]); toEditor("lit", [k, on]); }
function useSet(s) {
  const t = cur.tempo;
  cur = s;
  cur.tempo = t || Math.round(tempoNow);
}
function load(kind, i, tell) {
  const src = kind === "mine" ? MINE : LIB.sets;
  if (!src.length) return;
  i = Math.max(0, Math.min(src.length - 1, i | 0));
  player.stop();
  held.clear();
  useSet(cloneSet(src[i]));
  where = { kind, i };
  dirty = 0;
  show();
  if (tell) toEditor("open", [kind, i]);
  saved();
}

// ---- the track
function note(pitch, vel) {
  let k = vel ? pitch - base : held.has(pitch) ? held.get(pitch) : -1;
  if (vel && (k < 0 || k >= NKEYS)) k = -1;
  if (k < 0) { outlet(0, [pitch, vel]); return; }    // not a chord key: through untouched
  if (vel) held.set(pitch, k); else held.delete(pitch);
  player.keyEvent(cur, k, vel);
  lit(k, vel ? 1 : 0);
}
function tick(ms) { player.run(cur, Math.max(1, Math.round(ms)), false); }
function tempo(b) { tempoNow = b; cur.tempo = Math.round(b); }
function panic() {
  player.stop(); held.clear(); raw = [];
  for (let n = 0; n < 128; n++) outlet(0, [n, 0]);
}
function loadbang() { show(); list(); }

// ---- the editor
function hello() { list(); show(); restore(); }
function set(text) {
  try { useSet(setFromFile(String(text))); } catch (e) { post("fm1chord: set: " + e.message + "\n"); return; }
  show();
  saved();
}
function origin(kind, i, d) { where = { kind: String(kind) === "mine" ? "mine" : "factory", i: i | 0 }; dirty = d ? 1 : 0; show(); saved(); }
function key(k, vel) {
  k |= 0;
  if (k < 0 || k >= NKEYS) return;
  player.keyEvent(cur, k, vel | 0);
  lit(k, vel ? 1 : 0);
}
function notes() {                       // the editor's previews (a scale, a progression step): just these notes
  const n = arrayfromargs(arguments).map((x) => x | 0);
  for (const x of raw) if (!n.includes(x)) outlet(0, [x, 0]);
  for (const x of n) if (!raw.includes(x)) outlet(0, [x, 100]);
  raw = n;
}
function mine(text) {
  text = String(text);
  if (text === "none") { MINE = []; mineText = "none"; }
  else try { MINE = bankFromFile(text); mineText = text; } catch (e) { post("fm1chord: mine: " + e.message + "\n"); return; }
  list();
  saved();
}

// ---- the strip
function stripready() { list(); show(); }
function choose(kind, i) { load(String(kind) === "mine" ? "mine" : "factory", i, true); }
function step(d) {
  const all = MINE.map((_, i) => ["mine", i]).concat(LIB.sets.map((_, i) => ["factory", i]));
  let at = all.findIndex(([k, i]) => k === where.kind && i === where.i);
  at = ((at < 0 ? 0 : at + (d < 0 ? -1 : 1)) + all.length) % all.length;
  load(all[at][0], all[at][1], true);
}

// ---- kept in the Live set
function getvalueof() {
  return JSON.stringify({ v: 2, cur: setToFile(cur), kind: where.kind, i: where.i, dirty, mine: mineText });
}
function setvalueof(v) {
  if (typeof v !== "string" || !v.length || v === "none") return;
  try {
    const o = JSON.parse(v);
    if (o.format === "fm1-chord-bank") { MINE = bankFromFile(v); mineText = v; }    // a 0.10-0.12 device's My sets
    else {
      if (o.mine && o.mine !== "none") { MINE = bankFromFile(o.mine); mineText = o.mine; }
      if (o.cur) { useSet(setFromFile(o.cur)); where = { kind: o.kind === "mine" ? "mine" : "factory", i: o.i | 0 }; dirty = o.dirty ? 1 : 0; }
    }
  } catch (e) { post("fm1chord: the Live set's sets didn't load: " + e.message + "\n"); return; }
  list(); show(); restore();
}

function anything() {
  const a = arrayfromargs(arguments);
  if (messagename === "base") { player.stop(); held.clear(); base = Math.round(a[0]); return; }
  if (messagename === "dirty") { dirty = a[0] ? 1 : 0; saved(); return; }
  post("fm1chord: no message " + messagename + "\n");
}
`;

// Max calls the function a message names: the glue's names must be its own
{
  const lib = plain(ed("chord.js"), "") + plain(ed("setcodec.js"), "") + plain(ed("harmony.js"), "") + player;
  for (const [, n] of glue.matchAll(/^function (\w+)/gm))
    if (new RegExp(`^(?:async\\s+)?(?:function|const|let|var|class)\\s+${n}\\b`, "m").test(lib))
      throw new Error(`the device's "${n}" is also a name in the editor's code: rename the message`);
}
const deviceJs = `// FM1-Chord ${version} for Max for Live: generated by tools/gen_m4l.mjs from the FM1-Chord editor's code. Do not
// edit: change web/editor/*.js and regenerate. GPL-3.0-only. https://github.com/TwistedGenetics/FM1-Chord
if (typeof structuredClone === "undefined") var structuredClone = (o) => JSON.parse(JSON.stringify(o));
const FS = 44100;
const PRESETS = ${presetsText.trim()};
${plain(ed("chord.js"), "chord.js")}
${plain(ed("setcodec.js"), "setcodec.js")}
${plain(ed("harmony.js"), "harmony.js")}
${player}
${glue}`;
writeFileSync(join(out, "fm1chord.js"), deviceJs);

// ================================================================================ the editor as one page ===
// Max's web view opens the page from a file: no ES modules, no fetch. Each module runs in its own scope; its
// imports read the modules before it
function bundle(entry) {
  const mods = new Map();
  const visit = (f) => {
    if (mods.has(f)) return;
    mods.set(f, null);
    let src = ed(f);
    const deps = [];
    src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*["']\.\/([\w-]+\.js)["'];?/gm, (_, names, dep) => {
      deps.push(dep);
      const n = names.split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^(\w+)\s+as\s+(\w+)$/, "$1: $2"));
      return `const { ${n.join(", ")} } = __m[${JSON.stringify(dep)}];`;
    });
    if (/^import\s/m.test(src)) throw new Error(`${f}: an import the bundler doesn't know`);
    const names = [];
    src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, n) => { names.push(...n.split(",").map((x) => x.trim()).filter(Boolean)); return ""; });
    src = src.replace(/^export\s+((?:async\s+)?function\*?|class)\s+(\w+)/gm, (_, kw, n) => { names.push(n); return `${kw} ${n}`; });
    src = src.replace(/^export\s+(const|let)\s+(.*)$/gm, (_, kw, rest) => {
      const code = rest.replace(/\/\/.*$/, "");
      const simple = /^[^([{]*$/.test(code.replace(/["'][^"']*["']/g, ""));
      const decl = simple ? code.replace(/;\s*$/, "").split(",") : [code];
      for (const d of decl) { const m = /^\s*(\w+)\s*=/.exec(d); if (m) names.push(m[1]); }
      return `${kw} ${rest}`;
    });
    if (/^export\b/m.test(src)) throw new Error(`${f}: an export the bundler doesn't know`);
    src = src.replace(/import\.meta\.url/g, "location.href");
    deps.forEach(visit);
    mods.delete(f);
    mods.set(f, `__m[${JSON.stringify(f)}] = (() => {\n${src}\nreturn { ${names.join(", ")} };\n})();\n`);
  };
  visit(entry);
  return `"use strict";\nconst __m = {};\n${[...mods.values()].join("\n")}`;
}
const html = ed("index.html")
  .replace(/<link rel="stylesheet" href="style.css">/, () => `<style>\n${ed("style.css")}\n</style>`)
  .replace(/<script type="module" src="app.js"><\/script>/, () =>
    `<script>window.__FC_PRESETS = ${presetsText.trim()};</script>\n<script>\n${bundle("app.js").replace(/<\/script/gi, "<\\/script")}\n</script>`)
  .replace("<title>FM1-Chord Editor</title>", `<title>FM1-Chord ${version}</title>`);
if (!html.includes("__FC_PRESETS") || html.includes('src="app.js"') || html.includes('href="style.css"'))
  throw new Error("index.html: the bundler's markers have moved");
writeFileSync(join(out, "FM1-Chord-editor.html"), html);
writeFileSync(join(out, "FM1-Chord-strip.html"), readFileSync(join(ROOT, "web", "m4l", "strip.html"), "utf8"));

// ================================================================================ the patch ===
function patchMaker() {
  const boxes = [], lines = [];
  let nid = 0;
  const box = (o) => { const id = `obj-${++nid}`; boxes.push({ box: { id, fontname: "Arial Bold", fontsize: 10.0, ...o } }); return id; };
  const obj = (text, x, y, ins, outs, extra = {}) => box({ maxclass: "newobj", text, numinlets: ins, numoutlets: outs.length,
    outlettype: outs, patching_rect: [x, y, Math.max(60, text.length * 6.5), 22], ...extra });
  const msg = (text, x, y) => box({ maxclass: "message", text, numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: [x, y, Math.max(50, text.length * 6.5), 22] });
  const wire = (a, ao, b, bi) => lines.push({ patchline: { source: [a, ao], destination: [b, bi] } });
  return { boxes, lines, box, obj, msg, wire };
}
function param(longname, short, type, range, init, extra = {}) {
  const v = { parameter_longname: longname, parameter_shortname: short, parameter_type: type };
  if (type === 2) Object.assign(v, { parameter_enum: range, parameter_initial_enable: 1, parameter_initial: [init] });
  else if (type !== 3) Object.assign(v, { parameter_mmin: range[0], parameter_mmax: range[1], parameter_unitstyle: 0,
    parameter_initial_enable: 1, parameter_initial: [init] });
  return { parameter_enable: 1, saved_attribute_attributes: { valueof: { ...v, ...extra } } };
}
const patcherBase = (rect, extra) => ({
  fileversion: 1, appversion: { major: 9, minor: 0, revision: 0, architecture: "x64", modernui: 1 }, classnamespace: "box",
  rect, default_fontsize: 10.0, default_fontface: 0, default_fontname: "Arial Bold", gridonopen: 1, gridsize: [8.0, 8.0],
  gridsnaponopen: 1, objectsnaponopen: 1, statusbarvisible: 2, toolbarvisible: 1, boxanimatetime: 200, enablehscroll: 1,
  enablevscroll: 1, description: "", digest: "", tags: "", style: "", subpatcher_template: "", ...extra,
});

// the editor's window: a subpatcher opened by pcontrol; its web view loads with the device and stays live
const E = patchMaker();
{
  E.obj("inlet", 20, 20, 0, [""], { comment: "pcontrol", patching_rect: [20, 20, 30, 30] });
  const inMsg = E.obj("inlet", 80, 20, 0, [""], { comment: "to the editor", patching_rect: [80, 20, 30, 30] });
  const lb = E.obj("loadbang", 140, 20, 1, ["bang"]);
  const rd = E.msg("read FM1-Chord-editor.html", 140, 50);
  const web = E.box({ maxclass: "jweb", numinlets: 1, numoutlets: 2, outlettype: ["", ""], rendermode: 1,
    patching_rect: [80, 90, 400, 300], presentation: 1, presentation_rect: [0, 0, 1180, 820] });
  const o = E.obj("outlet", 80, 420, 1, [], { comment: "from the editor", patching_rect: [80, 420, 30, 30] });
  E.wire(lb, 0, rd, 0); E.wire(rd, 0, web, 0); E.wire(inMsg, 0, web, 0); E.wire(web, 0, o, 0);
}
const editorPatcher = patcherBase([60, 60, 1180, 820], { openinpresentation: 1, toolbarvisible: 0, statusbarvisible: 0,
  boxes: E.boxes, lines: E.lines, title: "FM1-Chord editor" });

const P = patchMaker();
const midiin = P.obj("midiin", 20, 20, 1, ["int"]);
const parse = P.obj("midiparse", 20, 60, 1, ["", "", "", "int", "int", "", "int", ""]);
const pre = P.obj("prepend note", 20, 100, 1, [""]);
const v8 = P.obj("v8 fm1chord.js", 20, 300, 1, ["", "", ""], { varname: "fm1code" });
const fmt = P.obj("midiformat", 20, 360, 7, ["int", ""]);
const midiout = P.obj("midiout", 20, 400, 1, []);
P.wire(midiin, 0, parse, 0); P.wire(parse, 0, pre, 0); P.wire(pre, 0, v8, 0); P.wire(v8, 0, fmt, 0); P.wire(fmt, 0, midiout, 0);
for (const o of [1, 2, 3, 4, 5, 6]) P.wire(parse, o, fmt, o);   // aftertouch, controllers, program, bend: through
const metro = P.obj("metro 5 @active 1", 300, 220, 2, ["bang"]);
const tickMsg = P.msg("tick 5", 300, 250);
P.wire(metro, 0, tickMsg, 0); P.wire(tickMsg, 0, v8, 0);
const dev = P.obj("live.thisdevice", 420, 100, 1, ["bang", "int", "int"]);
const pathMsg = P.msg("path live_set", 420, 130);
const lpath = P.obj("live.path", 420, 160, 1, ["", "", ""]);
const lobs = P.obj("live.observer @property tempo", 420, 190, 2, ["", ""]);
const preT = P.obj("prepend tempo", 420, 220, 1, [""]);
P.wire(dev, 0, pathMsg, 0); P.wire(pathMsg, 0, lpath, 0); P.wire(lpath, 0, lobs, 1); P.wire(lobs, 0, preT, 0); P.wire(preT, 0, v8, 0);
const lbm = P.msg("loadbang", 520, 130);
P.wire(dev, 0, lbm, 0); P.wire(lbm, 0, v8, 0);
// the strip, in the device
const strip = P.box({ maxclass: "jweb", varname: "strip", numinlets: 1, numoutlets: 2, outlettype: ["", ""], rendermode: 1,
  patching_rect: [200, 470, 330, 85], presentation: 1, presentation_rect: [0, 0, 660, 169] });
const rdS = P.msg("read FM1-Chord-strip.html", 200, 440);
P.wire(dev, 0, rdS, 0); P.wire(rdS, 0, strip, 0);
P.wire(v8, 1, strip, 0);
const rOpen = P.obj("route openeditor", 200, 570, 1, ["", ""]);
const openMsg = P.msg("open", 200, 600);
const pc = P.obj("pcontrol", 200, 630, 1, [""]);
const pEd = P.box({ maxclass: "newobj", text: "p editor", numinlets: 2, numoutlets: 1, outlettype: [""],
  patching_rect: [200, 670, 80, 22], patcher: editorPatcher, saved_object_attributes: { description: "", digest: "", globalpatchername: "", tags: "" } });
P.wire(strip, 0, rOpen, 0); P.wire(rOpen, 0, openMsg, 0); P.wire(openMsg, 0, pc, 0); P.wire(pc, 0, pEd, 0);
P.wire(rOpen, 1, v8, 0);
P.wire(v8, 2, pEd, 1); P.wire(pEd, 0, v8, 0);
// the panel beside it: Key 1's note, the editor, all notes off
const k1 = P.box({ maxclass: "live.numbox", varname: "base", numinlets: 1, numoutlets: 2, outlettype: ["", "float"],
  patching_rect: [600, 40, 50, 20], presentation: 1, presentation_rect: [668, 30, 84, 22],
  ...param("Key 1 note", "Key 1", 1, [0, 100], 53, { parameter_unitstyle: 8 }) });
P.box({ maxclass: "live.comment", text: "KEY 1", numinlets: 1, numoutlets: 0, fontsize: 12,
  textcolor: [0.64, 0.66, 0.69, 1], patching_rect: [600, 10, 50, 18], presentation: 1, presentation_rect: [668, 8, 84, 18] });
const preB = P.obj("prepend base", 600, 70, 1, [""]);
P.wire(k1, 0, preB, 0); P.wire(preB, 0, v8, 0); P.wire(dev, 0, k1, 0);
const edBtn = P.box({ maxclass: "live.text", varname: "editor", text: "EDITOR", numinlets: 1, numoutlets: 2, outlettype: ["", ""],
  patching_rect: [700, 100, 60, 20], presentation: 1, presentation_rect: [668, 62, 84, 24], mode: 0,
  ...param("Open the editor", "Editor", 2, ["off", "on"], 0) });
const sel2 = P.obj("sel 1", 700, 130, 2, ["bang", ""]);
P.wire(edBtn, 0, sel2, 0); P.wire(sel2, 0, openMsg, 0);
const panicBtn = P.box({ maxclass: "live.text", varname: "panic", text: "ALL OFF", numinlets: 1, numoutlets: 2, outlettype: ["", ""],
  patching_rect: [600, 100, 60, 20], presentation: 1, presentation_rect: [668, 94, 84, 24], mode: 0,
  ...param("All notes off", "Panic", 2, ["off", "on"], 0) });
const sel1 = P.obj("sel 1", 600, 130, 2, ["bang", ""]);
const panicMsg = P.msg("panic", 600, 160);
P.wire(panicBtn, 0, sel1, 0); P.wire(sel1, 0, panicMsg, 0); P.wire(panicMsg, 0, v8, 0);
P.box({ maxclass: "live.comment", text: `v${version}`, numinlets: 1, numoutlets: 0, fontsize: 10,
  textcolor: [0.64, 0.66, 0.69, 1], patching_rect: [700, 10, 50, 18], presentation: 1, presentation_rect: [668, 140, 84, 18] });
// the set playing and My sets, saved with the Live set: a stored-only blob parameter bound to the code
P.box({ maxclass: "newobj", text: "pattr fm1state @bindto fm1code", numinlets: 1, numoutlets: 3, outlettype: ["", "", ""],
  patching_rect: [700, 490, 200, 22], varname: "fm1state",
  ...param("FM1-Chord state", "State", 3, null, 0, { parameter_invisible: 1 }) });

const patcher = { patcher: patcherBase([80, 80, 1100, 760], {
  openinpresentation: 1, devicewidth: 760.0, description: "FM1-Chord: a chord on every key, as on the M-VAVE FM-1",
  boxes: P.boxes, lines: P.lines,
  dependency_cache: ["fm1chord.js", "FM1-Chord-strip.html", "FM1-Chord-editor.html"].map((name) =>
    ({ name, bootpath: ".", patcherrelativepath: ".", type: "TEXT", implicit: 1 })),
  latency: 0, is_mpe: 0, external_mpe_tuning_enabled: 0, minimum_live_version: "12.0", minimum_max_version: "9.0.0",
  platform_compatibility: 0, autosave: 0 }) };
const json = JSON.stringify(patcher, null, "\t");
writeFileSync(join(out, "FM1-Chord.maxpat"), json);
// the .amxd: "ampf", a version, the device kind ("mmmm": MIDI effect), an empty "meta" chunk, then "ptch" and the patch
const data = Buffer.concat([Buffer.from(json, "utf8"), Buffer.from([0x0a, 0x00])]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
writeFileSync(join(out, "FM1-Chord.amxd"), Buffer.concat([Buffer.from("ampf"), u32(4), Buffer.from("mmmm"),
  Buffer.from("meta"), u32(4), u32(0), Buffer.from("ptch"), u32(data.length), data]));

writeFileSync(join(out, "README.txt"), `FM1-Chord ${version} for Ableton Live (Max for Live MIDI effect)

Needs Live 12 with Max for Live (Max 9 comes with Live 12.1 and later).

Install
  Keep these four files together in one folder, e.g. your User Library's "Presets/MIDI Effects/Max MIDI Effect":
    FM1-Chord.amxd   fm1chord.js   FM1-Chord-strip.html   FM1-Chord-editor.html
  Drag FM1-Chord.amxd onto a MIDI track, before any instrument (a VST is fine).

Play
  Each key from Key 1 (F3 to start with) up, 27 keys, plays that key's chord in the set, just as the FM-1 does: the
  same voicings, voice leading, strum and arpeggio (at Live's tempo). Other notes and controllers pass through.
  The strip shows the set (pick one, or step with the arrows), the chord playing and the 27 keys; click a key to
  hear it.

The editor
  EDITOR opens the whole FM1-Chord editor in its own window: every factory set and My sets, chords, suggestions with
  the colour-coded help, playing (chord, strum, arpeggio), progressions, pasting chords. What you play there, and
  every change, plays on the track. Save keeps a set in My sets. The set playing and My sets are saved with your Live
  set. (The FM-1's own sound and its connection aren't in this editor: your instrument is the sound.)

If Live says it can't open the .amxd
  Drag an empty "Max MIDI Effect" onto a track, press its Edit button, open FM1-Chord.maxpat in that Max window
  (File > Open), select all, copy, paste into the empty device, then save it (File > Save As) next to the other files.

If the strip stays blank or the device can't find fm1chord.js
  The four files must be in the same folder (or that folder in Max's Options > File Preferences).
`);
console.log(`gen_m4l: ${out}: FM1-Chord.amxd (${P.boxes.length} objects), fm1chord.js (${(deviceJs.length / 1024).toFixed(0)} KB), ` +
  `editor page (${(html.length / 1024).toFixed(0)} KB, ${presets.sets.length} sets)`);
