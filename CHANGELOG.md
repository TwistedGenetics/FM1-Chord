# Changelog

## 0.4

- **Live sync** between the editor and the FM-1 (*Live: on* in the editor, on by default when connected). Opening
  a set or changing anything in the editor plays it on the FM-1 at once; changing set, chords, octave or learning on
  the FM-1 shows in the editor. The FM-1 announces its changes with a new event frame (48, docs/PROTOCOL.md).
- **SAVE on the FM-1 asks:** OVERWRITE the user set you're on, SAVE AS NEW (an empty slot) or REPLACE another set
  (its name shown). SAVE again commits.
- **Expand my progression** (Suggestions tab): the set's chords stay; the empty keys get the progression again as
  rows (richer, sus, new inversion in an open voicing, a walking slash bass, higher and spread), then new chords
  that fit it (strong first).
- **Paste chords:** chord sets from text, read leniently (Δ, ø, °, +, -7, M7, (b9), 6/9, slash basses, bars,
  N.C., %); named sets, merged repeats, a list of anything it couldn't read; each set expanded to all 27 keys if
  you want; then saved to My sets and, if you say so, to the FM-1's empty user slots.

## 0.3

- **The Roland J-6's 100 chord sets** as factory sets **J6 01 POP … J6 100 MODERN** (named after the manual's
  chord set list, with its numbers). The J-6's 12 chords sit on the FM-1's keys by note name (C4–B4 at the J-6's
  pitch, F3–B3 an octave down, C5–G5 an octave up) and keep its voicings note for note; voice leading is off in them.
  Four chords that spanned more than 31 semitones have their lowest note an octave higher. Data:
  `tools/j6_chord_sets.txt`, built by `tools/gen_j6_sets.mjs`.
- 118 factory sets: set numbers on the wire are now two bytes (editor protocol 2; factory sets from 128). The editor
  needs this firmware and this firmware needs this editor; saved settings carry over.
- Eight more chord types: 7#9, 7b9, 7#5, m(maj7), maj7#11, 7#11, m13, 6/9.
- Exact-note (custom) chords hold up to 31 semitones and are named from their notes ("Cadd9/E", "G13"), on the FM-1
  and in the editor alike.

## 0.2

- Thirteen new factory sets in F built on Phrygian progressions (i → bII, the half-step dread, Andalusian, Phrygian
  dominant, dub, liquid, neuro, horror, garage, arps, strums, rave, space). Each key plays the chord on its own note
  where F Phrygian has one; the keys between hold colour chords.
- Three new sounds: VOID PAD, DUB CHORD, BELL STAB.

## 0.1 (beta, not yet tried on a real FM-1)

Build order steps 0–4, and step 5 in the editor.

- **Setup:** GitHub Actions builds the `.fwsc` on every push (Linux JieLi toolchain, X0X's platform pinned), runs
  the host tests, publishes Release `v0.1`; GitHub Pages hosts the editor and the web flasher; the iPad app is built
  and published on the rolling `ipad` pre-release.
- **FM-1:** a chord on each of the 27 keys; five factory sets (DARK JUNGLE MIN, LIQUID DNB, NEURO STABS, DEEP GARAGE,
  90S RAVE STABS) and 20 user slots; octave buttons; per-chord root, 22 qualities + custom notes, inversion, voicing,
  slash bass, octave; LEARN from played notes; a 10-voice chord synth (two oscillators, sub, FM, filter with its
  envelope, amp envelope, chorus, reverb) with eight factory sounds; MIDI out (synth, MIDI or both), MIDI notes in
  play the keys, MIDI clock in drives the arpeggiator; strum, arpeggiator, latch, auto voice leading, velocity
  humanise, transpose; a light screen with big type.
- **Editor:** chord sets with an in-browser preview (the FM-1's synth and player in JavaScript, checked against the
  C), a keyboard and a big-tile view, harmony suggestions in green / amber / red with labels and reasons, key
  detection, "suggest next chord", "fill the set" with a dark jungle / DnB bias, learn from on-screen or MIDI keys,
  progressions with twelve J-6-style rhythm phrases and MIDI-file export, sync with the FM-1, a demo FM-1.
- **Recovery:** the update loader writes the app header last (DREADNOUGHT 0.43's fix), so a cut install comes back in
  update mode; `docs/RECOVERY.md` for an FM-1 that already went black.
