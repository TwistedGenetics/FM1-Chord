# FM1-Chord on the FM-1

The screen shows the chord big (name, then inversion and voicing, then the octave), with the page's four knob values
along the bottom. Every page's values are on K1–K4.

| Control | Does |
|---|---|
| **Keys** | play the chord on that key (and select it for editing). Empty keys play nothing |
| **OCT− / OCT+** | the whole set down / up an octave (−3..+3). Both held 5 s: the update mode (every FM-1 firmware) |
| **PRESET** | the chord set: the 118 factory sets (the 18 FM1-Chord sets, then J6 01 … J6 100), then your user sets |
| **SELECT** | the key to edit (opens the CHORD page) |
| **ALGO** | tempo |
| **HOME** | PLAY page: SET, OCT, TRANS(pose), TEMPO. Again: **MACRO**, four knobs that each move what the sound's macro is set up for (the label says what: CUTOFF, DRIVE, DLY MIX …) |
| **EDIT** | CHORD page: ROOT, TYPE, INV(ersion), VOICE(ing). Again: BASS (slash chord), OCTAVE (this chord's), LATCH, V.LEAD. Turning a value on an empty key makes a chord there; an edited chord plays for a moment. Under the chord's name a band rates it against the chord on the key before (the nearest one below with a chord): **green STRONG**, **amber OK** or **red FAR**, with that chord's name, so you can scan roots and types and hear and see what fits. The first chord says FIRST CHORD |
| **REC** | LEARN: the keys play notes (F3 – G5 plus the octave). Hold a chord's notes and let go: it goes on the selected key, named if it's a known chord (any inversion), custom if not. REC again: back |
| **ENV** | SOUND: the factory sound to start from, CUTOFF, RESO, F.ENV. Again: **OSC** (WAVE A, WAVE B, WT POS, SPREAD). Again: **OSC 2** (B TUNE in semitones, B MODE add / sync / ring, B LEVEL, SUB). Again: **FILTER** (TYPE low-pass / band-pass / high-pass / notch, SLOPE 12 or 24 dB, DRIVE, KEY TRK). Again: AMP (attack, decay, sustain, release). Again: **MOD ENV** (its attack, decay, sustain, release). Again: **LFO** (L1 RATE, L1 WAVE, L2 RATE, L2 WAVE; a rate synced to the tempo shows as 1/8, 1 BAR …). Again: back to SOUND |
| **FX** | FX page: CHORUS, REVERB, SIZE, LEVEL. Again: **DELAY** (TIME 1/32 .. 1 bar, on the tempo; FEEDBK, MIX, TONE). Again: **LO-FI** (BITS, RATE: the crusher; WOBBLE: tape wow and flutter; PHASER) |
| **ARP** | PLAYING: MODE (chord / strum / arp), STRUM (ms), DIR, HUMAN(ise). Again: ARP: RATE, DIR, OCTAVES, GATE |
| **LFO** | latch on / off (lit when on): a chord keeps sounding after you let go; the same key again stops it |
| **SEL** | auto voice leading on / off (lit when on) |
| **GLO** | GLOBAL: MIDI CH (out), OUTPUT (both / synth / MIDI), CLOCK (internal / MIDI: the arpeggiator follows MIDI clock in), VELO (the keys' velocity). Again: **GLOBAL 2**: VOICES (4–10) |
| **SAVE** | SAVE page. On one of your user sets it first offers **OVERWRITE** (that set's slot); turn K1 (or PRESET) for **SAVE AS NEW** (each empty slot) or **REPLACE** (another of your sets, its name shown). SAVE again saves; any other button: not saved |
| **PLAY** | all notes off (and All Notes Off on MIDI out) |
| **SEQ** | reserved for progressions and phrases (next version) |

A `*` after the set's name means it has changes that aren't saved.

**Live with the editor (0.4).** With the FM-1 connected and **Live: on** (top of the editor), whatever you open or
change in the editor plays on the FM-1 straight away, and whatever you change on the FM-1 (PRESET, chord edits,
octave, learn) shows in the editor. Nothing is kept on the FM-1 until you press SAVE there (OVERWRITE or SAVE AS
NEW), or send a set to a slot from the editor's FM-1 tab.

**The synth (0.6, 0.7).** Two oscillators (saw, square, triangle, sine, organ, pulse, **supersaw**, **noise** and
four **wavetables**: vox, PWM, digital, glass, swept by WT POS) and a sub; B can be tuned in semitones, **hard-synced**
to A or **ring-modulate** it (then B LEVEL fades from plain A to the effect). Two oscillators and a sub, drive into a filter that can be low-pass, band-pass, high-pass or
notch at 12 or 24 dB, the filter and amp envelopes, then chorus, a tempo-synced delay (stereo or ping-pong) and reverb.
Two LFOs (free in Hz or synced to the tempo; sine, triangle, saw, square or random) and a mod envelope move things
through a six-slot **modulation matrix**: each slot is *source* moves *destination* by *amount* (sources: LFO 1, LFO 2,
mod envelope, velocity, the key's pitch, macro 1–4; destinations: pitch, cutoff, resonance, osc B level, FM, pulse
width, volume, detune, sub, drive, filter env amount, LFO 1 speed, delay mix, reverb mix, chorus). The matrix is set
up in the editor's Sound tab; the FM-1's pages reach the rest. Each factory sound comes with its macros set up, so
HOME twice gives four knobs that do the useful thing for that sound. LO-FI (FX three times) crushes like a sampler of
the 80s or 90s (the editor has SP-1200, MPC60, S950 and Amiga settings), wobbles like tape, and phases; the chorus
has three modes (I, II, I+II) in the editor.

If heavy sounds crackle on the FM-1 (too much for its CPU), **GLOBAL** twice gives **VOICES**: fewer voices, less
work.

**Paste chords (editor, 0.4).** *Paste chords* reads chord sets from text (a note, a chart, a forum post): one set per
line or paragraph, `Name: chords` or a name line above them. Each set's chords go on the white keys from F3; with
*Fill the other keys* on, the rest of the keys get the same progression again (richer, sus, a new inversion, a
walking slash bass, higher and spread) and then chords that fit. It lists anything it couldn't read, then offers to
save the sets in My sets, and to the FM-1's empty user slots (nothing there is replaced).

**Expand my progression (editor, Suggestions tab).** The same fill for the set that is open: your chords stay, the
empty keys get them again as rows, then fitting chords. MIDI notes in on any channel (GLOBAL can narrow
it later) play the keys: F3 is key 1.
