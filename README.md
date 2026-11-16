# FM1-Chord

A chord player firmware for the **M-VAVE FM-1**, after the Roland J-6 and Captain Chords: build your own **chord
sets** — a chord on each of the FM-1's 27 keys — and play them on a synth made for chords and over MIDI. With a web
editor (also an iPad app) that suggests what to play next.

**Status: 0.1 beta, not yet tried on a real FM-1.** Read [docs/RECOVERY.md](docs/RECOVERY.md) before installing.

- **Editor:** [twistedgenetics.github.io/FM1-Chord-/editor](https://twistedgenetics.github.io/FM1-Chord-/editor/) —
  works without the FM-1, in any modern browser including Safari on iPad (sound, suggestions, progressions, MIDI
  files). Talking to the FM-1 needs Chrome / Edge on a computer, or the iPad app.
  [Demo with a simulated FM-1](https://twistedgenetics.github.io/FM1-Chord-/editor/?demo).
- **Flasher:** [twistedgenetics.github.io/FM1-Chord-/flasher](https://twistedgenetics.github.io/FM1-Chord-/flasher/)
- **Firmware:** `FM1-Chord-X.Y.fwsc` on [Releases](https://github.com/TwistedGenetics/FM1-Chord-/releases/latest)
- **iPad app:** the `.ipa` on the [ipad release](https://github.com/TwistedGenetics/FM1-Chord-/releases/tag/ipad)
  (SideStore / AltStore) — see [ios/README.md](ios/README.md)

## What it does

**On the FM-1** ([docs/MANUAL.md](docs/MANUAL.md)): each key plays its chord on the built-in synth and / or MIDI out;
OCT− / OCT+ move the whole set; per key: root, 22 chord types (maj, m, 7, maj7, m7, 9, m9, 11, 13, sus2, sus4, dim,
aug, add9, 6, m6, 5, m11, m7b5, dim7, maj9, 7sus4) or custom notes, inversion, voicing (close, open, drop 2, drop 3,
spread), slash bass and octave; LEARN captures a chord from notes you play; strum, an arpeggiator (internal tempo or
MIDI clock), latch, auto voice leading, velocity humanise, transpose. The screen is light with big type: the chord's
name, its inversion and voicing, the octave.

**The synth:** ten voices, two oscillators (saw, square, triangle, sine, organ, pulse) with detune, a sub and FM, a
12 dB filter with its own envelope, an amp envelope, a Juno-style stereo chorus and a reverb. Eight sounds to start
from: warm pad, dark pad, liquid keys, neuro stab, rave stab, garage organ, glass keys, strings.

**Factory sets:** DARK JUNGLE MIN, LIQUID DNB, NEURO STABS, DEEP GARAGE, 90S RAVE STABS, plus 20 empty user slots.

**The editor:** a keyboard (or big tiles) showing the chord on each key; chord editing; an in-browser preview that is
the FM-1's own synth and player in JavaScript (checked note for note against the firmware's C); **suggestions**
coloured **green "Strong"** (in the key, a common move, shared notes), **amber "OK"** (borrowed, secondary dominants,
modal mixture, the phrygian ♭II) and **red "Far"** (far round the circle of fifths), each with its reasons; key and
scale set by hand or detected; **suggest next chord** and **fill the set**, with a **dark jungle / DnB bias** (minor
9ths and 11ths, sus chords, phrygian moves); progressions recorded from the keys with twelve J-6-style rhythm phrases,
exported as a MIDI file; sets saved in the browser, as `.chordset` files and on the FM-1.

## Install

1. Back up what's on the FM-1 ([docs/RECOVERY.md](docs/RECOVERY.md), "Before every install").
2. Open the [flasher](https://twistedgenetics.github.io/FM1-Chord-/flasher/) in Chrome or Edge with the FM-1 on USB,
   pick the newest release, Install. Don't unplug until it says Done.

## Build

Every push builds in GitHub Actions (`.github/workflows/build.yml`). Locally on Linux x86-64:

```sh
git clone --recurse-submodules https://github.com/TwistedGenetics/FM1-Chord-.git && cd FM1-Chord-
sh tests/run_host.sh                         # host tests: cc, python3 (Pillow, fonttools), node
eval "$(tools/get_deps.sh)"                  # JieLi toolchain + 3 AC79 SDK files
python3 tools/build_fm1.py --release 0.1     # -> build/fm1/FM1-Chord-0.1.fwsc
```

The editor runs from any static server: `python3 -m http.server -d web`, then `localhost:8000/editor/`.

## Layout

| Path | What |
|---|---|
| `src/core/` | chord theory, chord sets, the player (strum, arp, latch, voice leading) — no hardware |
| `src/dsp/` | the synth |
| `src/app/` | the FM-1 app: panel, screen, storage; `fc_editor.c` the SysEx commands |
| `src/hardware/` | boot, audio interrupt, main loop on X0X's platform |
| `web/editor/` | the editor; `presets.json` is the factory content for both editor and firmware |
| `web/flasher/` | the web flasher |
| `ios/` | the iPad app (the editor with CoreMIDI) |
| `tests/` | host tests: `run_host.sh` |
| `docs/` | [RECOVERY](docs/RECOVERY.md), [MANUAL](docs/MANUAL.md), [PLATFORM](docs/PLATFORM.md), [PROTOCOL](docs/PROTOCOL.md), [FORMAT](docs/FORMAT.md), [UPSTREAM](docs/UPSTREAM.md) |

## Next

On the FM-1: progressions and J-6-style phrases synced to tempo (SEQ). Everything else in the plan is in 0.1.

## Licence

GPL-3.0-only. Built on [X0X](https://github.com/charlesvestal/fm1-x0x) (Charles Vestal) and through it
[Felucca](https://github.com/hugelton/Felucca) (Leo Kuroshita, Hügelton Instruments); infrastructure from
[DREADNOUGHT](https://github.com/TwistedGenetics/DREADNOUGHT). Credits in [docs/UPSTREAM.md](docs/UPSTREAM.md). Not
affiliated with M-VAVE. Installing custom firmware is at your own risk.
