// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: a simulated FM-1 running FM1-Chord, for the editor's demo mode (?demo) and the tests. It answers the
// same frames src/app/fc_editor.c does, from the same set bytes. Copyright (C) 2026 Jamie (TwistedGenetics).
import { encodeSet, decodeSet, pack7, unpack7, SET_BYTES } from "./setcodec.js";

export function mockFM1(factorySets, { name = "FM1-Chord FM-1", version = "0.1 DEMO" } = {}) {
  const user = Array.from({ length: 20 }, () => null);
  let working = encodeSet(factorySets[0]), cur = 64;
  const input = { id: "mock-in", name, manufacturer: "M-VAVE", state: "connected", type: "input", onmidimessage: null };
  const reply = (cmd, body) => {
    const d = Uint8Array.from([0xf0, 0x7d, 0x46, 0x4c, cmd, ...body.map((x) => x & 0x7f), 0xf7]);
    setTimeout(() => input.onmidimessage && input.onmidimessage({ data: d }), 15);
  };
  const str = (s, n) => { const a = []; for (let i = 0; i < n; i++) a.push(i < s.length ? s.charCodeAt(i) & 0x7f : 0); return a; };
  const handle = (d) => {
    if (d[0] !== 0xf0 || d[1] !== 0x7d || d[2] !== 0x46 || d[3] !== 0x4c) return;
    const cmd = d[4], a = Array.from(d.slice(5, d.length - 1));
    switch (cmd) {
      case 40: reply(cmd, [...str(`FM1-Chord ${version}`, 24).filter((x) => x), 0, 1, factorySets.length, 20, cur, 0]); break;
      case 41: {
        const s = a[0];
        const b = s === 127 ? working : s >= 64 ? (factorySets[s - 64] ? encodeSet(factorySets[s - 64]) : null) : user[s];
        reply(cmd, b ? [s, 1, ...pack7(b)] : [s, 0]);
        break;
      }
      case 42: {
        const s = a[0], b = unpack7(a.slice(1), SET_BYTES);
        if (b.length !== SET_BYTES) { reply(cmd, [s, 1]); break; }
        if (!decodeSet(b)) { reply(cmd, [s, 2]); break; }
        if (s === 127) working = b;
        else if (s < 20) { user[s] = b; if (cur === s) working = b; }
        else { reply(cmd, [s, 4]); break; }
        reply(cmd, [s, 0]);
        break;
      }
      case 43: {
        const out = [20];
        for (let k = 0; k < 20; k++) {
          const s = user[k] ? decodeSet(user[k]) : null;
          out.push(s ? 1 : 0, ...str(s ? s.name : "", 16));
        }
        reply(cmd, out);
        break;
      }
      case 44: {
        const s = a[0];
        const b = s >= 64 ? (factorySets[s - 64] ? encodeSet(factorySets[s - 64]) : null) : user[s];
        if (b) { working = b; cur = s; }
        reply(cmd, [s, b ? 0 : 1]);
        break;
      }
      default: break;                                // KEY and unknown: no reply
    }
  };
  const output = { id: "mock-out", name, manufacturer: "M-VAVE", state: "connected", type: "output", send: (d) => handle(Uint8Array.from(d)) };
  const access = { inputs: new Map([["mock-in", input]]), outputs: new Map([["mock-out", output]]), onstatechange: null, sysexEnabled: true };
  return { access, user, get working() { return decodeSet(working); } };
}
