#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# FM1-Chord: the Ableton device as a whole, in headless Chrome. A harness page runs the device's code (fm1chord.js)
# with Max's functions faked (outlet, post, arrayfromargs, messagename, notifyclients) and loads the strip and the
# editor in frames with a fake window.max, so the three talk as they would in Live (executejavascript one way,
# max.outlet the other). Checks: they find each other, the strip lists every set, keys on the strip and in the
# editor play MIDI, choosing a set on either side shows on the other, Save sends My sets, and the Live set's state
# comes back. Screenshots: OUT/strip.png, OUT/editor.png.
#   python3 tests/host/m4l_pages.py DIR [OUT]     (DIR: tools/gen_m4l.mjs's output; needs playwright and Chrome)
# Copyright (C) 2026 Jamie (TwistedGenetics).
import asyncio, functools, http.server, json, os, sys, threading

DIR = os.path.abspath(sys.argv[1])
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else DIR)
try:
    from playwright.async_api import async_playwright
except ImportError:
    print("skip m4l_pages: no playwright")
    sys.exit(0)
CHROME = next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser") if os.path.exists(p)), None)

HARNESS = """<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111">
<script>
var inlets, outlets, autowatch, messagename = "", midi = [], said = [], posts = [], notified = 0, opened = 0;
function post(s) { posts.push(String(s)); }
function arrayfromargs(a) { return Array.from(a); }
function notifyclients() { notified++; }
function outlet(o, a) {
  if (o === 0) { midi.push(a.slice()); return; }
  if (o === 3) return;
  const f = document.getElementById(o === 1 ? "strip" : "editor");
  if (a[0] === "executejavascript" && f.contentWindow && f.contentWindow.__fcIn) f.contentWindow.eval(a[1]);
}
</script>
<script src="fm1chord.js"></script>
<script>
setInterval(() => { messagename = "tick"; tick(5); }, 5);   // Max's metro 5
function deliver(from, a) {                       // a page's max.outlet: as the patch routes it
  said.push([from].concat(a));
  if (a[0] === "openeditor") { opened++; return; }
  messagename = a[0];
  if (typeof window[a[0]] === "function") window[a[0]].apply(null, a.slice(1));
  else anything.apply(null, a.slice(1));
}
</script>
<iframe id="strip" name="strip" src="FM1-Chord-strip.html" style="width:760px;height:169px;border:0;display:block"></iframe>
<iframe id="editor" name="editor" src="FM1-Chord-editor.html" style="width:1180px;height:820px;border:0;display:block"></iframe>
"""
INIT = "if (window.name === 'strip' || window.name === 'editor') window.max = { outlet: (...a) => parent.deliver(window.name, a) };"

fails = 0
def check(ok, what):
    global fails
    if not ok:
        fails += 1
        print("FAIL", what)

