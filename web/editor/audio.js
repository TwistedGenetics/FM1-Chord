// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: starting the preview sound. An AudioWorklet where the browser has one (Chrome, Edge, Safari on a
// website); otherwise (the iPad app's own scheme can refuse worklets) the same engine on a ScriptProcessor.
// iPad and iPhone only let sound start from a tap, so the first tap anywhere calls start().
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { Engine } from "./engine.js";

export class Preview {
  constructor() {
    this.ctx = null;
    this.send = () => {};
    this.listeners = [];
    this.pending = [];
    this.kind = "";
  }
  onEvent(f) { this.listeners.push(f); }
  emit(m) { for (const f of this.listeners) f(m); }
  post(m) {
    if (!this.ctx) { if (m.type === "set") this.pending = this.pending.filter((x) => x.type !== "set"); this.pending.push(m); return; }
    this.send(m);
  }
  async start() {
    if (this.ctx) { if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("no Web Audio here");
    const ctx = new AC({ latencyHint: "interactive" });
    this.ctx = ctx;
    let ok = false;
    if (ctx.audioWorklet && window.isSecureContext !== false) {
      try {
        await ctx.audioWorklet.addModule(new URL("./worklet.js", import.meta.url));
        const node = new AudioWorkletNode(ctx, "fc-engine", { numberOfInputs: 0, outputChannelCount: [2] });
        node.port.onmessage = (e) => this.emit(e.data);
        node.connect(ctx.destination);
        this.send = (m) => node.port.postMessage(m);
        this.kind = "AudioWorklet";
        ok = true;
      } catch (e) {
        console.warn("AudioWorklet failed, using a ScriptProcessor", e);
      }
    }
    if (!ok) {
      const engine = new Engine(ctx.sampleRate, (m) => this.emit(m));
      const sp = ctx.createScriptProcessor(1024, 0, 2);
      sp.onaudioprocess = (e) => {
        const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
        engine.process(L, R, L.length);
      };
      sp.connect(ctx.destination);
      this.send = (m) => engine.message(structuredClone(m));   // a copy, as postMessage makes: edits to the
      // set are then seen as changes (a shared object hid new sounds from the synth)
      this.kind = "ScriptProcessor";
    }
    for (const m of this.pending) this.send(m);
    this.pending = [];
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
  }
}
