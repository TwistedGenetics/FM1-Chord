#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# FM1-Chord's host tests: the chord core and the synth measured, the editor's JavaScript checked against the
# firmware's C, then the whole app driven from a simulated panel (tests/host/scenarios). Pictures of the FM-1's
# screen and the sound land in build/host. Needs cc, python3 (Pillow, fonttools) and node.
set -e
cd "$(dirname "$0")/.."
CC="${CC:-cc}"
mkdir -p build/gen/x0x build/host
python3 tools/gen_presets.py build/gen/fc_presets.h
python3 tools/gen_fc_font.py build/gen/fc_font.h >/dev/null
[ -f build/gen/x0x/felucca_font.h ] || python3 x0x-firmware/tools/gen_font.py build/gen/x0x/felucca_font.h >/dev/null
# the firmware's own rules: C99, no doubles anywhere (-Wdouble-promotion), every warning an error
W="-O2 -std=c99 -Wall -Wextra -Werror -Wdouble-promotion -Wno-unused-function -Isrc/core -Isrc/dsp -Isrc/app -Ibuild/gen -Ibuild/gen/x0x"
CORE="src/core/fc_chord.c src/core/fc_set.c src/core/fc_play.c"
# shellcheck disable=SC2086
$CC $W tests/host/chord_test.c $CORE -o build/host/chord_test
build/host/chord_test
build/host/chord_test dump | node tests/host/chord_xcheck.mjs
# shellcheck disable=SC2086
$CC $W tests/host/synth_test.c src/dsp/fc_synth.c $CORE -o build/host/synth_test
build/host/synth_test build/host
python3 tools/gen_presets.py --bin build/host/presets
node tests/host/presets_xcheck.mjs build/host/presets
# the app on a simulated FM-1 (X0X's screen code as it is, with stubs for the hardware)
# shellcheck disable=SC2086
$CC $W -Wno-unused-parameter -Wno-sign-compare -Ix0x-firmware/firmware/src tests/host/fc_host.c src/dsp/fc_synth.c $CORE -o build/host/fc_host
for s in tests/host/scenarios/*.txt; do
    build/host/fc_host "$s" build/host
done
python3 - <<'PY'
from pathlib import Path
from PIL import Image
for p in Path("build/host").glob("*.ppm"):
    Image.open(p).resize((480, 480), Image.NEAREST).save(p.with_suffix(".png"))
    p.unlink()
PY
node --test web/editor/test/*.test.mjs web/flasher/test/*.test.mjs >build/host/node-tests.txt 2>&1 || { cat build/host/node-tests.txt; exit 1; }
echo "ok   editor and flasher tests ($(grep -c '^ok' build/host/node-tests.txt) passed)"
echo "host tests: all ok"
