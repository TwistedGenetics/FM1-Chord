# A chord set: 376 bytes

The same bytes in the FM-1's flash, over SysEx and in the editor (`src/core/fc_set.h`, `web/editor/setcodec.js`).
Every field is one byte, so there is no padding or byte order to worry about. `.chordset` files are JSON holding the
set as the editor sees it plus these bytes as hex.

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | `F` `C` |
| 2 | 1 | version (2; 1 for sets from 0.1–0.5, which are the first 336 bytes) |
| 3 | 1 | keys (27) |
| 4 | 16 | name, ASCII, 0-padded |
| 20 | 1 | key root 0–11 (for the editor's suggestions) |
| 21 | 1 | scale: 0 major, 1 minor, 2 dorian, 3 phrygian, 4 lydian, 5 mixolydian, 6 locrian, 7 harmonic minor, 8 melodic minor |
| 22 | 1 | tempo, BPM 40–250 |
| 23 | 1 | flags (0) |
| 24 | 24 | sound: type, wave A, wave B, detune, B level, sub, FM, cutoff, resonance, filter env, key track, amp A D S R, filter A D S R, chorus, reverb, room size, level, velocity |
| 48 | 16 | playing: mode (chord/strum/arp), strum, strum direction, arp rate, arp direction, arp octaves, arp gate, latch, voice leading, humanise, transpose (signed), octave (signed), swing, 3 reserved |
| 64 | 270 | 27 chords, 10 bytes each (below) |
| 334 | 2 | reserved |
| 336 | 40 | sound part 2 (from 0.6, below) |

Sound part 2 (`fc_sound2_t`): filter mode (0 low-pass, 1 band-pass, 2 high-pass, 3 notch); slope (0 12 dB, 1 24 dB);
drive 0–127; LFO 1 and 2 waves (0 sine, 1 triangle, 2 saw, 3 square, 4 random / S&H); their rates 0–127 (free:
0.03–30 Hz; synced: 8 bars at 0 to 1/32 at 127); their sync (0 free, 1 tempo); mod envelope attack, decay, sustain,
release; six modulations of 3 bytes each: source (0 none, 1 LFO 1, 2 LFO 2, 3 mod env, 4 velocity, 5 key, 6–9 macro
1–4), destination (0 none, 1 pitch, 2 cutoff, 3 resonance, 4 osc B level, 5 FM, 6 pulse width, 7 volume, 8 detune,
9 sub, 10 drive, 11 filter env amount, 12 LFO 1 rate, 13 delay mix, 14 reverb mix, 15 chorus; 12–15 for the whole
synth, moved by the LFOs and macros only) and amount (signed −127..127; pitch by the square of it, up to 24
semitones); four macro values 0–127; delay time (0 1/32, 1 1/16T, 2 1/16, 3 1/8T, 4 1/16D, 5 1/8, 6 1/4T, 7 1/8D,
8 1/4, 9 1/4D, 10 1/2, 11 1 bar; on the tempo, halved until it fits 0.74 s), feedback, mix, tone (0–127), mode (0
stereo, 1 ping-pong). A version 1 set gets: low-pass 12 dB, no drive, nothing in the matrix, macros at 64, delay mix 0.

On the FM-1 the user sets live ten to a store object (3760 bytes); objects written by 0.1–0.5 (ten 336-byte sets)
are read and spread out to the new size.

A chord: root 0–11; quality (below, `255` empty key, `31` custom: exact notes); custom notes (3 bytes: bits 0–23 of
a mask of semitones above the root); inversion 0–3; voicing 0 close, 1 open, 2 drop 2, 3 drop 3, 4 spread; slash bass
0–11 or `255`; octave −2..+2 (signed); custom notes bits 24–31 (from 0.3; 0 before, which reads the same). Custom
chords are named from their notes: the chord they make, a missing 5th (or the 9th / 11th of a big chord) allowed,
with the lowest note as a slash bass.

Qualities, in storage order (only ever added to): maj, m, 7, maj7, m7, 9, m9, 11, 13, sus2, sus4, dim, aug, add9, 6,
m6, 5 (power), m11, m7b5, dim7, maj9, 7sus4, and from 0.3 7#9, 7b9, 7#5, m(maj7), maj7#11, 7#11, m13, 6/9.

The text form the factory content uses (`web/editor/presets.json`): `Fm9/Db i1 drop2 +1` (root and quality, slash
bass, inversion, voicing, octave), or `C*0.4.7.14 -1` for exact notes (semitones above the root, then the octave).

How a chord becomes notes: its tones in close position above the root in the octave from C3; the inversion moves the
lowest up an octave that many times; the voicing (open: every other note from the bottom up an octave; drop 2 / 3:
that note from the top down an octave; spread: the bottom down an octave and the rest open); then the chord's
octave, the set's transpose and the OCT buttons; kept within MIDI 24–108; the slash bass below the lowest note.
Voice leading, when on, then moves the whole chord (by octaves and inversions) to where it moves least from the last.
