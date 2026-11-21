/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: a chord set (a chord on each key, its sound and how it plays), stored and sent byte for byte as it is
 * here: every field is a byte, so the layout is the same on the FM-1, the host and in the editor
 * (web/editor/setcodec.js; docs/FORMAT.md lists the offsets). Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>
#include "fc_chord.h"

#define FC_SET_VERSION 3u          /* 2 (0.6): fc_sound2_t on the end; 3 (0.7): fc_sound3_t after it. A version 1
                                    * set is the first 336 bytes, a version 2 set the first 376 */
#define FC_SET_BYTES 384u           /* ten to a store object: 3840 bytes, PLAT_STORE_MAX exactly */
#define FC_SET_BYTES_V1 336u
#define FC_SET_BYTES_V2 376u
#define FC_NUSER 20u                /* user sets on the FM-1: 10 in OBJ_PAT0, 10 in OBJ_PAT1 */
#define FC_FACTORY0 128u            /* set numbers: 0..19 user sets, 128 + n factory set n (to 254) */

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
enum { FC_W_SAW, FC_W_SQUARE, FC_W_TRI, FC_W_SINE, FC_W_ORGAN, FC_W_PULSE,
       FC_W_SUPERSAW, FC_W_NOISE,              /* 0.7: seven detuned saws (spread: fc_sound3_t), white noise */
       FC_W_WT_VOX, FC_W_WT_PWM, FC_W_WT_DIGI, FC_W_WT_GLASS,   /* 0.7: wavetables, swept by the WT position */
       FC_NW };
#define FC_W_WT0 FC_W_WT_VOX

/* the synth voice, part 2 (0.6): filter modes, drive, two LFOs, a mod envelope, a mod matrix, macros, delay.
 * 40 bytes. A modulation: what moves (FC_MS_*), what it moves (FC_MD_*), how far (-127..127). */
typedef struct {
    uint8_t src, dst;
    int8_t amt;
} fc_mod_t;
#define FC_NMOD 6u
#define FC_NMACRO 4u
typedef struct {
    uint8_t flt_mode;               /* FC_F_*: low-pass, band-pass, high-pass, notch */
    uint8_t flt_slope;              /* 0 12 dB, 1 24 dB */
    uint8_t drive;                  /* into the filter, 0..127 */
    uint8_t lfo_wave[2];            /* FC_L_* */
    uint8_t lfo_rate[2];            /* 0..127: free 0.03..30 Hz; synced, a division of the beat (FC_NDIV of them) */
    uint8_t lfo_sync[2];            /* 0 free, 1 to the tempo */
    uint8_t menv_a, menv_d, menv_s, menv_r;   /* the mod envelope (a matrix source) */
    fc_mod_t mod[FC_NMOD];
    uint8_t macro[FC_NMACRO];       /* the macro knobs' values (matrix sources) */
    uint8_t dly_time;               /* FC_D_*: a division of the beat */
    uint8_t dly_fb, dly_mix, dly_tone;
    uint8_t dly_mode;               /* 0 stereo, 1 ping-pong */
} fc_sound2_t;
enum { FC_F_LP, FC_F_BP, FC_F_HP, FC_F_NOTCH, FC_NFMODE };
enum { FC_L_SINE, FC_L_TRI, FC_L_SAW, FC_L_SQUARE, FC_L_SH, FC_NLWAVE };
/* matrix sources: LFOs, the mod envelope, velocity, the key (C4 = 0), the macros */
enum { FC_MS_NONE, FC_MS_LFO1, FC_MS_LFO2, FC_MS_MENV, FC_MS_VEL, FC_MS_KEY, FC_MS_M1, FC_MS_M2, FC_MS_M3, FC_MS_M4,
       FC_NMS };
/* matrix destinations. 1..11 for each voice; 12..15 for the whole synth (moved by the LFOs and macros only) */
enum { FC_MD_NONE, FC_MD_PITCH, FC_MD_CUT, FC_MD_RES, FC_MD_BLEV, FC_MD_FM, FC_MD_PW, FC_MD_AMP, FC_MD_DETUNE,
       FC_MD_SUB, FC_MD_DRIVE, FC_MD_FENV, FC_MD_L1RATE, FC_MD_DLYMIX, FC_MD_REVMIX, FC_MD_CHORUS,
       FC_MD_WTPOS, FC_MD_SPREAD, FC_MD_BPITCH,  /* 0.7: for each voice again */
       FC_NMD };
#define FC_MD_GLOBAL(d) ((d) >= FC_MD_L1RATE && (d) <= FC_MD_CHORUS)

