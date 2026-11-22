// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord editor: chord sets with an in-browser preview, harmony suggestions, progressions and MIDI export, and
// syncing with the FM-1. Copyright (C) 2026 Jamie (TwistedGenetics).
import {
  NKEYS, EMPTY, NOBASS, Q_CUSTOM, QUALITIES, NOTE_NAMES, VOICING_LABELS, INVERSION_LABELS, emptyChord, isEmpty,
  chordNotes, chordName, formatChord, midiName, keyName, isBlack, identify, tones,
} from "./chord.js";
import {
  loadPresets, newSet, cloneSet, encodeSet, setToFile, setFromFile, bankToFile, bankFromFile, WAVES, MODES, RATES, STRUM_DIRS, ARP_DIRS,
  ensureSx, DIVS, DIV_BEATS, DLY_MAX,
} from "./setcodec.js";
import { suggest, suggestNext, fillSet, expandSet, detectKey, roman, keyLabel, rate, SCALE_LABELS, TIERS } from "./harmony.js";
import { readChordText } from "./chordtext.js";
import { PHRASES, render as renderProg, toMidiFile } from "./progression.js";
import { Preview } from "./audio.js";
import { Device, midiAccess, WORKING, FACTORY0, NUSER } from "./device.js";
import { mockFM1 } from "./mock-fm1.js";
import { LiveSync, EVT } from "./live.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const DEMO = new URLSearchParams(location.search).has("demo");
const LS = "fm1chord.library.v1";

const st = {
  sounds: [], factory: [], mine: [], cur: { kind: "factory", i: 0 }, set: null, dirty: false, sel: 0,
  tab: "chord", view: "keys", lit: new Map(), clip: null, bias: true, keyAuto: false, pickNth: 0, picked: null,
  learn: null, prog: { steps: [], phrase: 0, rec: false, playing: false, recT: 0, recKey: -1, at: -1 },
  progTimer: null, midiOut: null, local: true,
};
const preview = new Preview();
const dev = new Device();
const live = new LiveSync(dev);
let mock = null, access = null;

// ------------------------------------------------------------------------------------------------ library ---
function loadMine() {
  try { st.mine = JSON.parse(localStorage.getItem(LS) || "[]"); } catch { st.mine = []; }
  st.mine.forEach(ensureSx);                       // saved before 0.6: no sound part 2
}
function saveMine() {
  try { localStorage.setItem(LS, JSON.stringify(st.mine)); } catch (e) { toast("Couldn't save in this browser: " + e.message); }
}
function libLabel() {
  const sel = $("#lib");
  sel.innerHTML = "";
  const g1 = document.createElement("optgroup"); g1.label = "Factory";
  const gj = document.createElement("optgroup"); gj.label = "J6: the Roland J-6's chord sets";
  st.factory.forEach((s, i) => (s.name.startsWith("J6 ") ? gj : g1).append(new Option(s.name, `f${i}`)));
  const g2 = document.createElement("optgroup"); g2.label = "My sets (this device)";
  st.mine.forEach((s, i) => g2.append(new Option(s.name || `SET ${i + 1}`, `m${i}`)));
  sel.append(g1); if (gj.children.length) sel.append(gj); if (st.mine.length) sel.append(g2);
  if (st.cur.kind === "fm1") {                     // a user set the FM-1 is playing (live sync)
    const g3 = document.createElement("optgroup"); g3.label = "On the FM-1";
    g3.append(new Option(`U${st.cur.i + 1} ${st.set.name}`, `d${st.cur.i}`));
    sel.append(g3);
  }
  sel.value = st.cur.kind === "fm1" ? `d${st.cur.i}` : (st.cur.kind === "factory" ? "f" : "m") + st.cur.i;
}
function openSet(kind, i) {
  if (st.dirty && !confirm("This set has changes that aren't saved. Open another anyway?")) { libLabel(); return; }
  st.cur = { kind, i };
  st.set = cloneSet(kind === "factory" ? st.factory[i] : st.mine[i]);
  st.dirty = false;
  if (st.sel >= NKEYS) st.sel = 0;
  stopProg();
  pushSet();
  live.open(st.set, kind === "factory" ? FACTORY0 + i : -1);
  renderAll();
}
function markDirty() { st.dirty = true; $("#b-save").textContent = "Save *"; pushSet(); live.edit(st.set); }

// ---- live sync: the FM-1's panel changed its set; show it here, without sending it back ----
function sameSet(a, b) { const x = encodeSet(a), y = encodeSet(b); return x.every((v, j) => v === y[j]); }
function fromFM1({ kind, cur, set }) {
  if (!set) return;
  if (kind & EVT.SAVED) {
    st.cur = { kind: "fm1", i: cur }; st.dirty = false;
    toast(`Saved on the FM-1: user set ${cur + 1}`);
  } else if (kind & EVT.LOADED) {
    const f = cur - FACTORY0;
    if (f >= 0 && st.factory[f] && sameSet(st.factory[f], set)) { st.cur = { kind: "factory", i: f }; st.dirty = false; }
    else if (cur < NUSER) { st.cur = { kind: "fm1", i: cur }; st.dirty = false; }
    else st.dirty = true;
    if (kind & EVT.EDITED) st.dirty = true;
  } else st.dirty = true;                          // edited on the FM-1
  st.set = cloneSet(set);
  stopProg();
  pushSet();
  renderAll();
}
function liveLabel() {
  const b = $("#b-live");
  b.classList.toggle("on", live.active);
  b.setAttribute("aria-pressed", String(live.on));
  b.textContent = !dev.connected ? "Live: no FM-1" : live.on ? "Live: on" : "Live: off";
}
function pushSet() { preview.post({ type: "set", set: st.set }); }

// ----------------------------------------------------------------------------------------------- the keys ---
function renderKeys() {
  const kb = $("#kb");
  kb.className = "kb" + (st.view === "grid" ? " grid" : "");
  kb.innerHTML = "";
  const whites = [];
  for (let k = 0; k < NKEYS; k++) if (!isBlack(k)) whites.push(k);
  const sugs = st.tab === "harmony" ? currentSuggestionsMap() : null;
  for (let k = 0; k < NKEYS; k++) {
    const c = st.set.chords[k];
    const el = document.createElement("div");
    el.className = `kb-key ${isBlack(k) ? "black" : "white"}${isEmpty(c) ? " empty" : ""}${k === st.sel ? " sel" : ""}`;
    el.dataset.k = k;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `${keyName(k)}: ${isEmpty(c) ? "empty" : chordName(c)}`);
    const nm = isEmpty(c) ? "—" : chordName(c);
    const sz = st.view === "grid" ? "" : nm.length > 7 ? " l" : nm.length > 5 ? " m" : "";
    el.innerHTML = `<span class="cn${sz}">${esc(nm).replace("/", "/<wbr>")}</span><span class="kn">${keyName(k)}</span>`;
    if (sugs && !isEmpty(c) && sugs.has(chordName(c))) el.classList.add("sug-" + sugs.get(chordName(c)));
    const pv = isEmpty(c) ? null : prevChord(k);   // how it follows the key before: a coloured foot
    if (pv) el.classList.add("fit-" + TIERS[fitTier(c, pv)].id);
    if (st.view !== "grid" && isBlack(k)) {
      const wi = whites.filter((w) => w < k).length;   // between white wi-1 and wi
      el.style.left = `calc(${(wi / whites.length) * 100}% - ${(0.76 / whites.length) * 50}%)`;
      el.style.width = `${(0.76 / whites.length) * 100}%`;
    }
    kb.append(el);
  }
  litKeys();
}
function litKeys() {
  for (const el of document.querySelectorAll(".kb-key")) el.classList.toggle("hit", st.lit.has(+el.dataset.k));
}
const touches = new Map();
function keyDown(k, pointer) {
  if (pointer != null) touches.set(pointer, k);
  if (st.learn) return;
  st.sel = k;
  preview.start().then(soundBtn).catch(() => {});
  preview.post({ type: "key", key: k, vel: 100 });
  if (dev.connected && st.audition) dev.key(k, 100).catch(() => {});
  st.lit.set(k, 1);
  if (st.prog.rec) progRecord(k);
  showNow(k);
  renderKeys();
  if (st.tab === "chord" || st.tab === "harmony") renderPanel();
}
function keyUp(pointer) {
  const k = touches.get(pointer);
  if (k == null) return;
  touches.delete(pointer);
  preview.post({ type: "key", key: k, vel: 0 });
  if (dev.connected && st.audition) dev.key(k, 0).catch(() => {});
  if (!st.set.play.latch) st.lit.delete(k);
  else for (const x of [...st.lit.keys()]) if (x !== k || !st.lit.has(k)) st.lit.delete(x);
  litKeys();
}
function showNow(k) {
  const c = st.set.chords[k];
  const n = $("#nowplaying");
  if (isEmpty(c)) { n.innerHTML = `${keyName(k)} <small>empty — pick a chord below</small>`; return; }
  const notes = chordNotes(c, st.set.play.transpose + 12 * st.set.play.octave);
  n.innerHTML = `${esc(chordName(c))} <small>${INVERSION_LABELS[Math.min(c.inversion, 3)]} · ${VOICING_LABELS[c.voicing]} · ${notes.map(midiName).join(" ")}</small>`;
}
function bindKeys() {
  const kb = $("#kb");
  kb.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".kb-key");
    if (!el) return;
    e.preventDefault();
    try { kb.setPointerCapture(e.pointerId); } catch { /* */ }
    keyDown(+el.dataset.k, e.pointerId);
  });
  const up = (e) => keyUp(e.pointerId);
  kb.addEventListener("pointerup", up);
  kb.addEventListener("pointercancel", up);
  $("#oct-dn").onclick = () => setOct(-1);
  $("#oct-up").onclick = () => setOct(1);
  $("#v-keys").onclick = () => { st.view = "keys"; viewBtns(); renderKeys(); };
  $("#v-grid").onclick = () => { st.view = "grid"; viewBtns(); renderKeys(); };
}
function viewBtns() {
  $("#v-keys").classList.toggle("on", st.view === "keys"); $("#v-keys").setAttribute("aria-pressed", st.view === "keys");
  $("#v-grid").classList.toggle("on", st.view === "grid"); $("#v-grid").setAttribute("aria-pressed", st.view === "grid");
}
function setOct(d) {
  st.set.play.octave = Math.max(-3, Math.min(3, st.set.play.octave + d));
  octLabel(); markDirty();
  if (st.tab === "play") renderPanel();
}
function octLabel() { const o = st.set.play.octave; $("#oct-val").textContent = `OCT ${o > 0 ? "+" : ""}${o}`; }

