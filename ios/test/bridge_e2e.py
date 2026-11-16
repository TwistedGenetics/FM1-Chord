#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""The iPad app's page bridge (ios/Resources/bridge.js) end to end in Chromium (FM1-Chord's, after DREADNOUGHT's):
the editor connects to the simulated FM-1 (web/editor/mock-fm1.js) through the bridge's Web MIDI, as it does through
CoreMIDI in the app, with a stand-in for the app's native side (the same messages ios/Sources/MIDIBridge.swift and
FilesBridge.swift answer). Checks the connection, a set sent to a slot and read back, ports coming and going, a
download (a chord set file) and the keyboard.

    python3 ios/test/bridge_e2e.py [SHOTS_DIR]          (needs playwright and its Chromium)"""
import http.server
import sys
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
shots = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
BRIDGE = (ROOT / "ios/Resources/bridge.js").read_text()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT / "web")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
fails = 0


def check(what, ok, got=""):
    global fails
    print(("ok   " if ok else "FAIL ") + what + (f": {got}" if got != "" else ""))
    fails += not ok


# the app's native side, stood in for: the same ops and replies as MIDIBridge.swift / FilesBridge.swift
NATIVE = r"""
(() => {
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const fake = window.__fake = { saved: {}, toasts: [], clip: null, sent: 0,
    ports: { inputs: [{ id: "i1", name: "FM1-Chord FM-1", manufacturer: "M-VAVE" }],
             outputs: [{ id: "o1", name: "FM1-Chord FM-1", manufacturer: "M-VAVE" }] } };
  let mock = null;
  const device = async () => {
    if (!mock) {
      const { mockFM1 } = await import("/editor/mock-fm1.js");
      const { loadPresets } = await import("/editor/setcodec.js");
      const pr = loadPresets(await (await fetch("/editor/presets.json")).json());
      mock = window.__fakeMock = mockFM1(pr.sets);
      const inp = mock.access.inputs.get("mock-in");
      inp.onmidimessage = (ev) => setTimeout(() => window.__dnMIDI.recv("i1", [b64(ev.data)]), 1);
    }
    return mock;
  };
  const midi = async (m) => {
    if (m.op === "start") { await device(); return JSON.parse(JSON.stringify(fake.ports)); }
    if (m.op === "send") {
      if (m.id === "o1") { fake.sent++; (await device()).access.outputs.get("mock-out").send(unb64(m.data)); }
      return true;
    }
    throw new Error("unknown op " + m.op);
  };
  const files = async (m) => {
    switch (m.op) {
      case "save": fake.saved[m.name] = atob(m.data); fake.toasts.push("saved " + m.name); return m.name;
      case "list": return [];
      case "clip": fake.clip = m.text; return true;
      case "toast": fake.toasts.push(m.text); return true;
    }
    throw new Error("unknown op " + m.op);
  };
  window.webkit = { messageHandlers: { dnmidi: { postMessage: midi }, dnfiles: { postMessage: files } } };
})();
"""

with sync_playwright() as pw:
    br = pw.chromium.launch()
    pg = br.new_page(viewport={"width": 1180, "height": 820})   # (an iPad Air in landscape)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script(NATIVE)
    pg.add_init_script(BRIDGE)
    pg.goto(f"{base}/editor/")
    pg.wait_for_function("document.querySelectorAll('.kb-key').length === 27", timeout=10000)
    check("the editor comes up with its 27 keys", True)
    check("the bridge supplies requestMIDIAccess",
          pg.evaluate("navigator.requestMIDIAccess.toString().includes('starting')"))

    pg.click('.tabs button[data-tab="device"]')
    pg.click("#d-conn")
    pg.wait_for_function("document.getElementById('status').textContent.startsWith('Connected')", timeout=20000)
    check("connects to the FM-1 through the bridge", True, pg.inner_text("#status"))
    pg.wait_for_function("document.querySelectorAll('[data-send]').length === 20", timeout=10000)
    check("lists its 20 user slots", True)
    n0 = pg.evaluate("window.__fake.sent")
    pg.on("dialog", lambda d: d.accept())
    pg.click('[data-send="4"]')
    pg.wait_for_function("window.__fakeMock && window.__fakeMock.user[4] !== null", timeout=10000)
    check("a set goes into slot 5", pg.evaluate("window.__fake.sent") > n0)
    name = pg.evaluate("window.__fc.st.set.name")
    pg.wait_for_function(f"document.getElementById('d-slots').textContent.includes({name!r})", timeout=10000)
    check("and is listed there by name", True, name)

    # a port comes and goes (a keyboard plugged in, then out)
    pg.evaluate("""async () => { const f = window.__fake; f.events = 0;
      const a = await navigator.requestMIDIAccess(); a.onstatechange = () => f.events++;
      window.__dnMIDI.ports({ inputs: [...f.ports.inputs, { id: "i9", name: "KeyStep" }],
                              outputs: [...f.ports.outputs] }); }""")
    pg.wait_for_timeout(300)
    seen = pg.evaluate("navigator.requestMIDIAccess().then((a) => [...a.inputs.values()].map((p) => p.name))")
    check("a new port appears", "KeyStep" in seen, seen)
    pg.evaluate("window.__dnMIDI.ports(window.__fake.ports)")
    pg.wait_for_timeout(300)
    seen = pg.evaluate("navigator.requestMIDIAccess().then((a) => [...a.inputs.values()].map((p) => p.name))")
    check("and goes", seen == ["FM1-Chord FM-1"], seen)

    # a chord set file: a download, into the app's folder
    pg.click("#b-export")
    pg.wait_for_function("Object.keys(window.__fake.saved).some((n) => n.endsWith('.chordset'))", timeout=5000)
    check("Save file writes a .chordset to the app's folder", True, list(pg.evaluate("Object.keys(window.__fake.saved)")))

    # touch the keys: the chord plays (the key lights) and is selected
    k = pg.locator('.kb-key[data-k="9"]')
    k.dispatch_event("pointerdown", {"pointerId": 7})
    pg.wait_for_timeout(150)
    check("a tapped key lights", "hit" in (k.get_attribute("class") or ""))
    k.dispatch_event("pointerup", {"pointerId": 7})
    check("and is the one selected", pg.evaluate("window.__fc.st.sel") == 9)

    pg.screenshot(path=str(shots / "ipad-bridge.png"))
    check("no page errors", not errors, errors)
    br.close()

print("all ok" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