/* the synth voice, part 3 (0.7): 8 bytes */
typedef struct {
    uint8_t wt_pos;                 /* where the wavetables play from, 0..127 */
    uint8_t spread;                 /* the supersaw's detune, 0..127 */
    uint8_t osc_mode;               /* FC_O_*: B added, B hard-synced to A, or A ring-modulated by B */
    int8_t b_semi;                  /* B's tuning, -24..24 semitones */
    uint8_t crush_bits;             /* 0 off, 1..127: 16 down to 3 bits */
    uint8_t crush_rate;             /* 0 off, 1..127: 44.1 kHz down to about 1.4 kHz */
    uint8_t wobble;                 /* tape wow and flutter, 0..127 */
    uint8_t fx;                     /* bits 7..6 the chorus's mode (FC_C_*), 5..0 the phaser 0..63 */
} fc_sound3_t;
enum { FC_O_ADD, FC_O_SYNC, FC_O_RING, FC_NOMODE };
enum { FC_C_I, FC_C_II, FC_C_I_II, FC_NCMODE };
/* beat divisions, shortest first: a synced LFO's rate 0..127 runs 8 bars .. 1/32; the delay's time 1/32 .. 1 bar */
#define FC_NDIV 15u
enum { FC_D_32, FC_D_16T, FC_D_16, FC_D_8T, FC_D_16D, FC_D_8, FC_D_4T, FC_D_8D, FC_D_4, FC_D_4D, FC_D_2, FC_D_1,
       FC_D_2BAR, FC_D_4BAR, FC_D_8BAR };
extern const float FC_DIV_BEATS[FC_NDIV];
extern const char *const FC_DIV_NAME[FC_NDIV];

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
    fc_sound2_t sx;                 /* from version 2 */
    fc_sound3_t s3;                 /* from version 3 */
} fc_set_t;
_Static_assert(sizeof(fc_sound_t) == 24, "fc_sound_t is 24 bytes");
_Static_assert(sizeof(fc_play_t) == 16, "fc_play_t is 16 bytes");
_Static_assert(sizeof(fc_chord_t) == 10, "fc_chord_t is 10 bytes");
_Static_assert(sizeof(fc_sound2_t) == 40, "fc_sound2_t is 40 bytes");
_Static_assert(sizeof(fc_sound3_t) == 8, "fc_sound3_t is 8 bytes");
_Static_assert(sizeof(fc_set_t) == FC_SET_BYTES, "fc_set_t is 384 bytes");

/* scales, as the editor names them (the FM-1 only stores the number) */
enum { FC_SC_MAJOR, FC_SC_MINOR, FC_SC_DORIAN, FC_SC_PHRYGIAN, FC_SC_LYDIAN, FC_SC_MIXOLYDIAN, FC_SC_LOCRIAN,
       FC_SC_HARM_MINOR, FC_SC_MEL_MINOR, FC_NSCALE };

/* everything not in a set: 16 bytes in OBJ_SOUND */
typedef struct {
    char magic[2];                  /* 'F' 'G' */
    uint8_t version;
    uint8_t cur_set;                /* 0..19 a user set, FC_FACTORY0 + n factory set n (64 + n in version 1) */
    uint8_t midi_ch;                /* out, 0..15 */
    uint8_t output;                 /* 0 synth + MIDI, 1 synth only, 2 MIDI only */
    uint8_t clock;                  /* 0 internal, 1 MIDI clock in */
    uint8_t velocity;               /* the keys' velocity, 1..127 */
    uint8_t midi_in_ch;             /* 0..15, 16 any: notes in play the chord keys (F3 = key 1) */
    uint8_t voices;                 /* 0.7: the synth's polyphony, 4..10 (0 = 10): fewer if the FM-1 runs out of time */
    uint8_t reserved[6];
} fc_globals_t;
_Static_assert(sizeof(fc_globals_t) == 16, "fc_globals_t is 16 bytes");

void fc_set_init(fc_set_t *s, const char *name);         /* an empty set with the default sound */
int fc_set_check(fc_set_t *s);                           /* 0 = a set (values put in range); -1 = not one */
void fc_globals_init(fc_globals_t *g);
int fc_globals_check(fc_globals_t *g);
void fc_sound_default(fc_sound_t *s);
void fc_sound2_default(fc_sound2_t *x);                  /* nothing moving, no delay: a version 1 set's sound */
void fc_sound3_default(fc_sound3_t *x);                  /* plain: no sync, crush, wobble or phaser */
uint32_t fc_set_used_keys(const fc_set_t *s);            /* bit k: key k has a chord */
