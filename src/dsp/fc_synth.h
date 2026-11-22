/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the built-in polyphonic synth, made for chords: two oscillators (saw, square, triangle, sine, organ,
 * pulse, supersaw, noise, four wavetables) with a sub, phase modulation, hard sync or ring modulation, drive into a
 * state-variable filter (low-pass, band-pass, high-pass or
 * notch, 12 or 24 dB) with its own envelope, an amp envelope; two LFOs, a mod envelope and a six-slot mod matrix
 * (macro knobs among its sources); a sampler-era crusher and tape wobble; then a Juno-style stereo chorus (three
 * modes), a phaser, a tempo-synced delay and a reverb.
 * Single-precision float. web/editor/engine.js is the same synth in JavaScript for the editor's preview.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>
#include "fc_set.h"

#define FC_VOICES 10u
#define FC_CTRL 16u                 /* the filter's cutoff and the modulation are worked out every 16 samples */
#define FC_BLOCK 128u

typedef struct {
    float a, d, s, r;               /* coefficients per sample (a: linear rise per sample; d, r: exponential) */
    float d16, r16;                 /* d and r over FC_CTRL samples: the filter and mod envelopes step a block at once */
} fc_env_c;

typedef struct {
    uint8_t note, on, stage_a, stage_f, stage_m;   /* stage: 0 off, 1 attack, 2 decay / sustain, 3 release */
    uint32_t age;
    float pa, pb, ps, inc_a, inc_b;
    float vel, velr, ea, ef, em;
    float ic1, ic2, ic3, ic4;       /* the filter's state (3, 4: the second stage, 24 dB) */
    float ssa[6], ssb[6];           /* the supersaw's six other saws, A and B */
    float key;                      /* note - 60, for key tracking */
    uint8_t shed;                   /* the CPU guard took it: fading out fast */
} fc_voice_t;

#define FC_CH_LEN 1024u
#define FC_RV_NC 4u
#define FC_RV_NA 2u
#define FC_DLY_LEN 32768u           /* the delay's memory a side, in 16-bit samples (0.74 s at 44.1 kHz) */
typedef struct {
    fc_voice_t v[FC_VOICES];
    fc_sound_t snd;
    fc_sound2_t sx;
    fc_sound3_t s3;
    fc_env_c amp, flt, menv;
    float wt_pos, spread, b_ratio, wob, wob_depth, wob_ph[2];
    uint32_t omode;
    /* crusher */
    float cr_step, cr_ph, cr_hold, cr_q;
    /* phaser */
    float ph_mix, ph_ph, ph_a[2], ph_z[2][4], ph_y[2];
    float level, cut_st, fenv_st, track, res, detune_c, bl, sub, fm, vs, drive;
    uint32_t wa, wb;
    uint32_t age, maxv;              /* voices it may use (fc_synth_voices) */
    uint32_t gmax, gcool, gcap;     /* gcap: the cap now (model and net) */
               /* the CPU guard's cap on that, and how long the CPU has been easy */
    float g_base, g_voice;           /* the guard's model: % of a block for the effects, and for each voice */
    /* modulation: the matrix's slots in use, split into those for each voice and those for the whole synth */
    uint8_t mv_src[FC_NMOD], mv_dst[FC_NMOD], mg_src[FC_NMOD], mg_dst[FC_NMOD];
    float mv_amt[FC_NMOD], mg_amt[FC_NMOD];
    uint32_t nmv, nmg, use_menv;
    float macro[FC_NMACRO];
    float lfo_ph[2], lfo_hz[2], lfo_sh[2], lfo_blk[2][FC_BLOCK / FC_CTRL];
    uint32_t rng;
    float tempo;
    /* chorus */
    float ch_buf[FC_CH_LEN];
    uint32_t ch_w;
    float ch_ph, ch_mix, ch_rate, ch_depth;
    /* delay */
    int16_t *dl[2];
    uint32_t dl_w, dl_len;
    float dl_fb, dl_mix, dl_c, dl_lp[2], dl_hp[2];
    /* reverb (Freeverb-like: four combs and two all-passes a side) */
    float *rv_c[2][FC_RV_NC], *rv_a[2][FC_RV_NA];
    uint32_t rv_cl[2][FC_RV_NC], rv_al[2][FC_RV_NA], rv_ci[2][FC_RV_NC], rv_ai[2][FC_RV_NA];
    float rv_cs[2][FC_RV_NC], rv_fb, rv_damp, rv_mix;
    float mono[FC_BLOCK];           /* one block's voices, before the chorus */
    float fx_l[FC_BLOCK], fx_r[FC_BLOCK], rv_out[2][FC_BLOCK];   /* the effects' stages, a block at a time */
} fc_synth_t;

/* the reverb's and the delay's memory (given to fc_synth_init, so it can live in the FM-1's pool RAM) */
#define FC_RV_FLOATS 12800u
void fc_synth_init(fc_synth_t *s, float *rv_mem, int16_t *dly_mem /* 2 x FC_DLY_LEN */);
/* new values (any time, between blocks) */
void fc_synth_sound(fc_synth_t *s, const fc_sound_t *snd, const fc_sound2_t *sx, const fc_sound3_t *s3);
void fc_synth_tempo(fc_synth_t *s, float bpm);              /* for the synced LFOs and the delay */
void fc_synth_voices(fc_synth_t *s, uint32_t n);            /* polyphony 1..FC_VOICES (less work for the CPU) */
void fc_synth_on(fc_synth_t *s, uint32_t note, uint32_t vel);
void fc_synth_off(fc_synth_t *s, uint32_t note);
void fc_synth_all_off(fc_synth_t *s);
/* adds nothing: writes n stereo frames (interleaved L R) in -1..1 */
void fc_synth_render(fc_synth_t *s, float *lr, uint32_t n);
uint32_t fc_synth_active(const fc_synth_t *s);             /* voices sounding */
/* the CPU guard, after every audio block, with the share of the block's time the block took (percent). It learns
 * what the effects and each voice cost with this sound and holds the voices to what fits in 80 % (so a new chord
 * over the last one's tails steals them instead of breaking up); a block over 90 % takes one more off, given back
 * after about a second at ease. Voices over the cap fade out (released ones first). Returns the cap. */
uint32_t fc_synth_guard(fc_synth_t *s, uint32_t pct);
