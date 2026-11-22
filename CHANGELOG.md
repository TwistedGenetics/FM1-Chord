# Changelog

## 0.15

- **Ableton device: changing sets.** The strip's drop-down was a native menu, which a web view inside Live can't
  open; the set button now opens a list drawn by the page (My sets, then the factory's). And the panel beside the
  strip has Live's own controls for it: a **SET** number with **<** and **>** (My sets first, then the factory's;
  automatable), which work whatever the web view does. Each change of set is written in the Max window.

## 0.14

- **Ableton device: the strip and the editor show up.** 0.13 asked Max's web view to open its pages with `read`,
  which wants a web address, so the device stayed a blank grey box. It now uses `readfile`; and if a page hasn't
  answered after 1.5 s, the device loads it again from the folder the device is in, saying so in the Max window.

## 0.13

- **The Ableton device is now the editor.** The device's strip (on the track) shows the set (pick any, or step
  with the arrows), the chord playing in big letters and the 27 keys lit as they play; click a key to hear it.
  **EDITOR** opens the whole FM1-Chord editor in its own window: every factory set and My sets, chord editing,
  suggestions with the colour-coded help, Expand my progression, playing (chord, strum, arpeggio), progressions,
  pasting chords. Every key and every change plays on the track's instrument straight away; choosing a set on the
  strip or in the editor shows on the other. Save keeps a set in My sets; the set playing and My sets are saved
  with the Live set (a 0.10-0.12 device's My sets carry over).
- In Live the editor leaves out what's only for the FM-1 (its sound, its connection) and asks no questions:
  leaving a changed set keeps the changes in My sets, Delete wants a second press.
- The release zip holds four files that stay together: FM1-Chord.amxd, fm1chord.js, FM1-Chord-strip.html,
  FM1-Chord-editor.html (the editor's page, made from web/editor on every release).
- Tests: tests/host/m4l_test runs the device's code with Max faked (every set against the editor's player, every
  message, the Live set's state); tests/host/m4l_pages runs device, strip and editor together in headless Chrome.

## 0.12

- **Less CPU, no break-ups.** The first readings from a real FM-1 (F PHRYGIAN DARK, DARK PAD: PEAK 114 %, 14 drops)
  showed the synth asking for more than the FM-1 has when a new chord starts over the last one's tails.
  - The synth does each voice's work a stage at a time over 16 samples, with every decision made once per block
    instead of every sample; the organs read one table instead of three sines; the supersaw and wavetables work
    out their steps and frames once a block; the reverb runs from local state. The same sound (the editor's synth
    still matches within 0.6 %), about a quarter less work on average and a third less for the heaviest sounds
    (DARK PAD about 77 % of 0.11's cost).
  - The CPU guard now learns what the effects and each voice cost with the sound playing and holds the voices to
    what fits in 80 % of the time, so a new chord takes over the oldest tails instead of piling on top of them. A
    block over 90 % still takes one more voice off. VOICES on GLOBAL 2 shows, say, 7/10 while it does.

## 0.11

- **Stutter fix.** Whenever the sound went quiet (between notes, at the end of a tail, holding a low pulse or square
  chord) the synth's effects and filters worked with *denormals*, numbers so tiny that a CPU without hardware for
  them is many times slower on each one: on a PC the quiet synth cost about seven times its usual work. The soft
  clipper no longer cubes the effects' tiny guard values, and the filter's band state is kept clear of them.
  tests/host/cpu_test checks every factory sound and 300 random ones, playing and silent: none makes one now
  (before: all 300 did).
- **A CPU guard.** If a block of sound takes more than 85 % of its time, the FM-1 plays fewer voices (the oldest
  fade out in about 20 ms, released ones first) instead of breaking up, and gives them back after about a second
  of ease.
- **GLOBAL 2 shows the load:** CPU, PEAK (the last few seconds) and DROPS (break-ups since power-on); VOICES shows
  6/10 while the guard holds it to fewer.

## 0.10

- **Your own sets in Ableton.** The editor's new **For Ableton** button saves all of My sets (including any you
  fetched from the FM-1) as one file, `FM1-Chord-My-sets.fm1bank`. On the Live device, **LOAD SETS** picks that file
  (or a single `.chordset`) and the **Bank** switch goes to **Mine**; Factory is still there. Your sets are saved
  inside the Live set, so they come back when you reopen it, even if the file has moved.
- The editor's **Open file** takes a `.fm1bank` too and adds all its sets to My sets.

## 0.9

- **FM1-Chord for Ableton Live:** a Max for Live **MIDI effect** (no synth: put any instrument or VST after it).
  Every key from Key 1 (F3) up plays that key's chord in the chosen set, with the FM-1's own voicings, voice
  leading, strum and arpeggio (at Live's tempo); other notes and controllers pass through. All 118 factory sets,
  and a panel for set, mode, latch, voice leading, octave, transpose, strum, arpeggio and humanise, all automatable.
- It is made from the editor's own code by tools/gen_m4l.mjs on every release (FM1-Chord-M4L-X.Y.zip), so it
  never falls behind; tests/host/m4l_test runs it with Max faked and checks every set against the editor's player.

## 0.8

- **Harmony help on the FM-1:** on the CHORD pages, every chord you try on a key is rated against the chord on the
  key before it, in a coloured band under its name: green STRONG, amber OK, red FAR (with that chord's name). The
  rating is the editor's own (tests/host/harmony_xcheck: 119,826 ratings agree).
- **The same in the editor:** the chord page shows the rating, and colours every root and chord type by how it
  would follow the key before; each key on the keyboard has a coloured foot for how it follows its neighbour.
- **A dark, module-panel look** (as the mockup's module grid), on the FM-1's screen and in the editor: near-black
  panels, light text, one cyan accent, sections as panels with a light, and **knobs** in place of sliders (drag up
  and down; the keys and screen readers still work them).

## 0.7

- **Stage two of the synth.** New waves for either oscillator: **supersaw** (seven saws, spread adjustable),
  **noise**, and four **wavetables** (vox, PWM, digital, glass) swept by a WT position. Osc B can be **tuned** in
  semitones, **hard-synced** to A or **ring-modulate** it. New matrix destinations: WT position, supersaw spread,
  osc B pitch.
- **Lo-fi:** a sampler-era **crusher** (bits and sample rate; SP-1200, MPC60, S950 and Amiga settings in the
  editor) and **tape wobble**; a **phaser**; the chorus has three modes (I, II, I+II).
- **15 new sounds** (42 in all): supersaw chords, shimmer pad, choir aah, vox stab, PPG digital, PWM WT pad, sync
  chords, ring bells, kalimba, marimba, lo-fi tape pad, vinyl noise pad, SP1200 stab, Amiga chords, Juno I+II pad.
- FM-1 pages: OSC and OSC 2 (ENV), LO-FI (FX), GLOBAL 2 with **VOICES** (4–10): if a heavy sound is too much for the
  FM-1's CPU, fewer voices.
- Sets are 384 bytes (version 3); 0.1–0.6 sets load as they were. Editor protocol 4.

## 0.6

- **A bigger synth.** The filter is now low-pass, band-pass, high-pass or notch, at 12 or 24 dB, with drive into it.
  Two LFOs (free or synced to the tempo; sine, triangle, saw, square, random), a mod envelope and a six-slot
  **mod matrix** (pitch, cutoff, resonance, osc B, FM, pulse width, volume, detune, sub, drive, filter env, LFO 1
  speed, delay, reverb, chorus). A **tempo-synced delay**, stereo or ping-pong, with tone and dub-style feedback.
- **Macros:** four per sound, on the FM-1's new MACRO page (HOME twice), each labelled with what it moves.
- **16 new sounds** that use all of it: Reese chord, hoover stab, atmos pad, liquid strings, ragga horn, dark sub
  pad, rave organ, Juno strings, house organ, Detroit stab, dub techno, FM piano, wobble chord (synced LFO), PWM
  brass, air glass pad, tape chords. 27 in all.
- New FM-1 pages: FILTER, MOD ENV and LFO (ENV), DELAY (FX), MACRO (HOME). The editor's Sound tab has it all,
  including the matrix.
- Sets are 376 bytes (version 2); sets saved by 0.5 and before load as they were, and the editor still talks to
  older firmware. Editor protocol 3.
- The synth's tempo follows MIDI clock when CLOCK is MIDI.
- Tests: the editor's synth is checked against the firmware's for every sound (and one with every feature on).

## 0.5

- **Fix: OCT− / OCT+ did nothing on sets with voice leading on** (the FM-1 and the editor): each chord was led
  back next to the one before, undoing the octave. Voice leading now follows the set's octave and transpose.
- **Fix: the octave stopped at the bottom on low chords** (many J6 chords, whose voicings go down to F1). A chord
  still sits in C1–C8 on its own; the set's octave and transpose then move it as far as C0–C9.
- **Fix: in the iPad app, picking a sound in the editor didn't change what you heard** (its preview kept the old
  sound).

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
