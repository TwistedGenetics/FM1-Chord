// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: the preview engine (engine.js) in an AudioWorklet. Copyright (C) 2026 Jamie (TwistedGenetics).
import { Engine } from "./engine.js";

class FcEngine extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate, (m) => this.port.postMessage(m));
    this.port.onmessage = (e) => this.engine.message(e.data);
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    this.engine.process(L, R, L.length);
    return true;
  }
}
registerProcessor("fc-engine", FcEngine);