async def main():
    with open(os.path.join(DIR, "harness.html"), "w") as f:
        f.write(HARNESS)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIR))
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/harness.html"
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1180, "height": 1000})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "favicon" not in m.text and "Failed to load resource" not in m.text else None)
        await pg.add_init_script(INIT)
        await pg.goto(url)
        await pg.wait_for_timeout(1500)
        strip, editor = pg.frame("strip"), pg.frame("editor")
        said = await pg.evaluate("said.map(x => x[0] + ':' + x[1])")
        check("strip:stripready" in said and "editor:hello" in said, f"both pages said hello ({said[:6]})")
        n = await strip.evaluate("document.querySelectorAll('#plist button').length")
        check(n == 118, f"the strip lists every factory set ({n})")
        name0 = await strip.evaluate("document.querySelector('#setbtn').textContent")
        ed0 = await editor.evaluate("document.querySelector('#setname').value")
        check(name0 == ed0, f"strip and editor on the same set ({name0!r} / {ed0!r})")
        check(await editor.evaluate("document.body.classList.contains('host')"), "the editor knows it's in Live")
        check(await editor.evaluate("document.querySelector('#b-live').hidden && document.querySelector('[data-tab=sound]').hidden"),
              "FM-1 and sound controls hidden in Live")

        # a key on the strip plays the chord; letting go stops it
        await pg.evaluate("midi.length = 0")
        k = strip.locator(".k").nth(0)
        bx = await k.bounding_box()
        await pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2)
        await pg.mouse.down(); await pg.wait_for_timeout(100)
        on = await pg.evaluate("midi.filter(m => m[1] > 0).length")
        await pg.mouse.up(); await pg.wait_for_timeout(100)
        held = await pg.evaluate("(() => { const c = {}; for (const [n, v] of midi) c[n] = (c[n] || 0) + (v ? 1 : -1); return Object.values(c).filter(x => x).length; })()")
        check(on >= 3 and held == 0, f"a strip key: {on} notes on, {held} left hanging")
        chord = await strip.evaluate("document.querySelector('#chord').textContent")
        check(chord not in ("", "FM1-Chord"), f"the strip shows the chord ({chord!r})")

        # the track: MIDI in lights the key in both; notes outside pass through
        await pg.evaluate("midi.length = 0; messagename = 'note'; note(53 + 4, 100)")
        await pg.wait_for_timeout(50)
        lit_s = await strip.evaluate("document.querySelectorAll('.k.on').length")
        lit_e = await editor.evaluate("document.querySelectorAll('.kb-key.hit').length")
        await pg.evaluate("note(57, 0); note(40, 90); note(40, 0)")
        through = await pg.evaluate("JSON.stringify(midi.slice(-2))")
        check(lit_s == 1 and lit_e == 1, f"a played key lights in strip ({lit_s}) and editor ({lit_e})")
        check(through == "[[40,90],[40,0]]", f"notes below Key 1 pass through ({through})")

        # choosing on the strip opens it in the editor; choosing in the editor shows on the strip
        async def choose(v):
            await strip.click("#setbtn")
            await strip.click(f"#plist button[data-v='{v}']")
            await pg.wait_for_timeout(300)
        await choose("factory:5")
        want = await pg.evaluate("LIB.sets[5].name")
        got = await editor.evaluate("document.querySelector('#setname').value")
        check(got == want, f"strip choice opens in the editor ({got!r} / {want!r})")
        await editor.select_option("#lib", "f9")
        await pg.wait_for_timeout(300)
        want = await pg.evaluate("LIB.sets[9].name")
        got = await strip.evaluate("document.querySelector('#setbtn').textContent")
        check(got == want, f"editor choice shows on the strip ({got!r} / {want!r})")
        await strip.click("#next"); await pg.wait_for_timeout(300)
        got = await editor.evaluate("document.querySelector('#setname').value")
        check(got == await pg.evaluate("LIB.sets[10].name"), f"the strip's next arrow ({got!r})")

        # an edit in the editor plays from the device: rename, Save into My sets
        await editor.fill("#setname", "MY JUNGLE")
        await pg.wait_for_timeout(200)
        check(await pg.evaluate("cur.name") == "MY JUNGLE", "an edit reaches the device")
        await editor.click("#b-save"); await pg.wait_for_timeout(300)
        mine = await strip.evaluate("[...document.querySelectorAll('#plist h4')].map(h => h.textContent)")
        check(mine and mine[0] == "MY SETS", f"Save puts it in My sets on the strip ({mine})")
        await choose("factory:0")
        await choose("mine:0")
        check(await editor.evaluate("document.querySelector('#setname').value") == "MY JUNGLE", "My set chosen on the strip")
        await pg.evaluate("midi.length = 0")
        kk = editor.locator(".kb-key").nth(2)
        await kk.dispatch_event("pointerdown", {"pointerId": 1, "button": 0})
        await pg.wait_for_timeout(400)
        await kk.dispatch_event("pointerup", {"pointerId": 1, "button": 0})
        await pg.wait_for_timeout(100)
        n_on = await pg.evaluate("midi.filter(m => m[1] > 0).length")
        check(n_on >= 3, f"a key in the editor plays ({n_on} notes)")
        state = await pg.evaluate("getvalueof()")
        check(await pg.evaluate("notified") > 0, "the Live set is told it changed")
        await pg.screenshot(path=os.path.join(OUT, "strip.png"), clip={"x": 0, "y": 0, "width": 760, "height": 169})
        await strip.click("#setbtn"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(OUT, "strip-sets.png"), clip={"x": 0, "y": 0, "width": 760, "height": 169})
        await strip.click("#pclose")
        await editor.click("[data-tab=harmony]"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.path.join(OUT, "editor.png"), clip={"x": 0, "y": 169, "width": 1180, "height": 820})

        # a reopened Live set: a fresh device gets the state back, and the editor shows it
        pg2 = await b.new_page(viewport={"width": 1180, "height": 1000})
        await pg2.add_init_script(INIT)
        await pg2.goto(url)
        await pg2.wait_for_timeout(1200)
        await pg2.evaluate(f"setvalueof({json.dumps(state)})")
        await pg2.wait_for_timeout(400)
        e2 = pg2.frame("editor"); s2 = pg2.frame("strip")
        got = await e2.evaluate("document.querySelector('#setname').value")
        got_s = await s2.evaluate("document.querySelector('#setbtn').textContent")
        check(got == "MY JUNGLE" and got_s == "MY JUNGLE", f"the Live set's state comes back ({got!r} / {got_s!r})")
        check(await pg2.evaluate("MINE.length") >= 1, "My sets come back")
        await pg2.close()
        check(not errs, f"no errors in the pages: {errs[:3]}")
        await b.close()
    srv.shutdown()
    print(f"m4l_pages: {fails} failed" if fails else "ok   m4l_pages: strip, editor and device work together (screenshots in " + OUT + ")")
    sys.exit(1 if fails else 0)

asyncio.run(main())
