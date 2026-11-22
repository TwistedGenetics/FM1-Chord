// SPDX-License-Identifier: GPL-3.0-only
// FM1-Chord: the editor inside the Ableton Live device (0.13). In Max's web view (jweb) there's a window.max; the
// editor then plays nothing itself: the chord player in the device (fm1chord.js) plays the track's instrument.
// MaxPreview takes the editor's preview messages (the set, keys pressed, notes to hear) and sends them to the
// device; the device calls window.__fcIn(name, data) to light the keys played in Live and to hand back the set
// and My sets kept in the Live set. Outside Max nothing here runs.
// Copyright (C) 2026 Jamie (TwistedGenetics).
import { setToFile } from "./setcodec.js";

// the page made for the device (gen_m4l) says so itself: window.max can come later than the page's code
export const HOST = typeof window !== "undefined" && (!!window.__FC_HOSTED || (!!window.max && typeof window.max.outlet === "function"));

// to the device: window.max.outlet; without it, Max's other way, a maxmessage: link
const out = (...a) => {
  if (window.max && typeof window.max.outlet === "function") { try { window.max.outlet(...a); return; } catch (e) { console.warn("max.outlet", e); } }
  const l = document.createElement("a");
  l.href = "maxmessage:" + a.map((x) => encodeURIComponent(String(x))).join("/");
  document.body.append(l); l.click(); l.remove();
};

export class MaxPreview {
  constructor() {
    this.ctx = { state: "running" };             // the editor checks ctx to know sound is on: it always is
    this.kind = "Ableton";
    this.listeners = [];
    this.timer = null;
    this.next = null;
  }
  onEvent(f) { this.listeners.push(f); }
  async start() {}
  post(m) {
    if (m.type === "set") {                       // every edit: a few a second at most, the newest wins
      this.next = m.set;
      if (!this.timer) this.timer = setTimeout(() => this.flush(), 40);
    } else if (m.type === "key") {
      this.flush();                               // a key after an edit plays the edited chord
      out("key", m.key, m.vel | 0);
    } else if (m.type === "notes") out("notes", ...(m.vel ? m.notes : []));
    else if (m.type === "stop") out("stopall");
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.next) { out("set", setToFile(this.next)); this.next = null; }
  }
}

// the device -> the editor: window.__fcIn(name, data), called from the device by executejavascript
export function hostListen(handlers) {
  window.__fcIn = (name, data) => { try { handlers[name] && handlers[name](data); } catch (e) { console.warn(name, e); } };
}
export const hostSay = out;
