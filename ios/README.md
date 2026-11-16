# FM1-Chord for iPad

The FM1-Chord editor as an iPad app (after FM1-Chord's). The app works with the FM-1 on the iPad, where Safari can't: Safari has no
Web MIDI, and the editor talks to the FM-1 over MIDI. The app carries the same pages as the website (the editor and the flasher) and gives them what Chrome would: the iPad's MIDI ports through CoreMIDI, downloads, a
a folder in Files and the clipboard. It's the editor of the same commit, so it changes when the editor does.

## Install

**SideStore / AltStore (no Mac needed after setup).** Download the newest `FM1-Chord-iPad-….ipa` from the
[**ipad** release](https://github.com/TwistedGenetics/FM1-Chord/releases/tag/ipad) on the iPad, open SideStore (or
AltStore), tap **+** and pick the file. They sign it with your Apple ID. With a free Apple ID it lasts 7 days:
SideStore refreshes it on the iPad, AltStore from a computer on your network.

**Xcode (a Mac).** `brew install xcodegen`, then in this folder `xcodegen` and open `FM1ChordEditor.xcodeproj`.
In the target's **Signing & Capabilities** tab, pick your team (your Apple ID), plug in the iPad and press Run. With a
free Apple ID it lasts 7 days (Run again to renew it); with a paid developer account, a year.

## Use

Connect the FM-1 to the iPad with a USB-C cable (or, on a Lightning iPad, Apple's Lightning to USB 3 camera adapter).
Open the app, go to the **FM-1** tab and press **Connect FM-1**. Everything else is as on a computer.

- **Saved files** (chord sets, MIDI files) go to **Files › On My iPad › FM1-Chord**.
- **Open file** (a `.chordset`) opens the iPad's file picker.
- The link to the flasher opens it in the app; swipe from the left edge to go back.
- Sound plays from the iPad even without the FM-1 (the preview).
- The screen stays on while the app is open, so a long transfer isn't cut off by the iPad locking.
- **Pinch** to zoom if the text is too small.

The flasher works in the app too, but it hasn't been tried with a real FM-1 on an iPad yet: update firmware from a
computer until it has been.

## How it works

- `Sources/BundleSchemeHandler.swift`: serves the repo's `web/` folder at `fm1chord://app/`, so the pages and their
  modules load as on GitHub Pages. The flasher's release list and firmware files come from the live site.
- `Resources/bridge.js`: runs before the pages. It provides `navigator.requestMIDIAccess` (with SysEx, with ports
  that come and go), saves `download` links to the app's folder, and provides `showDirectoryPicker` (the Projects
  folder) and `navigator.clipboard.writeText`.
- `Sources/MIDIBridge.swift`: CoreMIDI. It listens to every source, joins up SysEx split across packets, sends
  frames out, and tells the page when ports change.
- `Sources/FilesBridge.swift`: the app's folder in Files.
- `Sources/EditorViewController.swift`: the full-screen web view, the pages' alert / confirm, links to the web in
  Safari, and a self-test (`-selftest`: the editor in demo mode, its state and a picture saved to Documents) that CI
  runs in an iPad simulator.

## Tests and builds

`.github/workflows/ipad.yml` runs on every push that changes `ios/` or `web/`:

- `test/bridge_e2e.py` runs the editor in Chromium, connected through `bridge.js` to the simulated FM-1. It checks
  connecting, ports coming and going, a set sent to a slot on the FM-1 and listed, a chord set file saved, and the keys.
- The app is built and started in an iPad simulator, and its self-test must pass.
- An unsigned `.ipa` is built. From `main`, it replaces the one on the **ipad** pre-release (kept apart from the
  firmware releases, so the firmware stays the latest release and the flasher's list doesn't change).
