/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: a chord set (a chord on each key, its sound and how it plays), stored and sent byte for byte as it is
 * here: every field is a byte, so the layout is the same on the FM-1, the host and in the editor
 * (web/editor/setcodec.js; docs/FORMAT.md lists the offsets). Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>
#include "fc_chord.h"

#define FC_SET_VERSION 1u
#define FC_SET_BYTES 336u
#define FC_NUSER 20u                /* user sets on the FM-1: 10 in OBJ_PAT0, 10 in OBJ_PAT1 */

/* the synth voice (src/dsp/fc_synth.c): 24 bytes, all 0..127 unless noted */
typedef struct {
    uint8_t type;                   /* which factory sound it started from (only shown) */
    uint8_t wave_a, wave_b;         /* FC_W_* */
    uint8_t detune;                 /* B against A: 0..50 cents */
    uint8_t b_level, sub;           /* oscillator B, the sub (square, an octave down) */
    uint8_t fm;                     /* B modulates A's phase (keys, bells) */
    uint8_t cutoff, res, fenv, ftrack;
    uint8_t amp_a, amp_d, amp_s, amp_r;
    uint8_t flt_a, flt_d, flt_s, flt_r;
    uint8_t chorus, rev_mix, rev_size;
    uint8_t level, vel_sens;
} fc_sound_t;
enum { FC_W_SAW, FC_W_SQUARE, FC_W_TRI, FC_W_SINE, FC_W_ORGAN, FC_W_PULSE, FC_NW };

/* how the keys play: 16 bytes */
typedef struct {
    uint8_t mode;                   /* FC_M_CHORD, FC_M_STRUM, FC_M_ARP */
    uint8_t strum;                  /* ms between strummed notes: strum x 2 (0 .. 254 ms) */
    uint8_t strum_dir;              /* 0 up, 1 down, 2 alternate */
    uint8_t arp_rate;               /* FC_R_*: 1/4 1/8 1/8T 1/16 1/16T 1/32 */
    uint8_t arp_dir;                /* 0 up, 1 down, 2 up-down, 3 random */
    uint8_t arp_oct;                /* 1 .. 3 octaves */
    uint8_t arp_gate;               /* 5 .. 100 % */
    uint8_t latch, voice_lead;      /* 0 / 1 */
    uint8_t humanise;               /* velocity spread 0..127 */
    int8_t transpose;               /* the whole set, -12 .. +12 semitones */
    int8_t octave;                  /* the OCT buttons, -3 .. +3 */
    uint8_t swing;                  /* arp swing 0..100 % (50 straight) — not used before 0.2 */
    uint8_t reserved[3];
} fc_play_t;
enum { FC_M_CHORD, FC_M_STRUM, FC_M_ARP, FC_NMODE };
enum { FC_R_4, FC_R_8, FC_R_8T, FC_R_16, FC_R_16T, FC_R_32, FC_NRATE };

typedef struct {
    char magic[2];                  /* 'F' 'C' */
    uint8_t version, nkeys;         /* FC_SET_VERSION, FC_NKEYS */
    char name[16];                  /* ASCII, 0-padded, not necessarily 0-terminated */
    uint8_t key_root, key_scale;    /* the key the editor's suggestions work in (0..11, FC_SC_*) */
    uint8_t tempo;                  /* BPM 40 .. 250 */
    uint8_t flags;
    fc_sound_t sound;
    fc_play_t play;
    fc_chord_t ch[FC_NKEYS];
    uint8_t reserved[2];
} fc_set_t;
_Static_assert(sizeof(fc_sound_t) == 24, "fc_sound_t is 24 bytes");
_Static_assert(sizeof(fc_play_t) == 16, "fc_play_t is 16 bytes");
_Static_assert(sizeof(fc_chord_t) == 10, "fc_chord_t is 10 bytes");
_Static_assert(sizeof(fc_set_t) == FC_SET_BYTES, "fc_set_t is 336 bytes");

/* scales, as the editor names them (the FM-1 only stores the number) */
enum { FC_SC_MAJOR, FC_SC_MINOR, FC_SC_DORIAN, FC_SC_PHRYGIAN, FC_SC_LYDIAN, FC_SC_MIXOLYDIAN, FC_SC_LOCRIAN,
       FC_SC_HARM_MINOR, FC_SC_MEL_MINOR, FC_NSCALE };

/* everything not in a set: 16 bytes in OBJ_SOUND */
typedef struct {
    char magic[2];                  /* 'F' 'G' */
    uint8_t version;
    uint8_t cur_set;                /* 0..19 a user set, 64 + n factory set n */
    uint8_t midi_ch;                /* out, 0..15 */
    uint8_t output;                 /* 0 synth + MIDI, 1 synth only, 2 MIDI only */
    uint8_t clock;                  /* 0 internal, 1 MIDI clock in */
    uint8_t velocity;               /* the keys' velocity, 1..127 */
    uint8_t midi_in_ch;             /* 0..15, 16 any: notes in play the chord keys (F3 = key 1) */
    uint8_t reserved[7];
} fc_globals_t;
_Static_assert(sizeof(fc_globals_t) == 16, "fc_globals_t is 16 bytes");

void fc_set_init(fc_set_t *s, const char *name);         /* an empty set with the default sound */
int fc_set_check(fc_set_t *s);                           /* 0 = a set (values put in range); -1 = not one */
void fc_globals_init(fc_globals_t *g);
int fc_globals_check(fc_globals_t *g);
void fc_sound_default(fc_sound_t *s);
uint32_t fc_set_used_keys(const fc_set_t *s);            /* bit k: key k has a chord */
