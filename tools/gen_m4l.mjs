#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord for Ableton Live: a Max for Live MIDI effect made from the editor's own code, so it plays every set the
// way the FM-1 does (the same chords, voicings, voice leading, strum and arpeggio). No synth: put any instrument
// after it.
//
//   node tools/gen_m4l.mjs OUTDIR [VERSION]
//
// writes OUTDIR/FM1-Chord.amxd (the device), OUTDIR/fm1chord.js (its code: chord.js, setcodec.js, harmony.js and the
// player from engine.js, with every factory set), OUTDIR/FM1-Chord.maxpat (the same patch, to paste into an empty
// Max MIDI Effect if Live ever won't open the .amxd) and OUTDIR/README.txt.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
const version = process.argv[3] || readFileSync(join(ROOT, "VERSION"), "utf8").trim();
if (!out) { console.error("usage: node tools/gen_m4l.mjs OUTDIR [VERSION]"); process.exit(2); }
mkdirSync(out, { recursive: true });

// ---- the code: the editor's modules in one plain script (Max's v8 object takes no ES modules) ----
const ed = (f) => readFileSync(join(ROOT, "web", "editor", f), "utf8");
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
const presets = JSON.parse(ed("presets.json"));

const glue = String.raw`
// ---- the device ----
// in:  note PITCH VEL (from midiparse), tick MS, tempo BPM, and the panel: setnum mode latch vl octave transpose
//      strum strumdir arprate arpdir arpoct arpgate human base
// out 0: PITCH VEL (to midiformat); out 1: what to show (name, chord, info)
inlets = 1;
outlets = 2;
autowatch = 1;

const LIB = loadPresets(PRESETS);
const UI = { mode: 0, latch: 0, vl: 1, octave: 0, transpose: 0, strum: 15, strumdir: 0, arprate: 3, arpdir: 0,
  arpoct: 1, arpgate: 60, human: 0 };
let base = KEY0_NOTE, setIdx = 0, tempoNow = 120, cur = null;
const held = new Map();                  // incoming note -> key, so a note off finds its key whatever has changed
const player = new Player({
  on: (n, v) => outlet(0, [n, v]),
  off: (n) => outlet(0, [n, 0]),
}, 1000);                                // the player's clock in milliseconds

function applyUI() {
  const p = cur.play;
  p.mode = UI.mode; p.latch = UI.latch; p.voice_lead = UI.vl; p.octave = UI.octave; p.transpose = UI.transpose;
  p.strum = UI.strum; p.strum_dir = UI.strumdir; p.arp_rate = UI.arprate; p.arp_dir = UI.arpdir;
  p.arp_oct = UI.arpoct; p.arp_gate = UI.arpgate; p.humanise = UI.human;
  cur.tempo = Math.round(tempoNow);
}
function show(k) {
  outlet(1, ["name", (setIdx + 1) + ". " + cur.name]);
  if (k === undefined) return;
  const c = cur.chords[k];
  outlet(1, ["chord", isEmpty(c) ? "-" : chordName(c)]);
  outlet(1, ["info", "key " + (k + 1) + " · " + keyName(k)]);
}
function load(i) {
  player.stop();
  setIdx = Math.max(0, Math.min(LIB.sets.length - 1, i));
  cur = cloneSet(LIB.sets[setIdx]);
  applyUI();
  show();
  outlet(1, ["chord", "-"]);
  outlet(1, ["info", LIB.sets.length + " sets · key 1 = " + midiName(base)]);
}
function note(pitch, vel) {
  if (!cur) load(setIdx);
  let k = vel ? pitch - base : held.has(pitch) ? held.get(pitch) : -1;
  if (vel && (k < 0 || k >= NKEYS)) k = -1;
  if (k < 0) {                           // not a chord key: passes through untouched
    outlet(0, [pitch, vel]);
    return;
  }
  if (vel) held.set(pitch, k); else held.delete(pitch);
  player.keyEvent(cur, k, vel);
  if (vel) show(k);
}
function tick(ms) { if (cur) player.run(cur, Math.max(1, Math.round(ms)), false); }
function tempo(b) { tempoNow = b; if (cur) cur.tempo = Math.round(b); }
function setnum(n) { load(Math.round(n) - 1); }
function panel(name, v) {
  if (!(name in UI)) return;
  UI[name] = Math.round(v);
  if (cur) applyUI();
}
function anything() {
  const a = arrayfromargs(arguments);
  if (messagename === "base") { player.stop(); base = Math.round(a[0]); return; }
  if (messagename in UI) { panel(messagename, a[0]); return; }
  post("fm1chord: no message " + messagename + "\n");
}
function panic() { player.stop(); held.clear(); for (let n = 0; n < 128; n++) outlet(0, [n, 0]); }
function loadbang() { load(setIdx); }
`;

