// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: live sync between the editor and the FM-1 (0.4). Editor → FM-1: opening a factory set selects it on
// the FM-1; any other set, and every edit, goes to the FM-1's working set (debounced, one frame in flight, the
// newest wins). FM-1 → editor: the FM-1 sends an event frame (48) when its panel loads, edits or saves a set;
// this pulls the working set and hands it to the editor, which shows it without sending it back.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { WORKING } from "./device.js";

export const EVT = { LOADED: 1, EDITED: 2, SAVED: 4 };

export class LiveSync {
  constructor(dev, { delay = 120 } = {}) {
    this.dev = dev; this.on = true; this.delay = delay;
    this.timer = null; this.busy = false; this.next = null; this.pulling = Promise.resolve();
    this.onerror = () => {};
    this.onremote = null;                            // ({ kind, cur, dirty, set }) => the editor shows it
    this.onsent = () => {};
    dev.onevent = (e) => this.remote(e);
  }
  get active() { return this.on && this.dev.connected; }
  // the editor opened a set: a factory set is selected on the FM-1 (so it knows which set it is); others play as
  // the working set
  open(set, factorySlot = -1) {
    if (!this.active) return;
    this.queue(factorySlot >= 0 ? { select: factorySlot } : { set }, false);
  }
  edit(set) { if (this.active) this.queue({ set }, true); }
  queue(job, debounce) {
    this.next = job;
    clearTimeout(this.timer);
    this.timer = null;
    if (debounce) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delay);
    else this.flush();
  }
  async flush() {
    if (this.busy || !this.next) return;
    const j = this.next;
    this.next = null; this.busy = true;
    try {
      if (j.select !== undefined) { await this.dev.select(j.select); this.dev.info = await this.dev.getInfo(); }
      else await this.dev.putSet(WORKING, j.set);
      this.onsent(j);
    } catch (e) { this.onerror(e); }
    this.busy = false;
    if (this.next && !this.timer) this.flush();     // came in while this one was on the wire
  }
  // settle: resolves when nothing is waiting to go to the FM-1 (tests; before Save)
  async idle() {
    for (let i = 0; i < 200 && (this.busy || this.next); i++) await new Promise((r) => setTimeout(r, 20));
    await this.pulling;
  }
  remote(e) {
    if (!this.on || !this.onremote) return;
    this.pulling = this.pulling.then(async () => {
      try {
        const info = await this.dev.getInfo();
        this.dev.info = info;
        const set = e.kind & (EVT.LOADED | EVT.EDITED | EVT.SAVED) ? await this.dev.getSet(WORKING) : null;
        this.onremote({ kind: e.kind, cur: info.cur, dirty: !!e.dirty, set });
      } catch (err) { this.onerror(err); }
    });
  }
}
