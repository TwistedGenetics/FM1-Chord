/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord host test: the synth's output for the JavaScript cross-check (synth_xcheck.mjs). Every factory sound,
 * then one with every part 2 feature on (24 dB band-pass, drive, both LFOs, the mod envelope, all six matrix slots,
 * ping-pong delay), plays Am9 for 1.5 s and lets go for 1 s; prints the level (RMS) of each 50 ms, left and right.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#include <math.h>
#include <stdio.h>
#include "fc_synth.h"
#include "fc_presets.h"

static float rv[FC_RV_FLOATS];
static int16_t dly[2u * FC_DLY_LEN];
static fc_synth_t syn;
static float buf[2u * 44100u * 5u / 2u];

static void play(const fc_sound_t *o, const fc_sound2_t *x, float bpm)
{
    static const uint8_t notes[5] = {45, 52, 55, 59, 60};
    uint32_t i, n = 44100u * 5u / 2u, w;
    fc_synth_init(&syn, rv, dly);
    fc_synth_sound(&syn, o, x);
    fc_synth_tempo(&syn, bpm);
    for (i = 0; i < 5u; i++)
        fc_synth_on(&syn, notes[i], 100u - 10u * i);
    for (i = 0; i < n; i += 128u) {
        if (i == 44100u * 3u / 2u / 128u * 128u)
            for (w = 0; w < 5u; w++)
                fc_synth_off(&syn, notes[w]);
        fc_synth_render(&syn, buf + 2u * i, n - i < 128u ? n - i : 128u);
    }
    for (w = 0; w + 2205u <= n; w += 2205u) {
        float l = 0.f, r = 0.f;
        for (i = w; i < w + 2205u; i++) {
            l += buf[2u * i] * buf[2u * i];
            r += buf[2u * i + 1u] * buf[2u * i + 1u];
        }
        printf(" %.5f %.5f", (double)sqrtf(l / 2205.f), (double)sqrtf(r / 2205.f));
    }
    printf("\n");
}

int main(void)
{
    uint32_t i;
    fc_sound2_t x;
    for (i = 0; i < FC_NSOUNDS; i++) {
        printf("%s:", FC_SOUNDS[i].name);
        play(&FC_SOUNDS[i].snd, &FC_SOUNDS[i].sx, 140.f);
    }
    fc_sound2_default(&x);
    x.flt_mode = FC_F_BP;
    x.flt_slope = 1;
    x.drive = 70;
    x.lfo_wave[0] = FC_L_TRI;
    x.lfo_wave[1] = FC_L_SH;
    x.lfo_rate[0] = 80;
    x.lfo_rate[1] = 100;
    x.lfo_sync[1] = 1;
    x.menv_a = 20;
    x.menv_d = 70;
    x.menv_s = 30;
    x.mod[0] = (fc_mod_t){FC_MS_LFO1, FC_MD_CUT, 40};
    x.mod[1] = (fc_mod_t){FC_MS_MENV, FC_MD_PITCH, 30};
    x.mod[2] = (fc_mod_t){FC_MS_LFO2, FC_MD_PW, 90};
    x.mod[3] = (fc_mod_t){FC_MS_VEL, FC_MD_AMP, -50};
    x.mod[4] = (fc_mod_t){FC_MS_M2, FC_MD_DLYMIX, 60};
    x.mod[5] = (fc_mod_t){FC_MS_LFO2, FC_MD_L1RATE, 50};
    x.macro[1] = 100;
    x.dly_time = FC_D_8D;
    x.dly_fb = 90;
    x.dly_mix = 40;
    x.dly_tone = 60;
    x.dly_mode = 1;
    {
        fc_sound_t o = FC_SOUNDS[3].snd;
        o.wave_a = FC_W_PULSE;
        o.wave_b = FC_W_SQUARE;
        printf("EVERYTHING:");
        play(&o, &x, 170.f);
    }
    return 0;
}
