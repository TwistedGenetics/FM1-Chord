/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the built-in polyphonic synth, made for chords: two oscillators (saw, square, triangle, sine, organ,
 * pulse) with a sub and phase modulation, a 12 dB state-variable low-pass with its own envelope, an amp envelope,
 * then a Juno-style stereo chorus and a reverb. Single-precision float. web/editor/synth-core.js is the same voice
 * in JavaScript for the editor's preview. Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>
#include "fc_set.h"

#define FC_VOICES 10u
#define FC_CTRL 16u                 /* the filter's cutoff is worked out every 16 samples */

typedef struct {
    float a, d, s, r;               /* coefficients per sample (a: linear rise per sample; d, r: exponential) */
} fc_env_c;

typedef struct {
    uint8_t note, on, stage_a, stage_f;   /* stage: 0 off, 1 attack, 2 decay / sustain, 3 release */
    uint32_t age;
    float pa, pb, ps, inc_a, inc_b;
    float vel, ea, ef;
    float ic1, ic2;                 /* the filter's state */
    float g, k;                     /* its coefficients for the current control block */
    float key;                      /* note - 60, for key tracking */
} fc_voice_t;

#define FC_CH_LEN 1024u
#define FC_RV_NC 4u
#define FC_RV_NA 2u
typedef struct {
    fc_voice_t v[FC_VOICES];
    fc_sound_t snd;
    fc_env_c amp, flt;
    float level, cut_st, fenv_st, track, res_k, detune_r, bl, sub, fm, vs;
    uint32_t wa, wb;
    uint32_t age;
    /* chorus */
    float ch_buf[FC_CH_LEN];
    uint32_t ch_w;
    float ch_ph, ch_mix;
    /* reverb (Freeverb-like: four combs and two all-passes a side) */
    float *rv_c[2][FC_RV_NC], *rv_a[2][FC_RV_NA];
    uint32_t rv_cl[2][FC_RV_NC], rv_al[2][FC_RV_NA], rv_ci[2][FC_RV_NC], rv_ai[2][FC_RV_NA];
    float rv_cs[2][FC_RV_NC], rv_fb, rv_damp, rv_mix;
    float mono[128];                /* one block's voices, before the chorus */
} fc_synth_t;

/* the reverb's memory, in floats (given to fc_synth_init, so it can live in the FM-1's pool RAM) */
#define FC_RV_FLOATS 12800u
void fc_synth_init(fc_synth_t *s, float *rv_mem);
void fc_synth_sound(fc_synth_t *s, const fc_sound_t *snd);   /* new values (any time, between blocks) */
void fc_synth_on(fc_synth_t *s, uint32_t note, uint32_t vel);
void fc_synth_off(fc_synth_t *s, uint32_t note);
void fc_synth_all_off(fc_synth_t *s);
/* adds nothing: writes n stereo frames (interleaved L R) in -1..1 */
void fc_synth_render(fc_synth_t *s, float *lr, uint32_t n);
uint32_t fc_synth_active(const fc_synth_t *s);             /* voices sounding */