const js = `// FM1-Chord ${version} for Max for Live: generated by tools/gen_m4l.mjs from the FM1-Chord editor's code. Do not
// edit: change web/editor/*.js and regenerate. GPL-3.0-only. https://github.com/TwistedGenetics/FM1-Chord
if (typeof structuredClone === "undefined") var structuredClone = (o) => JSON.parse(JSON.stringify(o));
const FS = 44100;
const PRESETS = ${JSON.stringify(presets)};
${plain(ed("chord.js"), "chord.js")}
${plain(ed("setcodec.js"), "setcodec.js")}
${plain(ed("harmony.js"), "harmony.js")}
${player}
${glue}`;
writeFileSync(join(out, "fm1chord.js"), js);

// ---- the patch ----
const boxes = [], lines = [];
let nid = 0;
function box(o) {
  const id = `obj-${++nid}`;
  boxes.push({ box: { id, fontname: "Arial Bold", fontsize: 10.0, ...o } });
  return id;
}
const obj = (text, x, y, ins, outs, extra = {}) =>
  box({ maxclass: "newobj", text, numinlets: ins, numoutlets: outs.length, outlettype: outs, patching_rect: [x, y, Math.max(60, text.length * 6.5), 22], ...extra });
const wire = (a, ao, b, bi) => lines.push({ patchline: { source: [a, ao], destination: [b, bi] } });
function param(longname, short, type, range, init, extra = {}) {
  const v = { parameter_longname: longname, parameter_shortname: short, parameter_type: type,
    parameter_initial_enable: 1, parameter_initial: [init] };
  if (type === 2) v.parameter_enum = range;
  else { v.parameter_mmin = range[0]; v.parameter_mmax = range[1]; v.parameter_unitstyle = 0; }
  return { parameter_enable: 1, saved_attribute_attributes: { valueof: { ...v, ...extra } } };
}
// presentation: a 600 x 169 device
const midiin = obj("midiin", 20, 20, 1, ["int"]);
const parse = obj("midiparse", 20, 60, 1, ["", "", "", "int", "int", "", "int", ""]);
const pre = obj("prepend note", 20, 100, 1, [""]);
const v8 = obj("v8 fm1chord.js", 20, 300, 1, ["", ""]);
const fmt = obj("midiformat", 20, 360, 7, ["int", ""]);
const midiout = obj("midiout", 20, 400, 1, []);
wire(midiin, 0, parse, 0); wire(parse, 0, pre, 0); wire(pre, 0, v8, 0); wire(v8, 0, fmt, 0); wire(fmt, 0, midiout, 0);
// everything that isn't a note (aftertouch, controllers, program, bend) goes straight back out, on its channel
for (const o of [1, 2, 3, 4, 5, 6]) wire(parse, o, fmt, o);
// the clock: 5 ms ticks drive strum, arpeggio and gate
const metro = obj("metro 5 @active 1", 300, 220, 2, ["bang"]);
const tickMsg = box({ maxclass: "message", text: "tick 5", numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: [300, 250, 50, 22] });
wire(metro, 0, tickMsg, 0); wire(tickMsg, 0, v8, 0);
// Live's tempo
const dev = obj("live.thisdevice", 420, 100, 1, ["bang", "int", "int"]);
const pathMsg = box({ maxclass: "message", text: "path live_set", numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: [420, 130, 80, 22] });
const lpath = obj("live.path", 420, 160, 1, ["", "", ""]);
const lobs = obj("live.observer @property tempo", 420, 190, 2, ["", ""]);
const preT = obj("prepend tempo", 420, 220, 1, [""]);
wire(dev, 0, pathMsg, 0); wire(pathMsg, 0, lpath, 0); wire(lpath, 0, lobs, 1); wire(lobs, 0, preT, 0); wire(preT, 0, v8, 0);
const lb = box({ maxclass: "message", text: "loadbang", numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: [520, 130, 60, 22] });
wire(dev, 0, lb, 0); wire(lb, 0, v8, 0);
// what it shows
const route = obj("route name chord info", 200, 340, 1, ["", "", "", ""]);
wire(v8, 1, route, 0);
const show = [
  ["name", [10, 4, 380, 22], 15, [0.85, 0.87, 0.9, 1]],
  ["chord", [10, 26, 250, 58], 40, [0.235, 0.784, 0.863, 1]],
  ["info", [10, 86, 300, 20], 12, [0.64, 0.66, 0.69, 1]],
];
show.forEach(([n, rect, size, col], i) => {
  const ps = obj("prepend set", 200 + i * 110, 370, 1, [""]);
  const c = box({ maxclass: "live.comment", text: n === "chord" ? "-" : "FM1-Chord", numinlets: 1, numoutlets: 0,
    fontsize: size, textcolor: col, patching_rect: [200 + i * 110, 400, 100, 20], presentation: 1, presentation_rect: rect });
  wire(route, i, ps, 0); wire(ps, 0, c, 0);
});
const help = box({ maxclass: "live.comment", text: `Play keys from "Key 1" up (27 keys). FM1-Chord ${version}`, numinlets: 1, numoutlets: 0,
  fontsize: 10, textcolor: [0.64, 0.66, 0.69, 1], patching_rect: [560, 400, 200, 18], presentation: 1, presentation_rect: [10, 148, 330, 18] });
