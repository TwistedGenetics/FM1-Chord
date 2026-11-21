# A chord set: 336 bytes

The same bytes in the FM-1's flash, over SysEx and in the editor (`src/core/fc_set.h`, `web/editor/setcodec.js`).
Every field is one byte, so there is no padding or byte order to worry about. `.chordset` files are JSON holding the
set as the editor sees it plus these bytes as hex.

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | `F` `C` |
| 2 | 1 | version (1) |
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
