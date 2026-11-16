# The FM-1, as FM1-Chord uses it

Every fact here was read from existing open FM-1 firmware projects (16 Nov 2026), not assumed. The sources are at the
bottom. "Unverified" means nobody has measured it on a device yet, as far as we know.

## Hardware

| | | Source |
|---|---|---|
| Chip | JieLi **AC791N / WL82**, `pi32v2` CPU, **2 cores**, about 360 MHz as running | FM-1-RE; X0X; DREADNOUGHT `docs/PLATFORM.md` |
| Floating point | single precision is fine in audio code; **no doubles** (software helpers; the build refuses them) | X0X `tools/build.py`; Carnac OS |
| RAM | about 512 KB internal SRAM, no PSRAM. X0X's map: a 96 KB `.data`/`.bss` region and a ~336 KB pool | `fm1_open` linker script; X0X |
| Flash | **1 MB**, one bank, execute in place. App slot ~568 KB; user store objects in `0x97000`–`0xDFFFF` | X0X `tools/fm1pkg_make.py`, `storage.c` |
| Screen | **240 × 240 colour LCD**, RGB565 | `fm1_open` `fm1.h`; felucca-bsp `boards/fm1` |
| Keys | **27 note keys, F3 – G5**, with LEDs (velocity from the keys exists but is off by default) | X0X `app/plat.h` (`NKEYS 27`); felucca-bsp `fm1_input.h` |
| Buttons | **14** with LEDs: FX, SEL, ENV, LFO, EDIT, GLO, HOME, SAVE, ARP, SEQ, PLAY, REC, OCT−, OCT+ | X0X `app/plat.h` |
| Encoders | **7**: SELECT, ALGO, PRESET, K1 – K4; plus the **MASTER** pot | X0X `app/plat.h` |
| MIDI | USB-MIDI in and out; TRS (3.5 mm) MIDI in on fitted boards; BLE MIDI in stock firmware (not in X0X's platform) | `fm1_open` README; X0X; fm1-base |
| Audio | **44.1 kHz stereo**, built-in speaker and line out; X0X renders 128-frame blocks; also a class-compliant **USB audio** input to the computer | X0X `main_fm1.c`; Felucca `BUILDING.md` |

## What FM1-Chord does with it

| | |
|---|---|
| Keys | one chord per key; LEARN turns them into chromatic notes F3 – G5 (plus the octave) |
| Screen | light background, dark text; the chord's name in 50 px Barlow Bold, inversion / voicing and octave in 24 px |
| Synth | 10 voices, two oscillators + sub + FM, 12 dB SVF with its envelope, amp envelope, stereo chorus, reverb; one core |
| Storage | user sets: 10 in `OBJ_PAT0`, 10 in `OBJ_PAT1` (336 B each); settings in `OBJ_SOUND`; X0X's calibration (`OBJ_PANEL`) untouched |
| MIDI | notes out on a chosen channel (synth, MIDI or both); notes in play the keys (F3 = key 1); MIDI clock in drives the arpeggiator |
| CPU | host measurement: about 120 ns a frame for five voices with chorus and reverb on a PC. On the FM-1: **unverified** |

## Build and update

- The firmware builds on **Linux x86-64** with JieLi's Linux toolchain (clang 4.0.1 for pi32v2) and three files of
  the Apache-2.0 AC79 SDK (`tools/get_deps.sh`): GitHub Actions `ubuntu-latest`. No Windows-only vendor installer.
- Packages are `.fwsc` with X0X's identity scheme `FM-1_9XXYYZZ` (0.1 → `FM-1_9000100`).
- Updates are SysEx over USB-MIDI (Web MIDI in Chrome / Edge): the running firmware stages the update loader, the
  loader writes the image. FM1-Chord's loader writes the app header last (DREADNOUGHT 0.43's fix).

## Sources

| What | Where |
|---|---|
| Keys, buttons, encoders, platform API | [charlesvestal/fm1-x0x](https://github.com/charlesvestal/fm1-x0x) `firmware/src/app/plat.h`, pinned in `x0x-firmware/` |
| Board pins, LCD, key scan, ADC, codec lines | [hugelton/felucca-bsp](https://github.com/hugelton/felucca-bsp) `boards/fm1/` (MPL-2.0) |
| Official SDK headers, MIDI ports, stock V15 image | [m-vave/fm1_open](https://github.com/m-vave/fm1_open) `sdk/include/fm1.h`, README, `sdk/firmware/FM-1_015.fwsc` |
| Linux build, packaging, Felucca-family update protocol | [hugelton/Felucca](https://github.com/hugelton/Felucca) `BUILDING.md`, `web/fm1ota.js` |
| Measured clock, RAM / flash budget, CPU | [TwistedGenetics/DREADNOUGHT](https://github.com/TwistedGenetics/DREADNOUGHT) `docs/PLATFORM.md` (and its sources) |
| Chip-level recovery | [kurogedelic/FM-1-transporter](https://github.com/kurogedelic/FM-1-transporter); X0X `tools/fm1_rescue.py` |
