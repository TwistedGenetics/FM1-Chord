# Recovery — read this before you flash anything

Installing custom firmware on the FM-1 is at your own risk. The FM-1 keeps **one** copy of its firmware in a 1 MB
flash (no second bank to fall back to). Under it sits the chip's own mask-ROM boot mode, which no firmware can break.
This page starts with the case that matters right now — an FM-1 that went black during an update — then covers
everyday safety.

## A black FM-1: no screen, no lights but the charge light, no USB after a cable was pulled mid-update

This is the known failure of the older Felucca-family update loader: it wrote the app from the bottom up, so a cut
install left a **valid app header over a half-written app**. The boot stage starts that broken app, which hangs
before USB comes up. Nothing on the computer side (flasher, Workbench, M-UPGRADE) can reach it, because the FM-1 never
appears on USB. (FM1-Chord's packages carry DREADNOUGHT 0.43's fixed loader, which erases the header first and writes
it last, so a cut FM1-Chord install comes back in update mode instead.)

Work down this list. Stop at the first step that works.

### 1. Rule out the easy things (5 minutes)

1. Charge it for an hour on a plain USB charger.
2. Try a different, known **data** cable straight into the computer (no hub), and a second computer if you have one.
3. Look for the chip's boot mode on USB. It shows up as **`WL80UBOOT1.00`**, USB id **`4C4A:8057`**:
   - Mac: Apple menu › About This Mac › More Info › System Report › USB.
   - Windows: Device Manager (it may appear as an unknown device).
   - Linux: `lsusb`.
4. Hold **OCT−** and **OCT+** together while switching on, and keep holding for 5 s. (On a working X0X-platform
   firmware that enters the boot mode; on a hung one it usually does nothing, but it costs nothing to try.)

**If `4C4A:8057` appears**, the chip is in boot mode and you can rescue over plain USB with X0X's
[`tools/fm1_rescue.py`](https://github.com/charlesvestal/fm1-x0x) (it is in this repo too, at
`x0x-firmware/tools/fm1_rescue.py`). It backs up the whole flash first, checks the chip and flash IDs, writes only
the firmware sectors that differ from stock V15 (never the bootloader) and verifies. It needs the official
`FM-1.fwsc` V15 (see "The stock firmware file" below). On a Mac run it with `sudo`; on Windows install the WinUSB
driver for `4C4A:8057` with Zadig first. Then go to step 3.

**If nothing appears on USB at all** (the usual case after a cut install), go to step 2.

### 2. FM-1 Transporter: reach the chip through its USB pins (about £5 of parts, 30 minutes)

