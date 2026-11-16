// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: the factory sets the editor builds from presets.json (setcodec.js) must be the bytes the firmware gets
// (tools/gen_presets.py), and every set must survive encode -> decode -> encode unchanged.
//   python3 tools/gen_presets.py --bin build/host/presets && node tests/host/presets_xcheck.mjs build/host/presets
import { readFileSync } from "node:fs";
import { loadPresets, encodeSet, decodeSet, pack7, unpack7, setToFile, setFromFile } from "../../web/editor/setcodec.js";

const dir = process.argv[2] || "build/host/presets";
const json = JSON.parse(readFileSync(new URL("../../web/editor/presets.json", import.meta.url)));
const { sets } = loadPresets(json);
let bad = 0;
sets.forEach((s, i) => {
  const mine = encodeSet(s), theirs = new Uint8Array(readFileSync(`${dir}/${i}.bin`));
  const at = mine.findIndex((x, j) => x !== theirs[j]);
  if (at >= 0) { console.log(`FAIL ${s.name}: byte ${at} editor ${mine[at]} firmware ${theirs[at]}`); bad++; }
  const again = encodeSet(decodeSet(mine));
  if (again.some((x, j) => x !== mine[j])) { console.log(`FAIL ${s.name}: decode/encode changed it`); bad++; }
  const p = unpack7(pack7(mine));
  if (p.length !== mine.length || p.some((x, j) => x !== mine[j])) { console.log(`FAIL ${s.name}: 7-bit packing`); bad++; }
  const f = encodeSet(setFromFile(setToFile(s)));
  if (f.some((x, j) => x !== mine[j])) { console.log(`FAIL ${s.name}: file round trip`); bad++; }
});
if (bad) process.exit(1);
console.log(`ok   presets_xcheck: ${sets.length} factory sets, the editor's bytes = the firmware's; round trips`);
