# Changelog

## 0.1 (beta, not yet tried on a real FM-1)

Build order steps 0–4, and step 5 in the editor.

- **Setup:** GitHub Actions builds the `.fwsc` on every push (Linux JieLi toolchain, X0X's platform pinned), runs
  the host tests, publishes Release `v0.1`; GitHub Pages hosts the editor and the web flasher; the iPad app is built
  and published on the rolling `ipad` pre-release.
- **FM-1:** a chord on each of the 27 keys; five factory sets (DARK JUNGLE MIN, LIQUID DNB, NEURO STABS, DEEP GARAGE,
  90S RAVE STABS) and 20 user slots; octave buttons; per-chord root, 22 qualities + custom notes, inversion, voicing,
  slash bass, octave; LEARN from played notes; a 10-voice chord synth (two oscillators, sub, FM, filter with its
  envelope, amp envelope, chorus, reverb) with eight factory sounds; MIDI out (synth, MIDI or both), MIDI notes in
  play the keys, MIDI clock in drives the arpeggiator; strum, arpeggiator, latch, auto voice leading, velocity
  humanise, transpose; a light screen with big type.
- **Editor:** chord sets with an in-browser preview (the FM-1's synth and player in JavaScript, checked against the
  C), a keyboard and a big-tile view, harmony suggestions in green / amber / red with labels and reasons, key
  detection, "suggest next chord", "fill the set" with a dark jungle / DnB bias, learn from on-screen or MIDI keys,
  progressions with twelve J-6-style rhythm phrases and MIDI-file export, sync with the FM-1, a demo FM-1.
- **Recovery:** the update loader writes the app header last (DREADNOUGHT 0.43's fix), so a cut install comes back in
  update mode; `docs/RECOVERY.md` for an FM-1 that already went black.
