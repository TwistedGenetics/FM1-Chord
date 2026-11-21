#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""FM1-Chord: the factory sounds and chord sets for the firmware, from web/editor/presets.json (the one source the
editor reads too).

    tools/gen_presets.py OUT.h          (C header: FC_SOUNDS[], FC_FACTORY[])
    tools/gen_presets.py --bin DIR      (each factory set as DIR/<n>.bin, 376 bytes: the host tests compare them with
                                         what the editor's setcodec.js makes from the same JSON)

Copyright (C) 2026 Jamie (TwistedGenetics)."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# the order of src/core/fc_chord.h's FC_Q_* (the storage format)
QUALITIES = ["", "m", "7", "maj7", "m7", "9", "m9", "11", "13", "sus2", "sus4", "dim", "aug", "add9", "6", "m6", "5",
             "m11", "m7b5", "dim7", "maj9", "7sus4", "7#9", "7b9", "7#5", "mmaj7", "maj7#11", "7#11", "m13", "69"]
ALIASES = {"maj": "", "min": "m", "M7": "maj7", "-": "m", "-7": "m7", "ø": "m7b5", "o": "dim", "o7": "dim7",
           "+": "aug", "6/9": "69", "sus": "sus4", "power": "5", "aug7": "7#5", "m(maj7)": "mmaj7"}
VOICINGS = ["close", "open", "drop2", "drop3", "spread"]
WAVES = ["saw", "square", "tri", "sine", "organ", "pulse"]
SCALES = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonic minor", "melodic minor"]
MODES = ["chord", "strum", "arp"]
RATES = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"]
DIRS = {"up": 0, "down": 1, "alt": 2, "updown": 2, "random": 3}
NOTES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SOUND_FIELDS = ["type", "wave_a", "wave_b", "detune", "b_level", "sub", "fm", "cutoff", "res", "fenv", "ftrack",
                "amp_a", "amp_d", "amp_s", "amp_r", "flt_a", "flt_d", "flt_s", "flt_r", "chorus", "rev_mix", "rev_size",
                "level", "vel_sens"]
EMPTY, NOBASS = 0xFF, 0xFF
# the sound's part 2 (0.6; fc_sound2_t): names as presets.json and the editor write them
FMODES = ["lp", "bp", "hp", "notch"]
LWAVES = ["sine", "tri", "saw", "square", "s&h"]
MSRC = ["none", "lfo1", "lfo2", "menv", "velocity", "key", "macro1", "macro2", "macro3", "macro4"]
MDST = ["none", "pitch", "cutoff", "resonance", "osc b", "fm", "pulse width", "amp", "detune", "sub", "drive",
        "filter env", "lfo1 rate", "delay mix", "reverb mix", "chorus"]
DIVS = ["1/32", "1/16T", "1/16", "1/8T", "1/16D", "1/8", "1/4T", "1/8D", "1/4", "1/4D", "1/2", "1 bar", "2 bars",
        "4 bars", "8 bars"]


def sound2_bytes(s):
    """the sound's "x" (all optional) -> 40 bytes, fc_sound2_default's values where not given"""
    x = s.get("x", {})
    l1 = {"wave": "sine", "rate": 64, "sync": 0, **x.get("lfo1", {})}
    l2 = {"wave": "sine", "rate": 40, "sync": 0, **x.get("lfo2", {})}
    menv = x.get("menv", [40, 80, 0, 70])
    mods = x.get("mod", [])
    assert len(mods) <= 6, (s["name"], "six modulations at most")
    macros = x.get("macros", [64, 64, 64, 64])
    d = {"time": "1/8D", "fb": 50, "mix": 0, "tone": 80, "mode": "stereo", **x.get("delay", {})}
    b = [FMODES.index(x.get("filter", "lp")), {12: 0, 24: 1}[x.get("slope", 12)], x.get("drive", 0),
         LWAVES.index(l1["wave"]), LWAVES.index(l2["wave"]), l1["rate"], l2["rate"], l1["sync"], l2["sync"], *menv]
    for i in range(6):
        if i < len(mods):
            src, dst, amt = mods[i]
            assert -127 <= amt <= 127, (s["name"], mods[i])
            b += [MSRC.index(src), MDST.index(dst), amt & 0xFF]
        else:
            b += [0, 0, 0]
    b += list(macros) + [DIVS.index(d["time"]), d["fb"], d["mix"], d["tone"], {"stereo": 0, "pingpong": 1}[d["mode"]]]
    assert len(b) == 40 and all(0 <= v <= 255 for v in b), (s["name"], b)
    for v in b[:13] + b[31:40]:
        assert v <= 127, (s["name"], b)
    return b


def pitch(s):
    m = re.match(r"([A-G])([#b]?)", s)
    if not m:
        raise ValueError(f"no note in {s!r}")
    return (NOTES[m[1]] + {"#": 1, "b": -1, "": 0}[m[2]]) % 12, len(m[0])


def parse_chord(text):
    """'Fm9/Db i1 drop2 +1' -> dict(root, quality, inversion, voicing, bass, octave); '-' or '' -> None"""
    text = text.strip()
    if text in ("", "-"):
        return None
    words = text.split()
    sym, rest = words[0], words[1:]
    root, k = pitch(sym)
    tail = sym[k:]
    bass = NOBASS
    m = re.fullmatch(r"\*([0-9.]+)(?:/(.+))?", tail)       # custom notes: "C*0.3.7.14"
    if m:
        mask = 0
        for x in m[1].split("."):
            v = int(x)
            if not 0 <= v < 32:
                raise ValueError(f"bad custom note in {text!r}")
            mask |= 1 << v
        c = {"root": root, "quality": 31, "custom": mask, "inversion": 0, "voicing": 0,
             "bass": pitch(m[2])[0] if m[2] else NOBASS, "octave": 0}
        for w in rest:
            if re.fullmatch(r"[+-][0-2]", w):
                c["octave"] = int(w)
            else:
                raise ValueError(f"unknown word {w!r} in {text!r}")
        return c
    if "/" in tail:
        tail, b = tail.rsplit("/", 1)
        bass, kb = pitch(b)
        if kb != len(b):
            raise ValueError(f"bad bass in {text!r}")
    tail = ALIASES.get(tail, tail)
    if tail not in QUALITIES:
        raise ValueError(f"unknown chord quality {tail!r} in {text!r}")
    c = {"root": root, "quality": QUALITIES.index(tail), "inversion": 0, "voicing": 0, "bass": bass, "octave": 0}
    for w in rest:
        if re.fullmatch(r"i[0-3]", w):
            c["inversion"] = int(w[1])
        elif w in VOICINGS:
            c["voicing"] = VOICINGS.index(w)
        elif re.fullmatch(r"[+-][0-2]", w):
            c["octave"] = int(w)
        else:
            raise ValueError(f"unknown word {w!r} in {text!r}")
    return c


def sound_bytes(s, idx):
    out = []
    for f in SOUND_FIELDS:
        if f == "type":
            out.append(idx)
        elif f in ("wave_a", "wave_b"):
            out.append(WAVES.index(s[f]))
        else:
            v = int(s[f])
            assert 0 <= v <= 127, (s["name"], f, v)
            out.append(v)
    return out


def sx_init(b):
    """40 bytes -> a C initialiser for fc_sound2_t"""
    sb = lambda v: v - 256 if v > 127 else v
    mods = ", ".join(f"{{{b[13 + 3 * k]}, {b[14 + 3 * k]}, {sb(b[15 + 3 * k])}}}" for k in range(6))
    return (f"{b[0]}, {b[1]}, {b[2]}, {{{b[3]}, {b[4]}}}, {{{b[5]}, {b[6]}}}, {{{b[7]}, {b[8]}}}, "
            f"{b[9]}, {b[10]}, {b[11]}, {b[12]}, {{{mods}}}, {{{b[31]}, {b[32]}, {b[33]}, {b[34]}}}, "
            f"{b[35]}, {b[36]}, {b[37]}, {b[38]}, {b[39]}")


def set_bytes(st, sounds):
    names = [s["name"] for s in sounds]
    si = names.index(st["sound"])
    p = st["play"]
    b = list(b"FC") + [2, 27]
    nm = st["name"].encode("ascii")[:16]
    b += list(nm) + [0] * (16 - len(nm))
    b += [pitch(st["key"])[0], SCALES.index(st["scale"]), int(st["tempo"]), 0]
    b += sound_bytes(sounds[si], si)
    b += [MODES.index(p["mode"]), p["strum"], DIRS[p["strum_dir"]], RATES.index(p["arp_rate"]), DIRS[p["arp_dir"]],
          p["arp_oct"], p["arp_gate"], p["latch"], p["voice_lead"], p["humanise"], p["transpose"] & 0xFF,
          p["octave"] & 0xFF, 50, 0, 0, 0]
    assert len(st["chords"]) == 27, st["name"]
    for t in st["chords"]:
        c = parse_chord(t)
        if c is None:
            b += [0, EMPTY, 0, 0, 0, 0, 0, NOBASS, 0, 0]
        else:
            cm = c.get("custom", 0)
            b += [c["root"], c["quality"], cm & 0xFF, (cm >> 8) & 0xFF, (cm >> 16) & 0xFF, c["inversion"], c["voicing"],
                  c["bass"], c["octave"] & 0xFF, (cm >> 24) & 0xFF]
    b += [0, 0]
    b += sound2_bytes(sounds[si])
    assert len(b) == 376, len(b)
    return bytes(b)


def main():
    data = json.loads((ROOT / "web" / "editor" / "presets.json").read_text())
    sounds, sets = data["sounds"], data["sets"]
    if len(sys.argv) == 3 and sys.argv[1] == "--bin":
        d = Path(sys.argv[2])
        d.mkdir(parents=True, exist_ok=True)
        for i, st in enumerate(sets):
            (d / f"{i}.bin").write_bytes(set_bytes(st, sounds))
        return
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    L = ["/* generated by tools/gen_presets.py from web/editor/presets.json: do not edit */", "#pragma once",
         '#include "fc_set.h"', "",
         "typedef struct { const char *name; const char *file; fc_sound_t snd; fc_sound2_t sx; } fc_sound_preset_t;",
         f"#define FC_NSOUNDS {len(sounds)}u",
         "static const fc_sound_preset_t FC_SOUNDS[FC_NSOUNDS] = {"]
    for i, s in enumerate(sounds):
        L.append(f'    {{"{s["name"]}", "{s["file"]}", {{{", ".join(map(str, sound_bytes(s, i)))}}}, '
                 f'{{{sx_init(sound2_bytes(s))}}}}},')
    L += ["};", "", f"#define FC_NFACTORY {len(sets)}u",
          "/* the factory sets, byte for byte (fc_set_t is all bytes) */",
          f"static const uint8_t FC_FACTORY[FC_NFACTORY][FC_SET_BYTES] = {{"]
    for st in sets:
        b = set_bytes(st, sounds)
        L.append(f"    /* {st['name']} */ {{")
        for i in range(0, len(b), 24):
            L.append("        " + ", ".join(f"0x{x:02x}" for x in b[i:i + 24]) + ",")
        L.append("    },")
    L += ["};", ""]
    Path(sys.argv[1]).write_text("\n".join(L))


if __name__ == "__main__":
    main()