void help;
// the panel: each control sends its message; at load the device bangs them so the code starts as they show
const ctls = [
  ["live.numbox", "setnum", "Set", "Set", 1, [1, 118], 1, [10, 112, 60, 20]],
  ["live.tab", "mode", "Mode", "Mode", 2, ["Chord", "Strum", "Arp"], 0, [330, 6, 180, 20]],
  ["live.text", "latch", "Latch", "Latch", 2, ["off", "on"], 0, [516, 6, 74, 20], { text: "LATCH", texton: "LATCH", mode: 1 }],
  ["live.text", "vl", "Voice lead", "VL", 2, ["off", "on"], 1, [516, 30, 74, 20], { text: "VOICE LEAD", texton: "VOICE LEAD", mode: 1 }],
  ["live.numbox", "octave", "Octave", "Oct", 1, [-3, 3], 0, [80, 112, 50, 20]],
  ["live.numbox", "transpose", "Transpose", "Trans", 1, [-12, 12], 0, [140, 112, 50, 20]],
  ["live.numbox", "base", "Key 1 note", "Key 1", 1, [0, 100], 53, [200, 112, 60, 20], { parameter_unitstyle: 8 }],
  ["live.dial", "strum", "Strum", "Strum", 1, [0, 127], 15, [330, 34, 44, 48]],
  ["live.menu", "strumdir", "Strum dir", "Dir", 2, ["Up", "Down", "Alt"], 0, [330, 90, 60, 18]],
  ["live.menu", "arprate", "Arp rate", "Rate", 2, ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"], 3, [400, 90, 60, 18]],
  ["live.menu", "arpdir", "Arp dir", "Arp", 2, ["Up", "Down", "Up/Down", "Random"], 0, [466, 90, 64, 18]],
  ["live.dial", "arpoct", "Arp octaves", "Octs", 1, [1, 4], 1, [380, 34, 44, 48]],
  ["live.dial", "arpgate", "Arp gate", "Gate", 1, [10, 100], 60, [430, 34, 44, 48]],
  ["live.dial", "human", "Humanise", "Human", 1, [0, 127], 0, [480, 34, 44, 48]],
];
ctls.forEach(([cls, msg, longname, short, type, range, init, rect, extra = {}], i) => {
  const outs = cls === "live.text" || cls === "live.tab" || cls === "live.menu" ? ["", "", "float"] : ["", "float"];
  const c = box({ maxclass: cls, varname: msg, numinlets: 1, numoutlets: outs.length, outlettype: outs,
    patching_rect: [600 + (i % 4) * 90, 40 + Math.floor(i / 4) * 70, rect[2], rect[3]], presentation: 1,
    presentation_rect: rect, ...param(longname, short, type, range, init, extra.parameter_unitstyle !== undefined ? { parameter_unitstyle: extra.parameter_unitstyle } : {}),
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "parameter_unitstyle")) });
  const p = obj(`prepend ${msg}`, 600 + (i % 4) * 90, 70 + Math.floor(i / 4) * 70, 1, [""]);
  wire(c, 0, p, 0); wire(p, 0, v8, 0); wire(dev, 0, c, 0);
});
const panicBtn = box({ maxclass: "live.text", varname: "panic", text: "ALL OFF", numinlets: 1, numoutlets: 2, outlettype: ["", ""],
  patching_rect: [600, 360, 60, 20], presentation: 1, presentation_rect: [516, 54, 74, 20], mode: 0,
  ...param("All notes off", "Panic", 2, ["off", "on"], 0) });
