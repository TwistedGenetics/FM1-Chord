// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: reading chord sets from plain text (0.4), the way people write chords in notes, charts and forum
// posts. Lenient about spelling: Cmaj7 CM7 CΔ7 CΔ, Cm7 Cmin7 C-7, Cø Cm7(b5) Cm7-5, C° Cdim7 C°7, C+ Caug, C7(b9),
// Cadd2, C2, Csus, C6/9, Cm(maj7) CmM7, slash basses, ♭ and ♯, | bars |, N.C., % (repeat). Sets:
//   Name: Am F C G             a named set on one line
//   Verse                      a line that isn't chords names the set below it
//   Am F C G                   chord lines run on into the same set until a blank line or a new name
// Each chord goes on a key once (repeats are merged). Returns [{ name, chords: [chord], bad: [text], merged }].
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { parseChord, chordName, NOBASS } from "./chord.js";

const NOTE = /^[A-Ga-g](?:##|bb|#|b)?/;

// one quality spelling → FM1-Chord's
const QMAP = [
  [/^(maj|ma|M|Δ|△)$/, "maj7"], [/^(maj|ma|M|Δ|△)7$/, "maj7"], [/^(maj|ma|M|Δ|△)9$/, "maj9"],
  [/^(maj|ma|M|Δ|△)13$/, "maj9"], [/^(maj|ma|M|Δ|△)7\(?#11\)?$/, "maj7#11"], [/^(maj|ma|M|Δ|△)(7)?\(?add9\)?$/, "maj9"],
  [/^(major|maj3)?$/, ""],
  [/^(m|mi|min|minor|-)$/, "m"], [/^(m|mi|min|-)7$/, "m7"], [/^(m|mi|min|-)9$/, "m9"], [/^(m|mi|min|-)11$/, "m11"],
  [/^(m|mi|min|-)13$/, "m13"], [/^(m|mi|min|-)6$/, "m6"], [/^(m|mi|min|-)6\/?9$/, "m9"],
  [/^(m|mi|min|-)\(?add9\)?$/, "m9"], [/^(m|mi|min|-)\(?add2\)?$/, "m9"],
  [/^(m|mi|min|-)\(?(maj|M|Δ)7?\)?$/, "mmaj7"], [/^(m|mi|min|-)\(?(maj|M|Δ)9\)?$/, "mmaj7"],
  [/^(ø|ø7|m7\(?b5\)?|m7-5|-7b5|mi7b5|min7b5|half-?dim(inished)?)$/, "m7b5"],
  [/^(°|o|dim|diminished)$/, "dim"], [/^(°7|o7|dim7)$/, "dim7"],
  [/^(\+|aug|augmented|#5|\(#5\))$/, "aug"], [/^(\+7|7\+|aug7|7#5|7\(#5\)|7\+5)$/, "7#5"],
  [/^(7|dom7?|dom)$/, "7"], [/^9$/, "9"], [/^11$/, "11"], [/^13$/, "13"],
  [/^7\(?b9\)?$/, "7b9"], [/^7\(?#9\)?$/, "7#9"], [/^7\(?#11\)?$/, "7#11"], [/^7\(?b5\)?$/, "7#11"],
  [/^(sus|sus4|\(sus4\))$/, "sus4"], [/^(sus2|\(sus2\)|2)$/, "sus2"], [/^(7sus|7sus4|sus7|9sus4|9sus|11)$/, "7sus4"],
  [/^7sus2$/, "7sus4"],
  [/^(add9|\(add9\)|add2|\(add2\))$/, "add9"], [/^6$/, "6"], [/^(6\/9|69|6add9|6\(add9\))$/, "69"],
  [/^(5|power|\(no3\))$/, "5"],
];
function quality(t) {
  for (const [re, q] of QMAP) if (re.test(t)) return q;
  return null;
}

// one chord symbol → a chord, or null. Approximations (a 13 read as a 9, say) are fine: the key has room to edit.
export function readChord(tok) {
  let t = String(tok).trim().replace(/♭/g, "b").replace(/♯/g, "#");
  t = t.replace(/^\(+/, "").replace(/[,.;]+$/, "");
  if (/^\(.*\)$/.test(t)) t = t.slice(1, -1);
  const m = NOTE.exec(t);
  if (!m) return null;
  const root = m[0][0].toUpperCase() + m[0].slice(1);
  let tail = t.slice(m[0].length), bass = "";
  // a slash bass, but not the slash of 6/9
  const sl = /\/([A-Ga-g](?:#|b)?)$/.exec(tail);
  if (sl && !/6\/9$/.test(tail)) { bass = sl[1][0].toUpperCase() + sl[1].slice(1); tail = tail.slice(0, -sl[0].length); }
  let q = quality(tail);
  if (q === null) {                                // try it without the brackets, then with less on the end
    const flat = tail.replace(/[()]/g, "");
    q = quality(flat);
    // drop extra tensions off the end (C7b9#11 → C7b9, Cmaj7#5 → Cmaj7), never plain letters (Chorus is not C)
    for (let n = flat.length - 1; q === null && n >= 0; n--)
      if (/^([#b+\-]\d|\d|add|alt|no|omit)/.test(flat.slice(n))) q = quality(flat.slice(0, n));
    if (q === null) return null;
  }
  try { return parseChord(`${root}${q}${bass ? "/" + bass : ""}`); } catch { return null; }
}

const SEP = /[\s|,]+|\s[-–—>→]+\s/;
const isChordish = (w) => NOTE.test(w.replace(/^\(+/, "")) && w.length <= 14;

function cleanName(s) {
  return s.replace(/^[#*>\-–—=\s\d.)]+/, "").replace(/[:=\s]+$/, "").toUpperCase()
    .replace(/[^\x20-\x7e]/g, "").trim().slice(0, 16);
}

export function readChordText(text, { max = 27 } = {}) {
  const sets = [];
  let cur = null, pendingName = "";
  const start = (name) => { cur = { name: name || "", chords: [], bad: [], merged: 0, seen: new Set() }; sets.push(cur); };
  const add = (c, raw) => {
    if (!c) { cur.bad.push(raw); return; }
    const key = chordName({ ...c });
    if (cur.seen.has(key)) { cur.merged++; return; }
    if (cur.chords.length >= max) { start(cur.name ? (cur.name.slice(0, 13) + " 2").slice(0, 16) : ""); }
    cur.seen.add(key); cur.chords.push(c);
  };
  for (let line of String(text).replace(/\r/g, "").split("\n")) {
    line = line.trim();
    if (!line) { cur = null; continue; }
    let name = "", body = line;
    const nm = /^([^:=|]{1,40}?)\s*[:=]\s*(.*)$/.exec(line);       // "Name: chords" (not "C:" on its own)
    if (nm && !readChord(nm[1])) { name = nm[1]; body = nm[2]; }
    const words = body.split(SEP).filter((w) => w && !/^[|:]+$/.test(w) && !/^x\d+$/i.test(w) && !/^\(?x\d+\)?$/i.test(w));
    const chordish = words.filter((w) => /^(N\.?C\.?|%|\/)$/i.test(w) || (isChordish(w) && readChord(w)));
    const chordLine = words.length > 0 && chordish.length >= Math.max(1, Math.ceil(words.length / 2));
    if (!chordLine) {
      if (name && !body.trim()) { pendingName = name; cur = null; continue; }
      pendingName = name || line; cur = null;            // a heading: names the next chord line's set
      continue;
    }
    if (name || pendingName || !cur) { start(cleanName(name || pendingName)); pendingName = ""; }
    let last = null;
    for (const w of words) {
      if (/^(N\.?C\.?|\/)$/i.test(w)) continue;
      if (w === "%") { if (last) cur.merged++; continue; }
      const c = isChordish(w) ? readChord(w) : null;
      add(c, w);
      if (c) last = c;
    }
  }
  return sets.filter((s) => s.chords.length || s.bad.length).map((s, i) => ({
    name: s.name || `IMPORT ${i + 1}`, chords: s.chords, bad: s.bad, merged: s.merged,
  }));
}

export { NOBASS };
