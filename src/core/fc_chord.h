/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: chord theory shared by the firmware and the host tests (the editor's web/editor/chord.js is the same
 * maths in JavaScript; tests/host/chord_xcheck.mjs checks the two agree note for note).
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>

#define FC_NKEYS 27u              /* the FM-1's keys, F3 .. G5 */
#define FC_KEY0_NOTE 53u          /* MIDI note of key 0 (F3) */
#define FC_MAXN 8u                /* notes in one chord, its slash bass included */
#define FC_EMPTY 0xFFu            /* fc_chord_t.quality of a key with no chord */
#define FC_NOBASS 0xFFu           /* fc_chord_t.bass: no slash bass */

/* Chord qualities. The order is the wire / storage format: only ever add at the end (before FC_Q_CUSTOM's slot is
 * fixed at 31 so new qualities fit below it). */
enum {
    FC_Q_MAJ, FC_Q_MIN, FC_Q_7, FC_Q_MAJ7, FC_Q_M7, FC_Q_9, FC_Q_M9, FC_Q_11, FC_Q_13, FC_Q_SUS2, FC_Q_SUS4,
    FC_Q_DIM, FC_Q_AUG, FC_Q_ADD9, FC_Q_6, FC_Q_M6, FC_Q_POWER, FC_Q_M11, FC_Q_M7B5, FC_Q_DIM7, FC_Q_MAJ9,
    FC_Q_7SUS4, FC_NQ_NAMED
};
#define FC_Q_CUSTOM 31u           /* the notes are fc_chord_t.custom: a 24-bit mask of semitones above the root */

enum { FC_V_CLOSE, FC_V_OPEN, FC_V_DROP2, FC_V_DROP3, FC_V_SPREAD, FC_NV };

/* one key's chord: 10 bytes, every field a byte (the set is stored and sent as it is in memory) */
typedef struct {
    uint8_t root;                 /* pitch class 0 = C .. 11 = B */
    uint8_t quality;              /* FC_Q_*, FC_Q_CUSTOM, or FC_EMPTY */
    uint8_t custom[3];            /* FC_Q_CUSTOM: bit i of (custom[0] | custom[1] << 8 | custom[2] << 16) = root + i */
    uint8_t inversion;            /* 0 root position, 1 first, 2 second, 3 third (limited to the chord's notes - 1) */
    uint8_t voicing;              /* FC_V_* */
    uint8_t bass;                 /* slash bass pitch class 0..11, or FC_NOBASS */
    int8_t octave;                /* this chord's own octave, -2 .. +2 */
    uint8_t reserved;
} fc_chord_t;

/* the chord's tones as semitones above its root, ascending (close position, before inversion); returns how many */
uint32_t fc_tones(const fc_chord_t *c, uint8_t *iv);

/* the notes a key plays, MIDI numbers ascending, the slash bass (if any) first. shift: semitones added to everything
 * (the set's transpose plus 12 x the octave buttons). Returns how many (0 for an empty key). The chord's root sits
 * in the octave from C3 (48) before its own octave, the inversion and the voicing move it. */
uint32_t fc_chord_notes(const fc_chord_t *c, int32_t shift, uint8_t *out);

/* auto voice leading: notes (n of them, ascending, slash bass first when has_bass) are moved by octaves and
 * inversions, as a whole, to the placement nearest to prev (np notes: the last chord's upper notes, without its
 * slash bass; prev_bass that bass or -1). In place. */
void fc_voice_lead(const uint8_t *prev, uint32_t np, int32_t prev_bass, uint8_t *notes, uint32_t n, int has_bass);

/* LEARN: the notes played (n of them, any order) as a chord. A named quality when the notes are one (in any
 * inversion; the root position preferred, then the lowest inversion), else FC_Q_CUSTOM with the notes above the
 * lowest. The octave is set so the chord sits where it was played. Returns 0 when n is 0. */
int fc_chord_identify(const uint8_t *notes, uint32_t n, fc_chord_t *c);

/* "Cm9/G" ("" for an empty key); n >= 16 */
void fc_chord_name(const fc_chord_t *c, char *buf, uint32_t n);
const char *fc_quality_name(uint32_t q);    /* "m9" ... (the suffix; "maj" for a plain major triad's own name) */
const char *fc_note_name(uint32_t pc);      /* "C" "Db" ... */
const char *fc_voicing_name(uint32_t v);    /* "CLOSE" "OPEN" "DROP 2" "DROP 3" "SPREAD" */