// ------------------------------------------------------------------------------------------------- panels ---
const seg = (items, cur, attr, cls = "") =>
  `<div class="seg ${cls}">${items.map((t, i) => `<button data-${attr}="${i}" class="${i === cur ? "on" : ""}" aria-pressed="${i === cur}">${esc(t)}</button>`).join("")}</div>`;
const FMT = {};
// a knob (0.8): the dial is drawn over a range input, which keeps the keyboard and screen readers working
function knobArc(a0, a1) {
  const p = (a) => { const t = ((a - 90) * Math.PI) / 180; return [32 + 25 * Math.cos(t), 32 + 25 * Math.sin(t)]; };
  const s = p(a0), e = p(a1);
  return `M${s[0].toFixed(1)} ${s[1].toFixed(1)} A25 25 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
}
function knobSvg(v, lo, hi) {
  const a = -135 + (270 * (v - lo)) / Math.max(1, hi - lo), t = ((a - 90) * Math.PI) / 180;
  const z = lo < 0 && hi > 0 ? -135 + (270 * (0 - lo)) / (hi - lo) : -135;   // a ± knob draws from its middle
  const [a0, a1] = a < z ? [a, z] : [z, Math.max(a, z + 1)];
  return `<path class="kt" d="${knobArc(-135, 135)}"></path><path class="kv" d="${knobArc(a0, a1)}"></path>` +
    `<circle class="kc" cx="32" cy="32" r="16"></circle><line class="kp" x1="32" y1="32" x2="${(32 + 12 * Math.cos(t)).toFixed(1)}" y2="${(32 + 12 * Math.sin(t)).toFixed(1)}"></line>`;
}
const slider = (id, label, v, lo = 0, hi = 127, fmt = (x) => x) => (FMT[id] = fmt,
  `<div class="ctl knob"><svg viewBox="0 0 64 56" aria-hidden="true">${knobSvg(v, lo, hi)}</svg><input type="range" id="${id}" min="${lo}" max="${hi}" value="${v}" aria-label="${esc(label)}"><output for="${id}">${esc(fmt(v))}</output><label for="${id}">${esc(label)}</label></div>`);
// keep the dials in step with their inputs; drag a dial up or down (a slow drag is fine-grained)
document.addEventListener("input", (e) => {
  const r = e.target;
  if (r.matches && r.matches(".knob input[type=range]")) r.previousElementSibling.innerHTML = knobSvg(+r.value, +r.min, +r.max);
}, true);
document.addEventListener("pointerdown", (e) => {
  const r = e.target;
  if (!r.matches || !r.matches(".knob input[type=range]")) return;
  e.preventDefault();
  r.focus();
  const y0 = e.clientY, v0 = +r.value, lo = +r.min, hi = +r.max, id = e.pointerId;
  r.setPointerCapture(id);
  const move = (m) => {
    const v = Math.round(Math.max(lo, Math.min(hi, v0 + ((y0 - m.clientY) * (hi - lo)) / 180)));
    if (v !== +r.value) { r.value = v; r.dispatchEvent(new Event("input", { bubbles: true })); }
  };
  const up = () => {
    r.removeEventListener("pointermove", move); r.removeEventListener("pointerup", up); r.removeEventListener("pointercancel", up);
    r.dispatchEvent(new Event("change", { bubbles: true }));
  };
  r.addEventListener("pointermove", move); r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
});

function renderPanel() {
  const p = $("#panel");
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === st.tab);
  ({ chord: panelChord, harmony: panelHarmony, sound: panelSound, play: panelPlay, prog: panelProg, device: panelDevice })[st.tab](p);
}

// ---- chord ----
const IV_NAMES = ["R", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7", "8", "b9", "9", "#9", "10", "11", "#11", "12", "b13", "13", "b7'", "7'"];
// the chord on the nearest key below k with one (the chord this key follows), or null
function prevChord(k) { for (let m = k - 1; m >= 0; m--) if (!isEmpty(st.set.chords[m])) return st.set.chords[m]; return null; }
function fitTier(c, pv) { const { root, scale } = keyNow(); return rate(c, pv, root, scale, st.bias).tier; }
function panelChord(p) {
  const k = st.sel, c = st.set.chords[k];
  const empty = isEmpty(c);
  const pv = prevChord(k);
  const fit = !empty && pv ? fitTier(c, pv) : -1;
  const badge = pv ? (fit >= 0 ? `<span class="fitbadge ${TIERS[fit].id}">${TIERS[fit].label.toUpperCase()} after ${esc(chordName(pv))}</span>` :
    `<span class="fitbadge none">Choose a chord: the roots and types are coloured by how they follow ${esc(chordName(pv))}</span>`) :
    `<span class="fitbadge none">First chord: the next key is rated against this one</span>`;
  const notes = empty ? [] : chordNotes(c, st.set.play.transpose + 12 * st.set.play.octave);
  const qi = empty ? -1 : c.quality === Q_CUSTOM ? QUALITIES.length : c.quality;
  const mask = empty ? 0 : c.quality === Q_CUSTOM ? (c.custom[0] | (c.custom[1] << 8) | (c.custom[2] << 16)) :
    tones(c).reduce((m, x) => m | (1 << x), 0);
  p.innerHTML = `
    <div class="chordhead">
      <div><div class="hint">Key ${k + 1} · ${keyName(k)}</div>
        <div class="big">${empty ? "Empty key" : esc(chordName(c))}${empty ? "" : ` <span class="notes">${roman(c, st.set.keyRoot)}</span>`}</div>
        <div class="notes">${empty ? "Pick a root and a chord type to put a chord here." : notes.map(midiName).join("  ")}</div>
        <div style="margin-top: 8px">${badge}</div></div>
      <div class="row">
        <button id="c-play" ${empty ? "disabled" : ""}>▶ Hear it</button>
        <button id="c-learn" class="${st.learn ? "on" : ""}">${st.learn ? "Stop learning" : "Learn (play notes)"}</button>
        <button id="c-copy" ${empty ? "disabled" : ""}>Copy</button>
        <button id="c-paste" ${st.clip ? "" : "disabled"}>Paste</button>
        <button id="c-clear" ${empty ? "disabled" : ""}>Clear key</button>
      </div>
    </div>
    ${st.learn ? learnHTML() : ""}
    <h3>Root</h3>${seg(NOTE_NAMES, empty ? -1 : c.root, "root")}
    <h3>Chord type</h3>${seg([...QUALITIES.map((q) => q.s === "" ? "maj" : q.s === "5" ? "5 (power)" : q.s), "custom"], qi, "q", "qual")}
    ${!empty && c.quality === Q_CUSTOM ? `<h3>Custom notes (above the root)</h3>${seg(IV_NAMES, -1, "iv").replace(/data-iv="(\d+)" class=""/g, (m, i) => (mask >> i) & 1 ? `data-iv="${i}" class="on"` : m)}` : ""}
    <div class="cols">
      <div><h3>Inversion</h3>${seg(INVERSION_LABELS, empty ? -1 : c.inversion, "inv")}</div>
      <div><h3>Voicing</h3>${seg(VOICING_LABELS, empty ? -1 : c.voicing, "voi")}</div>
    </div>
    <div class="cols">
      <div><h3>Bass note (slash chord)</h3>${seg(["none", ...NOTE_NAMES], empty ? -1 : c.bass === NOBASS ? 0 : c.bass + 1, "bass")}</div>
      <div><h3>This chord's octave</h3>${seg(["−2", "−1", "0", "+1", "+2"], empty ? -1 : c.octave + 2, "oct")}</div>
    </div>`;
  if (pv) {                                        // every root and type you could try, coloured by how it follows
    const base = empty ? { root: st.set.keyRoot, quality: pv.quality === Q_CUSTOM ? 0 : pv.quality, custom: [0, 0, 0],
      inversion: 0, voicing: 0, bass: NOBASS, octave: 0 } : { ...c, bass: NOBASS };
    p.querySelectorAll("[data-root]").forEach((b) => b.classList.add("t-" + TIERS[fitTier({ ...base, root: +b.dataset.root }, pv)].id));
    if (base.quality !== Q_CUSTOM)
      p.querySelectorAll("[data-q]").forEach((b) => {
        if (+b.dataset.q < QUALITIES.length) b.classList.add("t-" + TIERS[fitTier({ ...base, quality: +b.dataset.q }, pv)].id);
      });
  }
  const edit = (f) => {
    let ch = st.set.chords[k];
    if (isEmpty(ch)) ch = st.set.chords[k] = { root: st.set.keyRoot, quality: 0, custom: [0, 0, 0], inversion: 0, voicing: 0, bass: NOBASS, octave: 0 };
    f(ch);
    markDirty(); renderKeys(); renderPanel(); showNow(k); audition(k);
  };
  p.querySelectorAll("[data-root]").forEach((b) => (b.onclick = () => edit((ch) => { ch.root = +b.dataset.root; })));
  p.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => edit((ch) => {
    const q = +b.dataset.q;
    if (q === QUALITIES.length) {
      const m = isEmpty(ch) || ch.quality === Q_CUSTOM ? 0x91 : tones(ch).reduce((a, x) => a | (1 << x), 0);
      if (ch.quality !== Q_CUSTOM) ch.custom = [m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff];
      ch.quality = Q_CUSTOM;
    } else ch.quality = q;
  })));
  p.querySelectorAll("[data-iv]").forEach((b) => (b.onclick = () => edit((ch) => {
    let m = ch.custom[0] | (ch.custom[1] << 8) | (ch.custom[2] << 16);
    m ^= 1 << +b.dataset.iv;
    m |= 1;                                           // the root stays
    ch.custom = [m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff];
  })));
  p.querySelectorAll("[data-inv]").forEach((b) => (b.onclick = () => edit((ch) => { ch.inversion = +b.dataset.inv; })));
  p.querySelectorAll("[data-voi]").forEach((b) => (b.onclick = () => edit((ch) => { ch.voicing = +b.dataset.voi; })));
  p.querySelectorAll("[data-bass]").forEach((b) => (b.onclick = () => edit((ch) => { const v = +b.dataset.bass; ch.bass = v ? v - 1 : NOBASS; })));
  p.querySelectorAll("[data-oct]").forEach((b) => (b.onclick = () => edit((ch) => { ch.octave = +b.dataset.oct - 2; })));
  $("#c-play").onclick = () => audition(k, 900);
  $("#c-copy").onclick = () => { st.clip = { ...c, custom: [...c.custom] }; toast(`Copied ${chordName(c)}`); renderPanel(); };
  $("#c-paste").onclick = () => { st.set.chords[k] = { ...st.clip, custom: [...st.clip.custom] }; markDirty(); renderKeys(); renderPanel(); showNow(k); audition(k); };
  $("#c-clear").onclick = () => { st.set.chords[k] = emptyChord(); markDirty(); renderKeys(); renderPanel(); showNow(k); };
  $("#c-learn").onclick = () => { st.learn = st.learn ? null : { held: new Set(), got: [] }; renderPanel(); };
  if (st.learn) bindLearn(p);
}

// ---- learn: tap notes on the small keyboard below (or play a MIDI keyboard); when all are let go, it's the chord ----
function learnHTML() {
  const got = st.learn.got.length ? st.learn.got.map(midiName).join(" ") : "nothing yet";
  let keys = "", whites = 0;
  const lo = 48, hi = 83;
  for (let n = lo; n <= hi; n++) if (![1, 3, 6, 8, 10].includes(n % 12)) whites++;
  let w = 0;
  for (let n = lo; n <= hi; n++) {
    const b = [1, 3, 6, 8, 10].includes(n % 12);
    const on = st.learn.held.has(n) ? " on" : "";
    if (b) keys += `<div class="mk b${on}" data-n="${n}" style="left:calc(${(w / whites) * 100}% - ${(0.6 / whites) * 50}%);width:${(0.6 / whites) * 100}%"></div>`;
    else { keys += `<div class="mk${on}" data-n="${n}">${n % 12 === 0 ? midiName(n) : ""}</div>`; w++; }
  }
  return `<div class="callout" style="margin-top:12px"><b>Learn:</b> hold the notes of a chord on these keys (or on a MIDI keyboard), then let go. It goes on key ${st.sel + 1}. Played: <b id="learn-got">${esc(got)}</b>
    <div class="mini" id="mini">${keys}</div></div>`;
}
function learnNote(n, on) {
  const L = st.learn;
  if (!L) return;
  if (on) { L.held.add(n); L.got = [...new Set([...L.got, n])].sort((a, b) => a - b); }
  else L.held.delete(n);
  preview.post({ type: "notes", notes: [...L.held], vel: 100 });
  for (const el of document.querySelectorAll("#mini .mk")) el.classList.toggle("on", L.held.has(+el.dataset.n));
  const g = $("#learn-got"); if (g) g.textContent = L.got.map(midiName).join(" ");
  if (!on && !L.held.size && L.got.length) {
    const c = identify(L.got);
    st.set.chords[st.sel] = c;
    toast(`Learnt ${chordName(c)} on key ${st.sel + 1}`);
    L.got = [];
    markDirty(); renderKeys(); showNow(st.sel); renderPanel();
  }
}
function bindLearn(p) {
  const mini = $("#mini", p);
  const held = new Map();
  mini.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".mk"); if (!el) return;
    e.preventDefault(); preview.start().then(soundBtn).catch(() => {});
    held.set(e.pointerId, +el.dataset.n); learnNote(+el.dataset.n, true);
  });
  const up = (e) => { const n = held.get(e.pointerId); if (n == null) return; held.delete(e.pointerId); learnNote(n, false); };
  mini.addEventListener("pointerup", up); mini.addEventListener("pointercancel", up);
}

function audition(k, ms = 600) {
  const c = st.set.chords[k];
  if (isEmpty(c)) return;
  preview.start().then(soundBtn).catch(() => {});
  preview.post({ type: "key", key: k, vel: 100 });
  st.lit.set(k, 1); litKeys();
  setTimeout(() => { preview.post({ type: "key", key: k, vel: 0 }); if (!st.set.play.latch) { st.lit.delete(k); litKeys(); } }, ms);
}
function hear(c, ms = 900) {
  preview.start().then(soundBtn).catch(() => {});
  const notes = chordNotes(c, st.set.play.transpose + 12 * st.set.play.octave);
  preview.post({ type: "notes", notes, vel: 100 });
  clearTimeout(hear.t);
  hear.t = setTimeout(() => preview.post({ type: "notes", notes: [] }), ms);
}

// ---- suggestions ----
function keyNow() {
  if (st.keyAuto) { const d = detectKey(st.set.chords); return { root: d.root, scale: d.scale }; }
  return { root: st.set.keyRoot, scale: st.set.keyScale };
}
function currentSuggestions() {
  const { root, scale } = keyNow();
  return suggest(st.set.chords[st.sel], root, scale, { bias: st.bias, max: 27, far: 6 });
}
function currentSuggestionsMap() {
  const m = new Map();
  for (const s of currentSuggestions()) if (s.tier < 2 && !m.has(s.name)) m.set(s.name, TIERS[s.tier].id);
  return m;
}
function nextEmpty(from) {
  for (let i = 1; i <= NKEYS; i++) { const k = (from + i) % NKEYS; if (isEmpty(st.set.chords[k])) return k; }
  return -1;
}
function panelHarmony(p) {
  const sel = st.set.chords[st.sel];
  const { root, scale } = keyNow();
  const det = detectKey(st.set.chords);
  const list = currentSuggestions();
  const ne = nextEmpty(st.sel);
  p.innerHTML = `
    <div class="sugbar">
      <label class="lbl"><b>Key</b></label>
      <select id="h-root" ${st.keyAuto ? "disabled" : ""}>${NOTE_NAMES.map((n, i) => `<option value="${i}" ${i === root ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select id="h-scale" ${st.keyAuto ? "disabled" : ""}>${SCALE_LABELS.map((n, i) => `<option value="${i}" ${i === scale ? "selected" : ""}>${n}</option>`).join("")}</select>
      <button id="h-auto" class="${st.keyAuto ? "on" : ""}" aria-pressed="${st.keyAuto}">Detect from my chords${st.keyAuto ? ": " + esc(keyLabel(det.root, det.scale)) : ""}</button>
      <button id="h-bias" class="${st.bias ? "on" : ""}" aria-pressed="${st.bias}">Dark jungle / DnB bias</button>
    </div>
    <div class="sugbar">
      <button id="h-next" class="primary">Suggest next chord</button>
      <button id="h-expand" class="primary">Expand my progression</button>
      <button id="h-fill">Fill the empty keys</button>
      <button id="h-fillall">Refill every key</button>
      <span class="hint">Suggestions for <b>${isEmpty(sel) ? `the key of ${esc(keyLabel(root, scale))}` : esc(chordName(sel))}</b> on key ${st.sel + 1}. Tap ▶ to hear one, then put it on a key.</span>
    </div>
    <div class="legend"><span class="pill green">Strong</span> in the key, a common move, or shares notes
      <span class="pill amber">OK</span> works with care: borrowed, secondary dominant, phrygian
      <span class="pill red">Far</span> far round the circle of fifths, few shared notes</div>
    <div class="sugs">${list.map((s, i) => `
      <div class="sug ${TIERS[s.tier].id}${st.picked === s.name ? " picked" : ""}" data-i="${i}">
        <div class="top2"><span class="nm">${esc(s.name)}</span><span class="pill ${TIERS[s.tier].id}">${TIERS[s.tier].label}</span></div>
        <div class="rn">${esc(s.roman)}</div>
        <div class="why">${esc(s.why.join(" · ") || "—")}</div>
        <div class="acts"><button data-hear="${i}">▶ Hear</button>
          <button data-put="${i}">Put on key ${st.sel + 1}</button>
          ${ne >= 0 && ne !== st.sel ? `<button data-putn="${i}">On key ${ne + 1} (next empty)</button>` : ""}</div>
      </div>`).join("")}</div>`;
  $("#h-root").onchange = (e) => { st.set.keyRoot = +e.target.value; markDirty(); renderPanel(); renderKeys(); };
  $("#h-scale").onchange = (e) => { st.set.keyScale = +e.target.value; markDirty(); renderPanel(); renderKeys(); };
  $("#h-auto").onclick = () => {
    st.keyAuto = !st.keyAuto;
    if (st.keyAuto) { st.set.keyRoot = det.root; st.set.keyScale = det.scale; markDirty(); }
    renderPanel(); renderKeys();
  };
  $("#h-bias").onclick = () => { st.bias = !st.bias; renderPanel(); renderKeys(); };
  const put = (s, k) => {
    st.set.chords[k] = { ...s.chord, custom: [0, 0, 0] };
    markDirty(); toast(`${s.name} on key ${k + 1}`); renderKeys(); renderPanel();
  };
  p.querySelectorAll("[data-hear]").forEach((b) => (b.onclick = () => { const s = list[+b.dataset.hear]; st.picked = s.name; hear(s.chord); p.querySelectorAll(".sug").forEach((x) => x.classList.toggle("picked", x.dataset.i === b.dataset.hear)); }));
  p.querySelectorAll("[data-put]").forEach((b) => (b.onclick = () => put(list[+b.dataset.put], st.sel)));
  p.querySelectorAll("[data-putn]").forEach((b) => (b.onclick = () => put(list[+b.dataset.putn], ne)));
  $("#h-next").onclick = () => {
    const s = suggestNext(sel, root, scale, { bias: st.bias, nth: st.pickNth++ });
    if (!s) return;
    st.picked = s.name; hear(s.chord);
    const k = nextEmpty(st.sel);
    toast(k >= 0 ? `Try ${s.name}: tap "On key ${k + 1}" to keep it` : `Try ${s.name}`);
    renderPanel();
  };
  const fill = (all) => {
    if (all && !confirm("Replace every chord in this set with suggestions?")) return;
    st.set.chords = fillSet(st.set.chords, root, scale, { bias: st.bias, all, seed: st.pickNth++ });
    markDirty(); renderKeys(); renderPanel(); toast(all ? "Every key refilled" : "Empty keys filled");
  };
  $("#h-expand").onclick = () => {
    const n = st.set.chords.filter((c) => !isEmpty(c)).length;
    if (!n) return toast("Put your progression on some keys first (or paste chords: the Paste chords button)");
    const k = st.keyAuto ? detectKey(st.set.chords) : { root, scale };
    const r = expandSet(st.set.chords, k.root, k.scale, { bias: st.bias, seed: st.pickNth++ });
    if (!r.made.length) return toast("No empty keys to fill");
    st.set.chords = r.chords;
    markDirty(); renderKeys(); renderPanel();
    toast(expandSummary(r.made, n));
  };
  $("#h-fill").onclick = () => fill(false);
  $("#h-fillall").onclick = () => fill(true);
}

function expandSummary(made, n) {
  const rows = [...new Set(made.filter((m) => m.row !== "new").map((m) => m.row))];
  const fresh = made.filter((m) => m.row === "new").length;
  return `Your ${n} chords, again as: ${rows.join(", ") || "-"}${fresh ? `, plus ${fresh} new chords that fit` : ""}`;
}

// ---- paste chords: chord sets from text (0.4) ----
function importedSet(r, expand) {
  const s = newSet(r.name);
  s.sound = { ...st.set.sound }; s.play = { ...st.set.play }; s.tempo = st.set.tempo;
  const whites = [...Array(NKEYS).keys()].filter((k) => !isBlack(k));
  const keys = r.chords.length <= whites.length ? whites : [...Array(NKEYS).keys()];   // white keys from F3
  r.chords.forEach((c, i) => { if (i < keys.length) s.chords[keys[i]] = { ...c, custom: [...c.custom] }; });
  const k = detectKey(s.chords);
  s.keyRoot = k.root; s.keyScale = k.scale;
  if (expand) s.chords = expandSet(s.chords, k.root, k.scale, { bias: st.bias }).chords;
  return s;
}
function pasteDialog() {
  const d = $("#imp");
  let found = [];
  const step1 = () => {
    d.innerHTML = `<form method="dialog" class="imp">
      <h2>Paste chords</h2>
      <p class="hint">Chords as you'd write them: <b>Am F C G</b>, <b>Fm9 | Dbmaj7 | Ebsus4</b>, <b>CΔ7 F#ø B7(b9)</b>. Give a set a name with <b>Name: chords</b> or a line of its own above them; a blank line starts the next set.</p>
      <textarea id="imp-text" rows="9" spellcheck="false" autocapitalize="off" placeholder="Verse: Am7 Dm7 G7 Cmaj7&#10;&#10;Chorus&#10;F C/E Dm Bb">${esc(pasteDialog.text || "")}</textarea>
      <div class="row">
        <button type="button" id="imp-file">Open a text file</button>
        <input type="file" id="imp-f" accept=".txt,.text,.md,text/plain" hidden>
        <label class="chk"><input type="checkbox" id="imp-exp" ${pasteDialog.expand !== false ? "checked" : ""}> Fill the other keys from each progression (richer, sus, inversions, slash basses, chords that fit)</label>
      </div>
      <div class="row end"><button value="cancel">Cancel</button><button type="button" id="imp-read" class="primary">Read chords</button></div>
    </form>`;
    $("#imp-file").onclick = () => $("#imp-f").click();
    $("#imp-f").onchange = async (e) => { const f = e.target.files[0]; if (f) $("#imp-text").value = await f.text(); };
    $("#imp-read").onclick = () => {
      pasteDialog.text = $("#imp-text").value; pasteDialog.expand = $("#imp-exp").checked;
      found = readChordText(pasteDialog.text);
      if (!found.some((r) => r.chords.length)) { toast("No chords found in that text"); return; }
      step2();
    };
  };
  const step2 = async () => {
    const ok = found.filter((r) => r.chords.length);
    let free = [];
    if (dev.connected) { try { free = (await dev.names()).filter((n) => !n.used).map((n) => n.slot); } catch { free = []; } }
    const toFM1 = Math.min(free.length, ok.length);
    d.innerHTML = `<form method="dialog" class="imp">
      <h2>${ok.length} chord set${ok.length > 1 ? "s" : ""} found</h2>
      <ul class="implist">${found.map((r) => `<li><b>${esc(r.name)}</b> · ${r.chords.length} chord${r.chords.length === 1 ? "" : "s"}
        <div>${r.chords.map((c) => esc(chordName(c))).join("  ")}</div>
        ${r.bad.length ? `<div class="bad">Couldn't read: ${r.bad.map(esc).join("  ")}</div>` : ""}
        ${r.merged ? `<div class="hint">${r.merged} repeat${r.merged > 1 ? "s" : ""} merged: each chord gets one key</div>` : ""}</li>`).join("")}</ul>
      <p class="hint">${pasteDialog.expand ? "The other keys get filled from each progression." : "Only these chords go on keys (white keys from the bottom)."}</p>
      ${dev.connected ? `<p><b>Save these to the FM-1 as new user sets?</b> ${free.length ? `It has ${free.length} empty slot${free.length > 1 ? "s" : ""}${toFM1 < ok.length ? `: the first ${toFM1} go there` : ""}. Nothing on it is replaced.` : "It has no empty user slots: they go to My sets only."}</p>` :
        `<p class="hint">Connect the FM-1 (FM-1 tab) to save them there too.</p>`}
      <div class="row end"><button type="button" id="imp-back">Back</button>
        <button type="button" id="imp-mine">Save to My sets</button>
        ${toFM1 ? `<button type="button" id="imp-fm1" class="primary">Save to My sets and the FM-1</button>` : ""}</div>
    </form>`;
    $("#imp-back").onclick = step1;
    const save = async (fm1) => {
      const sets = ok.map((r) => importedSet(r, pasteDialog.expand));
      const first = st.mine.length;
      st.mine.push(...sets.map(cloneSet)); saveMine();
      let sent = 0;
      if (fm1) {
        for (let i = 0; i < toFM1; i++) {
          try { await dev.putSet(free[i], sets[i]); sent++; } catch (e) { toast(e.message); break; }
        }
      }
      d.close();
      st.dirty = false;
      openSet("mine", first);
      toast(`${sets.length} set${sets.length > 1 ? "s" : ""} saved in My sets${fm1 ? `, ${sent} on the FM-1 (user ${free.slice(0, sent).map((x) => x + 1).join(", ")})` : ""}`);
    };
    $("#imp-mine").onclick = () => save(false);
    if ($("#imp-fm1")) $("#imp-fm1").onclick = () => save(true);
  };
  if (st.dirty && !confirm("This set has changes that aren't saved. Paste chords anyway? (The new sets open after.)")) return;
  step1();
  d.showModal();
}

// ---- sound ----
const WAVE_LABELS = ["Saw", "Square", "Triangle", "Sine", "Organ", "Pulse", "Supersaw", "Noise", "WT Vox",
  "WT PWM", "WT Digital", "WT Glass"];
// sampler-era settings for the crusher: bits and rate bytes (fc_sound3_t)
const ERAS = [["Clean", 0, 0], ["SP-1200", 39, 19], ["MPC60", 39, 4], ["S950", 39, 12], ["Amiga", 78, 16]];
// the sound's part 2 (0.6): macros, filter mode and drive, LFOs, the mod envelope, the matrix, the delay
const FMODE_LABELS = ["Low-pass", "Band-pass", "High-pass", "Notch"];
const LWAVE_LABELS = ["Sine", "Triangle", "Saw", "Square", "Random (S&H)"];
const MSRC_LABELS = ["—", "LFO 1", "LFO 2", "Mod envelope", "Velocity", "Key (pitch)", "Macro 1", "Macro 2", "Macro 3", "Macro 4"];
const MDST_LABELS = ["—", "Pitch", "Cutoff", "Resonance", "Osc B level", "FM amount", "Pulse width", "Volume", "Detune",
  "Sub level", "Drive", "Filter env amount", "LFO 1 speed", "Delay mix", "Reverb mix", "Chorus", "WT position",
  "Supersaw spread", "Osc B pitch"];
const DIV_LABELS = DIVS;
function lfoRateText(x, i, v) {
  if (x.lfo_sync[i]) return DIV_LABELS[14 - ((v * 15) >> 7)];
  const hz = 0.03 * Math.pow(2, (v * 10) / 127);
  return hz < 1 ? `${hz.toFixed(2)}Hz` : `${hz.toFixed(1)}Hz`;
}
function macroName(x, i) {                         // what the macro moves first: its label on the FM-1 too
  const m = x.mod.find((q) => q.src === 6 + i && q.dst && q.amt);
  return m ? MDST_LABELS[m.dst] : "not used";
}
function s3Html(t, pct) {
  const bits = (v) => (v ? `${16 - Math.round((v * 13) / 127)}-bit` : "off");
  const rate = (v) => (v ? `${(44.1 * Math.pow(2, (-v * 5) / 127)).toFixed(1)}k` : "off");
  const era = ERAS.findIndex(([, b, r]) => b === t.crush_bits && r === t.crush_rate);
  return `
    <div class="cols">
      <div><h3>Oscillators, more</h3>
        ${slider("t-wt_pos", "WT position", t.wt_pos, 0, 127, pct)}
        ${slider("t-spread", "Supersaw spread", t.spread, 0, 127, pct)}
        ${slider("t-b_semi", "Osc B tune", t.b_semi, -24, 24, (v) => (v > 0 ? "+" : "") + v + " st")}
        <div class="field"><label>Osc B</label>${seg(["Added", "Synced to A", "Ring mod"], t.osc_mode, "omode")}</div>
        <p class="hint">Synced and ring: <b>B level</b> fades from plain A to the effect. Wavetables sweep with WT position (try an LFO on it).</p>
      </div>
      <div><h3>Lo-fi</h3>
        <div class="field"><label>Era</label>${seg(ERAS.map((e) => e[0]), era, "era")}</div>
        ${slider("t-crush_bits", "Bits", t.crush_bits, 0, 127, bits)}
        ${slider("t-crush_rate", "Sample rate", t.crush_rate, 0, 127, rate)}
        ${slider("t-wobble", "Tape wobble", t.wobble, 0, 127, pct)}
        <h3>Chorus mode and phaser</h3>
        ${seg(["Chorus I", "Chorus II", "Chorus I+II"], t.chorus_mode, "cmode")}
        ${slider("t-phaser", "Phaser", t.phaser, 0, 63, (v) => Math.round((v * 100) / 63))}
      </div>
    </div>`;
}
function bindS3(p, t) {
  const redo = () => { markDirty(); renderPanel(); audition(st.sel); };
  p.querySelectorAll("[data-omode]").forEach((b) => (b.onclick = () => { t.osc_mode = +b.dataset.omode; redo(); }));
  p.querySelectorAll("[data-cmode]").forEach((b) => (b.onclick = () => { t.chorus_mode = +b.dataset.cmode; redo(); }));
  p.querySelectorAll("[data-era]").forEach((b) => (b.onclick = () => {
    const e = ERAS[+b.dataset.era]; t.crush_bits = e[1]; t.crush_rate = e[2]; redo();
  }));
  bindSliders(p, "t-", t, () => {});
}
function sx2Html(x, pct, time) {
  const amt = (v) => (v > 0 ? "+" : "") + Math.round((v * 100) / 127) + "%";
  return `
    <h3>Macros <span class="hint">(K1–K4 on the FM-1's MACRO page: HOME twice)</span></h3>
    <div class="cols macros">${x.macro.map((v, i) => slider(`mc${i}`, `Macro ${i + 1} · ${macroName(x, i)}`, v, 0, 127, pct)).join("")}</div>
    <div class="cols">
      <div><h3>Filter type</h3>
        ${seg(FMODE_LABELS, x.flt_mode, "fmode")}
        <div class="field"><label>Slope</label>${seg(["12 dB (smooth)", "24 dB (steep)"], x.flt_slope, "fslope")}</div>
        ${slider("x-drive", "Drive", x.drive, 0, 127, pct)}
      </div>
      ${[0, 1].map((i) => `<div><h3>LFO ${i + 1}</h3>
        ${seg(LWAVE_LABELS, x.lfo_wave[i], `lw${i}`)}
        <div class="field"><label>Speed</label>${seg(["Free (Hz)", "To the tempo"], x.lfo_sync[i], `ls${i}`)}</div>
        ${slider(`lr${i}`, "Rate", x.lfo_rate[i], 0, 127, (v) => lfoRateText(x, i, v))}
      </div>`).join("")}
      <div><h3>Mod envelope</h3>
        ${slider("x-menv_a", "Attack", x.menv_a, 0, 127, time)}${slider("x-menv_d", "Decay", x.menv_d, 0, 127, time)}
        ${slider("x-menv_s", "Sustain", x.menv_s, 0, 127, pct)}${slider("x-menv_r", "Release", x.menv_r, 0, 127, time)}
      </div>
      <div><h3>Delay</h3>
        <div class="field"><label>Time</label>${seg(DIV_LABELS.slice(0, DLY_MAX + 1), x.dly_time, "dtime", "small")}</div>
        ${slider("x-dly_mix", "Mix", x.dly_mix, 0, 127, (v) => (v ? pct(v) : "off"))}
        ${slider("x-dly_fb", "Feedback", x.dly_fb, 0, 127, pct)}
        ${slider("x-dly_tone", "Tone", x.dly_tone, 0, 127, (v) => { const hz = 500 * Math.pow(2, (v * 5) / 127); return hz < 1000 ? Math.round(hz) + " Hz" : (hz / 1000).toFixed(1) + "k"; })}
        <div class="field"><label>Mode</label>${seg(["Stereo", "Ping-pong"], x.dly_mode, "dmode")}</div>
      </div>
    </div>
    <h3>Modulation <span class="hint">(what moves what: six slots)</span></h3>
    <div class="matrix">${x.mod.map((m, i) => `<div class="mrow">
      <span class="mnum">${i + 1}</span>
      <select id="ms${i}" aria-label="Slot ${i + 1} source">${MSRC_LABELS.map((t, j) => `<option value="${j}" ${j === m.src ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <span class="marrow">moves</span>
      <select id="md${i}" aria-label="Slot ${i + 1} destination">${MDST_LABELS.map((t, j) => `<option value="${j}" ${j === m.dst ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      ${slider(`ma${i}`, "by", m.amt, -127, 127, amt)}
    </div>`).join("")}</div>`;
}
function bindSx2(p, x) {
  const redo = () => { markDirty(); renderPanel(); audition(st.sel); };
  const on = (sel, fn) => p.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
  on("[data-fmode]", (b) => { x.flt_mode = +b.dataset.fmode; redo(); });
  on("[data-fslope]", (b) => { x.flt_slope = +b.dataset.fslope; redo(); });
  on("[data-dtime]", (b) => { x.dly_time = +b.dataset.dtime; redo(); });
  on("[data-dmode]", (b) => { x.dly_mode = +b.dataset.dmode; redo(); });
  for (const i of [0, 1]) {
    on(`[data-lw${i}]`, (b) => { x.lfo_wave[i] = +b.dataset[`lw${i}`]; redo(); });
    on(`[data-ls${i}]`, (b) => { x.lfo_sync[i] = +b.dataset[`ls${i}`]; redo(); });
  }
  bindSliders(p, "x-", x, () => {});
  const arr = (id, get, set) => {
    const r = p.querySelector(`#${id}`);
    if (!r) return;
    r.oninput = () => { set(+r.value); r.nextElementSibling.textContent = (FMT[id] || String)(+r.value); markDirty(); };
    r.onchange = () => audition(st.sel, 500);
  };
  x.macro.forEach((v, i) => arr(`mc${i}`, () => x.macro[i], (n) => { x.macro[i] = n; }));
  [0, 1].forEach((i) => arr(`lr${i}`, () => x.lfo_rate[i], (n) => { x.lfo_rate[i] = n; }));
  x.mod.forEach((m, i) => {
    arr(`ma${i}`, () => m.amt, (n) => { m.amt = n; });
    p.querySelector(`#ms${i}`).onchange = (e) => { m.src = +e.target.value; if (m.src && !m.amt) m.amt = 40; redo(); };
    p.querySelector(`#md${i}`).onchange = (e) => { m.dst = +e.target.value; if (m.dst && !m.amt) m.amt = 40; redo(); };
  });
}

function panelSound(p) {
  const o = st.set.sound, x = ensureSx(st.set).sx;
  const pct = (v) => Math.round((v / 127) * 100);
  const time = (v) => { const s = 0.001 * Math.pow(2, (v * 13) / 127); return s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(1)}s`; };
  p.innerHTML = `
    <h3>Start from</h3>
    <div class="seg">${st.sounds.map((s, i) => `<button data-snd="${i}" class="${o.type === i ? "on" : ""}">${esc(s.name)}</button>`).join("")}</div>
    <div class="cols">
      <div><h3>Oscillators</h3>
        <div class="field"><label>Wave A</label>${seg(WAVE_LABELS, o.wave_a, "wa")}</div>
        <div class="field"><label>Wave B</label>${seg(WAVE_LABELS, o.wave_b, "wb")}</div>
        ${slider("s-detune", "Detune B", o.detune, 0, 127, (v) => `${Math.round((v * 50) / 127)}¢`)}
        ${slider("s-b_level", "B level", o.b_level, 0, 127, pct)}
        ${slider("s-sub", "Sub", o.sub, 0, 127, pct)}
        ${slider("s-fm", "FM (B on A)", o.fm, 0, 127, pct)}
      </div>
      <div><h3>Filter</h3>
        ${slider("s-cutoff", "Cutoff", o.cutoff, 0, 127, (v) => { const hz = 20 * Math.pow(2, (v * 9.8) / 127); return hz < 1000 ? Math.round(hz) : (hz / 1000).toFixed(1) + "k"; })}
        ${slider("s-res", "Resonance", o.res, 0, 127, pct)}
        ${slider("s-fenv", "Envelope", o.fenv, 0, 127, pct)}
        ${slider("s-ftrack", "Key track", o.ftrack, 0, 127, pct)}
      </div>
      <div><h3>Amp envelope</h3>
        ${slider("s-amp_a", "Attack", o.amp_a, 0, 127, time)}${slider("s-amp_d", "Decay", o.amp_d, 0, 127, time)}
        ${slider("s-amp_s", "Sustain", o.amp_s, 0, 127, pct)}${slider("s-amp_r", "Release", o.amp_r, 0, 127, time)}
      </div>
      <div><h3>Filter envelope</h3>
        ${slider("s-flt_a", "Attack", o.flt_a, 0, 127, time)}${slider("s-flt_d", "Decay", o.flt_d, 0, 127, time)}
        ${slider("s-flt_s", "Sustain", o.flt_s, 0, 127, pct)}${slider("s-flt_r", "Release", o.flt_r, 0, 127, time)}
      </div>
      <div><h3>Chorus and reverb</h3>
        ${slider("s-chorus", "Chorus", o.chorus, 0, 127, pct)}${slider("s-rev_mix", "Reverb", o.rev_mix, 0, 127, pct)}
        ${slider("s-rev_size", "Room size", o.rev_size, 0, 127, pct)}
      </div>
      <div><h3>Output</h3>
        ${slider("s-level", "Level", o.level, 0, 127, pct)}${slider("s-vel_sens", "Velocity", o.vel_sens, 0, 127, pct)}
      </div>
    </div>
    ${s3Html(st.set.s3, pct)}
    ${sx2Html(x, pct, time)}`;
  p.querySelectorAll("[data-snd]").forEach((b) => (b.onclick = () => {
    const sn = st.sounds[+b.dataset.snd];
    st.set.sound = { ...sn.sound }; st.set.sx = structuredClone(sn.sx); st.set.s3 = { ...sn.s3 };
    markDirty(); renderPanel(); audition(st.sel);
  }));
  bindSx2(p, x);
  bindS3(p, st.set.s3);
  p.querySelectorAll("[data-wa]").forEach((b) => (b.onclick = () => { o.wave_a = +b.dataset.wa; markDirty(); renderPanel(); audition(st.sel); }));
  p.querySelectorAll("[data-wb]").forEach((b) => (b.onclick = () => { o.wave_b = +b.dataset.wb; markDirty(); renderPanel(); audition(st.sel); }));
  bindSliders(p, "s-", o, () => {});
}
function bindSliders(p, prefix, obj, after) {
  p.querySelectorAll(`input[type=range][id^="${prefix}"]`).forEach((r) => {
    const f = r.id.slice(prefix.length), out = r.nextElementSibling;
    r.oninput = () => {
      obj[f] = +r.value;
      out.textContent = (FMT[r.id] || String)(+r.value);
      markDirty();
      after(f);
    };
    r.onchange = () => audition(st.sel, 500);
  });
}

// ---- playing ----
function panelPlay(p) {
  const pl = st.set.play;
  p.innerHTML = `
    <div class="cols">
      <div><h3>How a key plays</h3>${seg(["Chord", "Strum", "Arpeggio"], pl.mode, "mode")}
        <h3>Strum</h3>${slider("p-strum", "Speed", pl.strum, 0, 127, (v) => `${v * 2}ms`)}
        <div class="field"><label>Direction</label>${seg(["Up", "Down", "Alternate"], pl.strum_dir, "sdir")}</div>
        <h3>Arpeggio</h3>
        <div class="field"><label>Rate</label>${seg(RATES, pl.arp_rate, "rate")}</div>
        <div class="field"><label>Direction</label>${seg(["Up", "Down", "Up-down", "Random"], pl.arp_dir, "adir")}</div>
        <div class="field"><label>Octaves</label>${seg(["1", "2", "3"], pl.arp_oct - 1, "aoct")}</div>
        ${slider("p-arp_gate", "Gate", pl.arp_gate, 5, 100, (v) => `${v}%`)}
      </div>
      <div><h3>Holding and moving</h3>
        <div class="row"><button id="p-latch" class="${pl.latch ? "on" : ""}" aria-pressed="${!!pl.latch}">Latch (hold)</button>
          <button id="p-vl" class="${pl.voice_lead ? "on" : ""}" aria-pressed="${!!pl.voice_lead}">Auto voice leading</button></div>
        <p class="hint">Latch keeps a chord sounding after you let go; the same key again stops it. Voice leading moves each chord to the inversion and octave nearest the last one.</p>
        ${slider("p-humanise", "Humanise", pl.humanise, 0, 127, (v) => `±${Math.round((v * 40) / 127)}`)}
        ${slider("p-transpose", "Transpose set", pl.transpose, -12, 12, (v) => (v > 0 ? "+" : "") + v)}
        ${slider("p-octave", "Octave", pl.octave, -3, 3, (v) => (v > 0 ? "+" : "") + v)}
        ${slider("p-tempo", "Tempo", st.set.tempo, 40, 250, (v) => v)}
        <h3>Preview</h3>
        <div class="row"><button id="p-local" class="${st.local ? "on" : ""}" aria-pressed="${st.local}">Sound in this browser</button>
          <select id="p-midiout"><option value="">MIDI out: none</option></select></div>
        <p class="hint">Send the preview's notes to another synth over MIDI (Chrome / Edge, or the iPad app).</p>
      </div>
    </div>`;
  const set = (f, v) => { pl[f] = v; markDirty(); renderPanel(); };
  p.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => set("mode", +b.dataset.mode)));
  p.querySelectorAll("[data-sdir]").forEach((b) => (b.onclick = () => set("strum_dir", +b.dataset.sdir)));
  p.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = () => set("arp_rate", +b.dataset.rate)));
  p.querySelectorAll("[data-adir]").forEach((b) => (b.onclick = () => set("arp_dir", +b.dataset.adir)));
  p.querySelectorAll("[data-aoct]").forEach((b) => (b.onclick = () => set("arp_oct", +b.dataset.aoct + 1)));
  $("#p-latch").onclick = () => { set("latch", pl.latch ? 0 : 1); if (!pl.latch) { preview.post({ type: "stop" }); st.lit.clear(); litKeys(); } };
  $("#p-vl").onclick = () => set("voice_lead", pl.voice_lead ? 0 : 1);
  $("#p-local").onclick = () => { st.local = !st.local; preview.post({ type: "local", on: st.local }); renderPanel(); };
  bindSliders(p, "p-", pl, (f) => { if (f === "octave") octLabel(); });
  const t = $("#p-tempo");
  t.oninput = () => { st.set.tempo = +t.value; t.nextElementSibling.textContent = t.value; markDirty(); };
  fillMidiOuts($("#p-midiout"));
}
function fillMidiOuts(sel) {
  if (!access) { sel.disabled = true; sel.options[0].text = "MIDI out: connect MIDI first (FM-1 tab)"; return; }
  for (const o of access.outputs.values()) sel.append(new Option(`MIDI out: ${o.name}`, o.id));
  sel.value = st.midiOut ? st.midiOut.id : "";
  sel.onchange = () => { st.midiOut = sel.value ? access.outputs.get(sel.value) : null; };
}

// ---- progression ----
function stepName(s) { const c = st.set.chords[s.key]; return isEmpty(c) ? `key ${s.key + 1}` : chordName(c); }
function panelProg(p) {
  const pr = st.prog;
  const total = pr.steps.reduce((a, s) => a + s.beats, 0);
  p.innerHTML = `
    <div class="sugbar">
      <button id="g-rec" class="rec ${pr.rec ? "on" : ""}" aria-pressed="${pr.rec}">${pr.rec ? "● Recording — press keys" : "● Record"}</button>
      <button id="g-play" class="${pr.playing ? "on" : ""}">${pr.playing ? "■ Stop" : "▶ Play"}</button>
      <button id="g-add">+ Add key ${st.sel + 1}</button>
      <button id="g-clear" ${pr.steps.length ? "" : "disabled"}>Clear</button>
      <button id="g-mid" class="primary" ${pr.steps.length ? "" : "disabled"}>Export MIDI file</button>
      <span class="hint">${pr.steps.length} chords, ${total} beats at ${st.set.tempo} BPM</span>
    </div>
    <p class="hint">Record: press chord keys in time; each chord lasts until the next press (rounded to beats). Or add the selected key's chord and set its length.</p>
    <div class="steps">${pr.steps.map((s, i) => `<div class="step${pr.at === i ? " now" : ""}"><span class="nm">${esc(stepName(s))}</span>
      <button data-bm="${i}" aria-label="Shorter">−</button><b>${s.beats}</b> beat${s.beats === 1 ? "" : "s"}<button data-bp="${i}" aria-label="Longer">+</button>
      <button data-del="${i}" aria-label="Remove">✕</button></div>`).join("") || '<span class="hint">No chords yet.</span>'}</div>
    <h3>Rhythm phrase</h3>
    <div class="phrases">${PHRASES.map((ph, i) => {
      const bars = Array.from({ length: 16 }, (_, j) => (ph.hits.some(([s, l]) => j >= s && j < s + l) ? '<i class="h"></i>' : "<i></i>")).join("");
      return `<button class="phrase ${pr.phrase === i ? "on" : ""}" data-ph="${i}" aria-pressed="${pr.phrase === i}"><span>${esc(ph.name)}</span><span class="bar">${bars}</span></button>`;
    }).join("")}</div>`;
  $("#g-rec").onclick = () => { pr.rec = !pr.rec; if (pr.rec) { stopProg(); pr.recKey = -1; } else progRecordEnd(); renderPanel(); };
  $("#g-play").onclick = () => (pr.playing ? stopProg() : playProg());
  $("#g-add").onclick = () => { pr.steps.push({ key: st.sel, beats: 4 }); renderPanel(); };
  $("#g-clear").onclick = () => { stopProg(); pr.steps = []; renderPanel(); };
  $("#g-mid").onclick = () => download(`${(st.set.name || "progression").trim().replace(/\s+/g, "-")}.mid`, toMidiFile(st.set, pr), "audio/midi");
  p.querySelectorAll("[data-bm]").forEach((b) => (b.onclick = () => { const s = pr.steps[+b.dataset.bm]; s.beats = Math.max(1, s.beats - 1); renderPanel(); }));
  p.querySelectorAll("[data-bp]").forEach((b) => (b.onclick = () => { const s = pr.steps[+b.dataset.bp]; s.beats = Math.min(32, s.beats + 1); renderPanel(); }));
  p.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { pr.steps.splice(+b.dataset.del, 1); renderPanel(); }));
  p.querySelectorAll("[data-ph]").forEach((b) => (b.onclick = () => { pr.phrase = +b.dataset.ph; renderPanel(); }));
}
function progRecord(k) {
  const pr = st.prog, now = performance.now();
  if (pr.recKey >= 0) {
    const beats = Math.max(1, Math.round(((now - pr.recT) / 60000) * st.set.tempo));
    pr.steps.push({ key: pr.recKey, beats });
  }
  pr.recKey = k; pr.recT = now;
  if (st.tab === "prog") renderPanel();
}
function progRecordEnd() {
  const pr = st.prog;
  if (pr.recKey >= 0) progRecord(-1);
  pr.recKey = -1;
}
function playProg() {
  const pr = st.prog;
  if (!pr.steps.length) return;
  preview.start().then(soundBtn).catch(() => {});
  const { events, beats } = renderProg(st.set, pr);
  const spb = 60 / st.set.tempo;
  pr.playing = true;
  let t0 = performance.now();
  const stepStarts = []; let acc = 0;
  for (const s of pr.steps) { stepStarts.push(acc); acc += s.beats; }
  let i = 0, offAt = 0, sounding = false;
  const tick = () => {
    if (!pr.playing) return;
    const b = (performance.now() - t0) / 1000 / spb;
    if (b >= beats) { t0 += beats * spb * 1000; i = 0; }
    const bb = (performance.now() - t0) / 1000 / spb;
    if (sounding && bb >= offAt) { preview.post({ type: "notes", notes: [] }); sounding = false; }
    while (i < events.length && events[i].t <= bb) {
      const e = events[i++];
      preview.post({ type: "notes", notes: e.notes, vel: 100 });
      sounding = true; offAt = e.t + e.len * 0.95;
      st.lit.clear(); st.lit.set(e.key, 1); litKeys();
    }
    let at = 0; for (let j = 0; j < stepStarts.length; j++) if (stepStarts[j] <= bb) at = j;
    if (at !== pr.at) { pr.at = at; if (st.tab === "prog") document.querySelectorAll(".step").forEach((el, j) => el.classList.toggle("now", j === at)); }
    st.progTimer = setTimeout(tick, 8);
  };
  tick();
  if (st.tab === "prog") renderPanel();
}
function stopProg() {
  const pr = st.prog;
  if (!pr.playing) return;
  pr.playing = false; pr.at = -1;
  clearTimeout(st.progTimer);
  preview.post({ type: "notes", notes: [] });
  st.lit.clear(); litKeys();
  if (st.tab === "prog") renderPanel();
}

// ---- the FM-1 ----
async function connectFM1() {
  try {
    if (DEMO) {
      mock = mock || mockFM1(st.factory);
      access = mock.access;
    } else {
      access = await midiAccess();
    }
    const info = await dev.connect(access);
    status(`${DEMO ? "Demo: a simulated FM-1" : "Connected"}: ${info.name}`, "ok");
    hookMidiIn();
    await liveStart();
  } catch (e) {
    status(e.message, "bad");
  }
  renderPanel();
}
// on connecting: unsaved work here goes to the FM-1; otherwise the editor shows what the FM-1 is playing
async function liveStart() {
  liveLabel();
  if (!live.active) return;
  if (st.dirty) { live.edit(st.set); return; }
  try {
    const set = await dev.getSet(WORKING);
    if (set) fromFM1({ kind: EVT.LOADED | (dev.info.flags ? EVT.EDITED : 0), cur: dev.info.cur, set });
  } catch (e) { toast(e.message); }
}
function hookMidiIn() {               // a MIDI keyboard (not the FM-1) plays the learn keys and the chord keys
  if (!access || DEMO) return;
  for (const i of access.inputs.values()) {
    if (dev.input && i.id === dev.input.id) continue;
    i.onmidimessage = (e) => {
      const [s, n, v] = e.data, t = s & 0xf0;
      if (t !== 0x90 && t !== 0x80) return;
      const on = t === 0x90 && v > 0;
      if (st.learn) { learnNote(n, on); return; }
      const k = n - 53;
      if (k >= 0 && k < NKEYS) { if (on) keyDown(k, `m${n}`); else keyUp(`m${n}`); }
    };
  }
}
async function panelDevice(p) {
  const c = dev.connected;
  p.innerHTML = `
    <div class="sugbar">
      <button id="d-conn" class="primary">${c ? "Reconnect" : "Connect FM-1"}</button>
      ${c ? '<button id="d-disc">Disconnect</button>' : ""}
      <button id="d-aud" class="${st.audition ? "on" : ""}" aria-pressed="${!!st.audition}">Keys here play the FM-1 too</button>
    </div>
    <p class="hint">${live.on ? "<b>Live is on:</b> every change here plays on the FM-1 straight away, and the FM-1's own changes show here. Press SAVE on the FM-1 to keep a set there (it asks: overwrite, or save as new)." : "<b>Live is off:</b> use the buttons below to send sets."}</p>
    ${c ? `<p><b>${esc(dev.info.name)}</b> · ${dev.info.nfactory} factory sets, ${dev.info.nuser} user slots · playing ${dev.info.cur >= FACTORY0 ? `factory set ${dev.info.cur - FACTORY0 + 1}` : `user set ${dev.info.cur + 1}`}</p>
      <div class="row"><button id="d-work">Play this set on the FM-1 now (not saved there)</button></div>
      <h3>User sets on the FM-1</h3>
      <table class="slots"><thead><tr><th>Slot</th><th>Name</th><th></th></tr></thead><tbody id="d-slots"><tr><td colspan="3">Reading…</td></tr></tbody></table>` :
      `<div class="callout">
        <p><b>On a computer:</b> plug the FM-1 in with a data cable, switch it on, open this page in Chrome or Edge and press Connect. Close Ableton or anything else using the FM-1's MIDI port first.</p>
        <p><b>On iPad:</b> Safari has no Web MIDI, so this page can't reach the FM-1 there. Use the <b>FM1-Chord iPad app</b> (the same editor with CoreMIDI): download the .ipa from the <a href="https://github.com/TwistedGenetics/FM1-Chord/releases/tag/ipad" target="_blank" rel="noopener">ipad release</a> and add it with SideStore or AltStore. Everything else on this page (editing, suggestions, sound, progressions, MIDI files) works in Safari as it is.</p>
        <p>The FM-1 needs FM1-Chord installed: <a href="../flasher/">firmware flasher</a>.</p></div>
      <div class="callout warn" style="margin-top:10px"><b>Bricked FM-1?</b> A black screen with no USB after an update was cut off needs the chip-level route: see the <a href="https://github.com/TwistedGenetics/FM1-Chord/blob/main/docs/RECOVERY.md" target="_blank" rel="noopener">recovery guide</a>. Until then, everything here works without the FM-1.</div>`}`;
  $("#d-conn").onclick = connectFM1;
  if ($("#d-disc")) $("#d-disc").onclick = () => { dev.disconnect(); status("Not connected"); liveLabel(); renderPanel(); };
  $("#d-aud").onclick = () => { st.audition = !st.audition; renderPanel(); };
  if (!c) return;
  $("#d-work").onclick = async () => {
    try { await dev.putSet(WORKING, st.set); toast("Playing on the FM-1 (SAVE on the FM-1 or Send to slot keeps it)"); } catch (e) { toast(e.message); }
  };
  try {
    const names = await dev.names();
    const tb = $("#d-slots");
    if (!tb) return;
    tb.innerHTML = names.slice(0, NUSER).map((n) => `<tr><td><b>${n.slot + 1}</b></td><td>${n.used ? esc(n.name) : '<span class="hint">empty</span>'}</td>
      <td class="acts"><button data-send="${n.slot}">Send this set here</button> <button data-get="${n.slot}" ${n.used ? "" : "disabled"}>Open</button> <button data-sel="${n.slot}" ${n.used ? "" : "disabled"}>Play on FM-1</button></td></tr>`).join("");
    tb.querySelectorAll("[data-send]").forEach((b) => (b.onclick = async () => {
      const s = +b.dataset.send;
      if (names[s].used && !confirm(`Replace "${names[s].name}" in slot ${s + 1} on the FM-1?`)) return;
      try { await dev.putSet(s, st.set); toast(`Saved to slot ${s + 1} on the FM-1`); panelDevice(p); } catch (e) { toast(e.message); }
    }));
    tb.querySelectorAll("[data-get]").forEach((b) => (b.onclick = async () => {
      try {
        const s = await dev.getSet(+b.dataset.get);
        if (!s) return toast("Nothing there");
        st.mine.push(s); saveMine(); libLabel(); st.dirty = false;
        openSet("mine", st.mine.length - 1); toast(`Opened "${s.name}" from the FM-1 (saved in My sets)`);
      } catch (e) { toast(e.message); }
    }));
    tb.querySelectorAll("[data-sel]").forEach((b) => (b.onclick = async () => {
      try {
        const s = +b.dataset.sel;
        await dev.select(s); dev.info = await dev.getInfo(); toast("Selected on the FM-1");
        if (live.on) { const set = await dev.getSet(s); if (set) fromFM1({ kind: EVT.LOADED, cur: s, set }); }
        else panelDevice(p);
      } catch (e) { toast(e.message); }
    }));
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------------------------------------- the rest ---
function status(t, cls = "") { const s = $("#status"); s.textContent = t; s.className = cls; }
function toast(t) {
  const el = $("#toast"); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
}
function download(name, data, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function soundBtn() {
  const b = $("#b-sound");
  const on = preview.ctx && preview.ctx.state === "running";
  b.classList.toggle("on", !!on);
  b.textContent = on ? "Sound on" : "Tap for sound";
}
function renderAll() {
  libLabel();
  $("#setname").value = st.set.name;
  $("#b-save").textContent = st.dirty ? "Save *" : "Save";
  $("#b-del").disabled = st.cur.kind !== "mine";
  octLabel(); renderKeys(); renderPanel(); showNow(st.sel);
}
function bindTop() {
  $("#lib").onchange = (e) => { const v = e.target.value; if (v[0] !== "d") openSet(v[0] === "f" ? "factory" : "mine", +v.slice(1)); };
  $("#b-live").onclick = () => {
    live.on = !live.on; liveLabel();
    if (live.active) live.open(st.set, st.cur.kind === "factory" && !st.dirty ? FACTORY0 + st.cur.i : -1);
    if (st.tab === "device") renderPanel();
  };
  live.onremote = fromFM1;
  live.onerror = (e) => toast("Live sync: " + e.message);
  dev.onchange = liveLabel;
  $("#setname").oninput = (e) => { st.set.name = e.target.value.toUpperCase().replace(/[^\x20-\x7e]/g, "").slice(0, 16); markDirty(); };
  $("#b-save").onclick = () => {
    if (st.cur.kind !== "mine") { st.mine.push(cloneSet(st.set)); st.cur = { kind: "mine", i: st.mine.length - 1 }; }
    else st.mine[st.cur.i] = cloneSet(st.set);
    saveMine(); st.dirty = false; renderAll(); toast(`Saved "${st.set.name}" in My sets`);
  };
  $("#b-new").onclick = () => {
    if (st.dirty && !confirm("Discard the changes to this set?")) return;
    st.mine.push(newSet(`MY SET ${st.mine.length + 1}`)); saveMine(); st.dirty = false; openSet("mine", st.mine.length - 1);
  };
  $("#b-dup").onclick = () => {
    const s = cloneSet(st.set); s.name = (s.name.slice(0, 12) + " CPY").slice(0, 16);
    st.mine.push(s); saveMine(); st.dirty = false; openSet("mine", st.mine.length - 1);
  };
  $("#b-del").onclick = () => {
    if (st.cur.kind !== "mine" || !confirm(`Delete "${st.set.name}" from this device?`)) return;
    st.mine.splice(st.cur.i, 1); saveMine(); st.dirty = false; openSet("factory", 0);
  };
  $("#b-export").onclick = () => download(`${(st.set.name || "set").trim().replace(/\s+/g, "-")}.chordset`, setToFile(st.set), "application/json");
  $("#b-bank").onclick = () => {
    if (!st.mine.length) { toast("Save a set first: My sets go to Ableton"); return; }
    download("FM1-Chord-My-sets.fm1bank", bankToFile(st.mine), "application/json");
    toast(`${st.mine.length} set${st.mine.length > 1 ? "s" : ""} saved for Ableton: press LOAD on the device and pick the file`);
  };
  $("#b-import").onclick = () => $("#importfile").click();
  $("#b-paste").onclick = pasteDialog;
  $("#importfile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const sets = bankFromFile(await f.text());
      st.mine.push(...sets); saveMine(); st.dirty = false; openSet("mine", st.mine.length - sets.length);
      toast(sets.length > 1 ? `Added ${sets.length} sets from ${f.name}` : `Opened ${f.name}`);
    }
    catch (err) { toast(err.message); }
    e.target.value = "";
  };
  $("#b-sound").onclick = () => preview.start().then(soundBtn).catch((e) => toast(e.message));
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; renderPanel(); renderKeys(); }));
  document.addEventListener("pointerdown", () => { if (!preview.ctx) preview.start().then(soundBtn).catch(() => {}); }, { once: true });
  preview.onEvent((m) => {
    if (m.type === "note" && st.midiOut) st.midiOut.send(m.on ? [0x90, m.note, m.vel] : [0x80, m.note, 0]);
  });
  window.addEventListener("beforeunload", (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ""; } });
}

async function main() {
  const json = await (await fetch(new URL("./presets.json", import.meta.url))).json();
  const pr = loadPresets(json);
  st.sounds = pr.sounds; st.factory = pr.sets;
  loadMine();
  st.set = cloneSet(st.factory[0]);
  pushSet();
  bindTop(); bindKeys(); renderAll(); soundBtn();
  window.__fc = { mock: DEMO, st, preview, dev, live, encodeSet, get mockObj() { return mock; } };
  if (DEMO) { await connectFM1(); status("Demo: a simulated FM-1 (nothing is sent to real hardware)", "ok"); }
  else if (!navigator.requestMIDIAccess) status("No Web MIDI here: editing and sound work; the FM-1 needs Chrome / Edge or the iPad app");
}
main().catch((e) => status("Couldn't start: " + e.message, "bad"));
