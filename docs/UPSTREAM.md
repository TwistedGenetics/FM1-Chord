# Where FM1-Chord's code comes from

Everything is GPL-3.0-only unless a file says otherwise.

**Ours** (Copyright (C) 2026 Jamie / TwistedGenetics): the chord core (`src/core/`), the synth (`src/dsp/`), the app
and its editor commands (`src/app/`), the editor (`web/editor/`), the factory content (`web/editor/presets.json`),
the generators (`tools/gen_presets.py`, `tools/gen_fc_font.py`), the host harness and tests, the docs.

**The platform** is [X0X](https://github.com/charlesvestal/fm1-x0x) by Charles Vestal, a git submodule
(`x0x-firmware/`) pinned to one commit, used the way DREADNOUGHT and Carnac OS use it. Nothing in it is edited: the
build takes X0X's `firmware/src/x0x.c` up to the line where its own app starts and puts ours after it. From X0X (and
through it from [Felucca](https://github.com/hugelton/Felucca) by Leo Kuroshita / Hügelton Instruments, and Melodee):
the HAL, the boot-loop guard and safe mode, the crash screen and watchdog, the panel map and its calibration, the
screen driver, the canvas and fonts, USB MIDI and USB audio, TRS MIDI in, flash storage, the update entry and the
update loader, the package maker and the build checks.

| Part | From | Version | Licence |
|---|---|---|---|
| Platform (`x0x-firmware/`, submodule) | X0X | `5048230b86254581d991121916ede3de0d0c91f6` (the commit DREADNOUGHT 0.44 pins) | GPL-3.0-only (fonts: SIL OFL 1.1, see X0X's `LICENSING.md`) |
| Device glue (`src/hardware/fc_main_fm1.c`) | DREADNOUGHT `src/hardware/dn_main_fm1.c`, after Carnac OS and X0X | DREADNOUGHT 0.44 | GPL-3.0-only |
| Build script (`tools/build_fm1.py`), start-up preflight (`tools/fm1_preflight.py`), deps (`tools/get_deps.sh`) | DREADNOUGHT, after Carnac OS | DREADNOUGHT 0.44 | GPL-3.0-only |
| Update-loader fix (`tools/fc_patches.py`) and its test (`tests/host/ldr_cut_test.c`) | DREADNOUGHT 0.43, after Skiff's loader | | GPL-3.0-only |
| Web flasher (`web/flasher/`), its update-protocol modules (`vendor/`) | DREADNOUGHT's flasher; SLOOP / Felucca `fm1ota.js`, `fm1pkg.js` | SLOOP v2.8.1 | GPL-3.0-only |
| iPad app (`ios/`) | DREADNOUGHT's iPad wrapper | DREADNOUGHT 0.44 | GPL-3.0-only |
| Pages site and workflows (`tools/make_site.py`, `.github/workflows/`) | DREADNOUGHT | | GPL-3.0-only |
| Big font (generated) | Barlow Semi Condensed Bold, in X0X's `assets/fonts` | | SIL OFL 1.1 |
| SVF filter, polyBLEP, Freeverb structure | the published methods (Simper's trapezoidal SVF; Välimäki's polyBLEP; Jezar's Freeverb, public domain), written again here | | GPL-3.0-only |

## Taking platform fixes

Move the submodule to a newer X0X commit, rebuild, run the host tests and the build checks, record the commit above.
`tools/build_fm1.py` and `tools/fc_patches.py` refuse to build if the lines they cut or replace have changed.