const panicMsg = box({ maxclass: "message", text: "panic", numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: [600, 390, 50, 22] });
wire(panicBtn, 0, panicMsg, 0); wire(panicMsg, 0, v8, 0);

const patcher = {
  patcher: {
    fileversion: 1,
    appversion: { major: 9, minor: 0, revision: 0, architecture: "x64", modernui: 1 },
    classnamespace: "box",
    rect: [80, 80, 1100, 640],
    openinpresentation: 1,
    default_fontsize: 10.0, default_fontface: 0, default_fontname: "Arial Bold",
    gridonopen: 1, gridsize: [8.0, 8.0], gridsnaponopen: 1, objectsnaponopen: 1, statusbarvisible: 2, toolbarvisible: 1,
    boxanimatetime: 200, enablehscroll: 1, enablevscroll: 1, devicewidth: 600.0,
    description: "FM1-Chord: a chord on every key, as on the M-VAVE FM-1",
    digest: "", tags: "", style: "", subpatcher_template: "",
    boxes, lines,
    dependency_cache: [{ name: "fm1chord.js", bootpath: ".", patcherrelativepath: ".", type: "TEXT", implicit: 1 }],
    latency: 0, is_mpe: 0, external_mpe_tuning_enabled: 0, minimum_live_version: "12.0", minimum_max_version: "9.0.0",
    platform_compatibility: 0, autosave: 0,
  },
};
const json = JSON.stringify(patcher, null, "\t");
writeFileSync(join(out, "FM1-Chord.maxpat"), json);
// the .amxd: "ampf", a version, the device kind ("mmmm": MIDI effect), an empty "meta" chunk, then "ptch" and the patch
const data = Buffer.concat([Buffer.from(json, "utf8"), Buffer.from([0x0a, 0x00])]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
writeFileSync(join(out, "FM1-Chord.amxd"), Buffer.concat([Buffer.from("ampf"), u32(4), Buffer.from("mmmm"),
  Buffer.from("meta"), u32(4), u32(0), Buffer.from("ptch"), u32(data.length), data]));
writeFileSync(join(out, "README.txt"), `FM1-Chord ${version} for Ableton Live (Max for Live MIDI effect)

Needs Live 12 Suite (or Standard with Max for Live) and Max 9 (it comes with Live 12).

Install
  1. Put FM1-Chord.amxd and fm1chord.js in the same folder, e.g. your User Library's "Presets/MIDI Effects/Max MIDI Effect".
  2. Drag FM1-Chord.amxd onto a MIDI track, before any instrument (a VST is fine).

Play
  Each key from "Key 1" (F3 to start with) up, 27 keys, plays that key's chord in the chosen Set, just as the FM-1 does:
  the same voicings, voice leading, strum and arpeggio. Notes below or above pass through untouched, as do
  controllers. The arpeggio runs at Live's tempo. All 118 factory sets are in it.

If Live says it can't open the .amxd
  Drag an empty "Max MIDI Effect" onto a track, press its Edit button, open FM1-Chord.maxpat in that Max window
  (File > Open), select all, copy, paste into the empty device, then save it (File > Save As) next to fm1chord.js.

If the device says it can't find fm1chord.js
  Keep fm1chord.js in the same folder as the device, or add that folder in Max's Options > File Preferences.
`);
console.log(`gen_m4l: ${out}/FM1-Chord.amxd (${boxes.length} objects), fm1chord.js (${(js.length / 1024).toFixed(0)} KB, ${presets.sets.length} sets)`);
