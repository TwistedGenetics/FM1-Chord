// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: talking to the FM-1 over MIDI (Web MIDI with SysEx in Chrome / Edge; in the iPad app, CoreMIDI behind
// the same API). The frames are Felucca's editor frames, F0 7D 46 4C cmd ... F7, with FM1-Chord's commands
// (docs/PROTOCOL.md; src/app/fc_editor.c answers them). Copyright (C) 2026 Jamie (TwistedGenetics).
import { encodeSet, decodeSet, pack7, unpack7, SET_BYTES, SET_BYTES_V1 } from "./setcodec.js";

export const CMD = { INFO: 40, SET_GET: 41, SET_PUT: 42, NAMES: 43, SELECT: 44, KEY: 45, GLOBALS_GET: 46, GLOBALS_PUT: 47, EVT: 48 };
export const WORKING = 127, FACTORY0 = 128, NUSER = 20;
// protocol 2 (0.3): set numbers are two 7-bit bytes, hi lo; 3 (0.6): sets are 376 bytes (older firmware gets 336)
const slot2 = (s) => [(s >> 7) & 0x7f, s & 0x7f];
const HDR = [0xf0, 0x7d, 0x46, 0x4c];
export const FM1_PORT = /fm-?1|fm1-chord|felucca|sloop|dreadnought|x0x/i;

export class Device {
  constructor() {
    this.access = null; this.input = null; this.output = null; this.waiting = []; this.info = null;
    this.onchange = () => {};
    this.onevent = null;                              // live sync: the FM-1's panel changed its set (frame 48)
    this.onnote = null;                               // notes the FM-1 sends (its keys, to light the editor's)
  }
  get connected() { return !!(this.input && this.output); }
  ports() {
    if (!this.access) return { inputs: [], outputs: [] };
    return { inputs: [...this.access.inputs.values()], outputs: [...this.access.outputs.values()] };
  }
  async connect(access, preferName) {
    this.access = access;
    const { inputs, outputs } = this.ports();
    const pick = (list) => list.find((p) => preferName && p.name === preferName) || list.find((p) => FM1_PORT.test(p.name));
    this.input = pick(inputs) || null;
    this.output = pick(outputs) || null;
    if (!this.connected) { this.onchange(); throw new Error("No FM-1 found on MIDI. Plug it in, switch it on, and close other apps using its MIDI port."); }
    this.input.onmidimessage = (e) => this.recv(e.data);
    access.onstatechange = () => {
      if (this.input && this.input.state === "disconnected") { this.input = this.output = null; this.info = null; this.onchange(); }
    };
    this.info = await this.getInfo();
    this.onchange();
    return this.info;
  }
  disconnect() {
    if (this.input) this.input.onmidimessage = null;
    this.input = this.output = null; this.info = null; this.onchange();
  }
  recv(d) {
    if (d[0] === 0xf0 && d[1] === 0x7d && d[2] === 0x46 && d[3] === 0x4c) {
      const cmd = d[4], body = Array.from(d.slice(5, d.length - 1));
      if (cmd === CMD.EVT) {                          // never a reply: kind, set hi lo, dirty
        if (this.onevent) this.onevent({ kind: body[0], cur: (body[1] << 7) | body[2], dirty: body[3] });
        return;
      }
      const i = this.waiting.findIndex((w) => w.cmd === cmd);
      if (i >= 0) { const w = this.waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(body); }
      return;
    }
    if (this.onnote && (d[0] & 0xe0) === 0x80) this.onnote(d);
  }
  send(cmd, args = [], reply = true, timeout = 2500) {
    if (!this.connected) return Promise.reject(new Error("not connected"));
    const frame = [...HDR, cmd, ...args.map((x) => x & 0x7f), 0xf7];
    if (!reply) { this.output.send(frame); return Promise.resolve(null); }
    return new Promise((resolve, reject) => {
      const w = { cmd, resolve, timer: setTimeout(() => {
        this.waiting = this.waiting.filter((x) => x !== w);
        reject(new Error("The FM-1 didn't answer. Is FM1-Chord installed on it?"));
      }, timeout) };
      this.waiting.push(w);
      this.output.send(frame);
    });
  }
  async getInfo() {
    const b = await this.send(CMD.INFO);
    let i = 0, name = "";
    while (i < b.length && b[i]) name += String.fromCharCode(b[i++]);
    i++;
    if (b[i] < 2) throw new Error("This FM-1 has an older FM1-Chord: install the newest one with the flasher.");
    return { name, proto: b[i], nfactory: b[i + 1], nuser: b[i + 2], cur: (b[i + 3] << 7) | b[i + 4], flags: b[i + 5] };
  }
  async getSet(slot) {
    const b = await this.send(CMD.SET_GET, slot2(slot));
    if (((b[0] << 7) | b[1]) !== slot || !b[2]) return null;
    return decodeSet(unpack7(b.slice(3), SET_BYTES));
  }
  async putSet(slot, set) {
    let bytes = encodeSet(set);
    if (this.info && this.info.proto < 3) { bytes = bytes.slice(0, SET_BYTES_V1); bytes[2] = 1; }   // 0.3 .. 0.5 firmware
    const b = await this.send(CMD.SET_PUT, [...slot2(slot), ...pack7(bytes)], true, 6000);
    if (((b[0] << 7) | b[1]) !== slot || b[2] !== 0) throw new Error(["", "the FM-1 said the data was the wrong size", "the FM-1 refused the set",
      "the FM-1 couldn't write its flash", "no such slot"][b[2]] || `error ${b[2]}`);
  }
  async names() {
    const b = await this.send(CMD.NAMES);
    const n = b[0], out = [];
    for (let k = 0; k < n; k++) {
      const o = 1 + 17 * k;
      let name = "";
      for (let j = 0; j < 16 && b[o + 1 + j]; j++) name += String.fromCharCode(b[o + 1 + j]);
      out.push({ slot: k, used: !!b[o], name: name.trimEnd() });
    }
    return out;
  }
  async select(slot) {
    const b = await this.send(CMD.SELECT, slot2(slot));
    if (b[2] !== 0) throw new Error("the FM-1 has no set there");
  }
  key(k, vel) { return this.send(CMD.KEY, [k, vel], false); }
}

export async function midiAccess() {
  if (!navigator.requestMIDIAccess) throw new Error("This browser has no Web MIDI. Use Chrome or Edge on a computer, or the FM1-Chord app on iPad.");
  return navigator.requestMIDIAccess({ sysex: true });
}
