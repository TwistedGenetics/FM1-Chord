# The editor protocol

SysEx over USB-MIDI, in Felucca's editor frames: `F0 7D 46 4C cmd args… F7`. Every byte inside is 7-bit. Data bytes
are packed 7 to 8: a byte holding the top bits of the next seven, then those seven with their top bit cleared
(`pack7` in `web/editor/setcodec.js`, `fc_ed_pack` in `src/app/fc_editor.c`). Replies come back in the same frame
with the same `cmd`.

Set numbers: `0`–`19` user sets (in flash), `127` the **working** set (what the keys play now; not saved),
`128 + n` factory set *n*. From protocol 2 (0.3) a set number is sent as **two bytes, high then low** (`n >> 7`,
`n & 127`): factory set 0 is `01 00`, the working set `00 7F`. (Protocol 1, 0.1–0.2: one byte, factory sets from 64.)

| cmd | Name | Request | Reply |
|---|---|---|---|
| 1 | INFO (Felucca's) | — | name (ASCII, 0-ended), six 0s |
| 25 | PING (Felucca's) | — | 0 |
| 40 | FC_INFO | — | name (ASCII, 0-ended), protocol (3), factory sets, user slots (20), current set (2 bytes), working set changed (0/1) |
| 41 | SET_GET | set (2 bytes) | set (2 bytes), ok (1/0), then if ok: the 376-byte set packed (430 bytes) |
| 42 | SET_PUT | set (2 bytes), the set packed | set (2 bytes), rc: 0 ok, 1 wrong size, 2 not a set, 3 flash write failed, 4 no such slot. A user slot is saved to flash; if it is the current set, or the working set, the keys play it at once |
| 43 | NAMES | — | 20, then per user slot: used (1/0), 16 name bytes |
| 44 | SELECT | set (2 bytes) | set (2 bytes), rc (0 ok, 1 nothing there). Remembered across restarts |
| 45 | KEY | key 0–26, velocity (0 = up) | none: plays the key as if pressed (the editor's audition) |
| 46 | GLOBALS_GET | — | the 16-byte settings packed |
| 47 | GLOBALS_PUT | the 16-byte settings packed | rc |
| 48 | EVT (0.4, **sent by the FM-1**) | — never asked for | what changed (bits: 1 loaded a set, 2 edited, 4 saved), current set (2 bytes), working set changed (0/1) |

**Protocol 3 (0.6):** sets are 376 bytes (docs/FORMAT.md). SET_PUT still takes a 336-byte version 1 set from an
older editor (its sound gets part 2's defaults); the editor sends older firmware (protocol 2) the first 336 bytes.

**Live sync (0.4).** The FM-1 sends EVT (at most every 120 ms) when its own panel loads, edits or saves a set; the
editor answers by reading INFO and the working set (41, `00 7F`). Changes the editor makes (42, 44) are not
announced back. A SET_PUT to the working set that keeps the chords as they were (only the sound or the name
changed) doesn't stop notes that are sounding.

Commands 42 and 47 are "long" frames (over 64 bytes): the firmware handles them in place in the receive buffer
(640 bytes). The flasher's own frames (M-UPGRADE) are not editor frames and go to the update code as in every
Felucca-family firmware.

`web/editor/mock-fm1.js` answers the same commands, for the demo and the tests.