[**FM-1 Transporter**](https://github.com/kurogedelic/FM-1-transporter) (MIT) is a tiny RP2040 board that talks to the
FM-1's chip directly on its USB data lines, below any firmware. It dumps the whole flash first and writes only
`0x4000`–`0x93000`.

What you need:

| | |
|---|---|
| Board | **Seeed XIAO RP2040** (recommended) or a Raspberry Pi Debug Probe |
| Wires | three: **D+**, **D−** and **GND** to the FM-1's USB lines. A spare USB-C cable cut open gives you the wires. **Do not connect VBUS** (red): the FM-1 runs on its battery. |
| XIAO pins | D+ → **D6 (GP0)**, D− → **D7 (GP1)**, GND → GND |
| Loader | `wl82loader.bin` from [jl-uboot-tool](https://github.com/kagaimiq/jl-uboot-tool) (not included in Transporter) |
| Browser | Chrome or Edge (Web Serial), or Python 3 with `pyserial` for the command line |

Steps:

1. Download the UF2 for your board from Transporter's Releases. Hold BOOTSEL on the XIAO, plug it in, copy the UF2 to
   the `RPI-RP2` drive.
2. Wire D+, D−, GND (no VBUS). Charge the FM-1 first.
3. Open the [Transporter web app](https://kurogedelic.github.io/FM-1-transporter/web/) in Chrome, **Connect** (pick
   its second serial port), choose `wl82loader.bin`.
4. **A black-screen unit:** switch the FM-1 **off**, press **Reconnect** (this is `rekey`), then switch the FM-1
   **on**. Press **Check**: it should report the chip.
5. **Back up** — reads the whole flash twice and saves it. Keep this file: it is your way back to exactly where you
   are now.
6. **Write** the firmware. The command line takes an FM-1 package directly:

   ```sh
   python3 tools/fm1t.py --loader wl82loader.bin dump backup.bin                       # if you skipped step 5
   python3 tools/fm1t.py --loader wl82loader.bin write --package FM-1_015.fwsc --ref backup.bin            # check only
   python3 tools/fm1t.py --loader wl82loader.bin write --package FM-1_015.fwsc --ref backup.bin --write    # write
   ```

   (The web app wants a full 1 MB flash image instead of a package; the command line is simpler here.) Write the
   **stock V15** first, to get a known-good FM-1 back. Once the FM-1 starts and shows up on USB again, install
   FM1-Chord the normal way (step 3). A FM1-Chord package also carries a complete image of that area and can be
   written the same way, but go through stock first the first time.
7. Power-cycle the FM-1 before using it over USB again.

### 3. Back to normal

- Check the FM-1 starts on the stock screen and appears on USB as an FM-1.
- Install FM1-Chord with the [web flasher](https://twistedgenetics.github.io/FM1-Chord-/flasher/) (Chrome or Edge),
  following "Before every install" below.

### The stock firmware file

- M-VAVE's own updater page and the [FM1 Workbench](https://open.m-vave.com/fm1-workbench) ("return to V15").
- M-VAVE publish the stock V15 package in their open-source repo:
  [`m-vave/fm1_open`](https://github.com/m-vave/fm1_open), file `sdk/firmware/FM-1_015.fwsc`, Apache-2.0,
  SHA-256 `db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a`. Check the hash before writing it.

If none of this works, the FM-1 may have a hardware fault; M-VAVE support or a return is the next step.

## Before every install

1. **Back up**, with the tool that belongs to the firmware on the box: stock / FM1 Open → the Workbench; SLOOP,
   Felucca, Clipper, DREADNOUGHT → their editor's backup; FM1-Chord → the editor's **FM-1** tab (Open each user set,
   then **Save file**).
2. Charge the battery; use a data cable straight into the computer (no hub).
3. Close every other app and tab that uses MIDI (Ableton, other editors, M-UPGRADE).
4. Keep the computer awake and the tab open until it says Done. **Don't unplug during an install.**

Firmware formats are not interchangeable: sets, projects and samples from one firmware don't open in another.

## If something goes wrong later

| What you see | What to do |
|---|---|
| The install stopped part-way (cable pulled, tab closed) | FM1-Chord's loader leaves the FM-1 in update mode: plug back in, open the flasher, press **Install** again. It resumes. |
| FM1-Chord crashes twice while starting | It opens **SAFE MODE** by itself (no sound, USB on): reinstall from the flasher, or PLAY to try again. |
| FM1-Chord won't start at all | Hold **OCT−** and **OCT+** for 5 s: the chip's update mode. After four failed starts it goes there by itself. |
| You want the official firmware back | M-VAVE's Workbench (return to V15) or M-UPGRADE with V15 from m-vave.com. |
| Black screen, nothing on USB | The section at the top of this page. |

## For FM1-Chord developers

- Never flash a build whose host tests or package checks failed in CI.
- Every package is checked twice: SHA-256 in the browser before writing, CRC by the loader before starting.
- Changes to the update loader, the package identity or the flash layout need a recovery test with
  `fm1_rescue.py` and a Transporter ready first.
- The boot-loop guard, safe mode and the OCT− + OCT+ update entry come from X0X's platform unchanged
  (`src/hardware/fc_main_fm1.c`); keep them that way.
