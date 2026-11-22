/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord host test: what costs the FM-1's CPU.
 *  1. No denormals, ever: every factory sound and 300 random ones (every wave, filter, modulation and effect),
 *     idle, playing, letting go and long after, rendered with the x86 FPU's denormal and underflow flags checked
 *     after every block. A CPU without denormal hardware works each one out slowly; quiet tails full of them were
 *     the 0.10 stutter (0.11). On a non-x86 host this part is skipped.
 *  2. The CPU guard (fc_synth_guard): under load it holds the synth to fewer voices and fades out the rest within
 *     about 30 ms; at ease it gives them back one a second; it never goes over the VOICES setting.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "fc_set.h"
#include "fc_synth.h"
#include "fc_presets.h"
#if defined(__SSE__) || defined(__x86_64__)
#include <xmmintrin.h>
#define HAVE_FLAGS 1
#endif

static float rv[FC_RV_FLOATS];
static int16_t dly[2u * FC_DLY_LEN];
static fc_synth_t syn;
static float buf[256];
static int fails;
#define CHECK(c, ...) do { if (!(c)) { fails++; printf("FAIL " __VA_ARGS__); printf("\n"); } } while (0)

#ifdef HAVE_FLAGS
static unsigned blocks(unsigned n)               /* blocks in which a denormal was read or made */
{
    unsigned b = 0, k;
    for (k = 0; k < n; k++) {
        _mm_setcsr(_mm_getcsr() & ~0x3Fu);
        fc_synth_render(&syn, buf, 128);
        b += (_mm_getcsr() & 0x12u) != 0;        /* DE (a denormal operand), UE (underflow) */
    }
    return b;
}
static unsigned play(const fc_sound_t *o, const fc_sound2_t *x, const fc_sound3_t *t, unsigned seed)
{
    unsigned v, n = 1u + seed % 10u, notes[10], bad;
    srand(seed);
    fc_synth_init(&syn, rv, dly);
    fc_synth_sound(&syn, o, x, t);
    fc_synth_tempo(&syn, (float)(60 + rand() % 180));
    bad = blocks(50);
    for (v = 0; v < n; v++) {
        notes[v] = (unsigned)(24 + rand() % 84);
        fc_synth_on(&syn, notes[v], (unsigned)(1 + rand() % 127));
    }
    bad += blocks(500);
    for (v = 0; v < n; v++)
        fc_synth_off(&syn, notes[v]);
    return bad + blocks(3000);                    /* the tails, then nine seconds of nothing */
}
#endif

int main(void)
{
    unsigned i, k, n;
#ifdef HAVE_FLAGS
    unsigned hit = 0;
    for (i = 0; i < FC_NSOUNDS; i++) {
        unsigned b = play(&FC_SOUNDS[i].snd, &FC_SOUNDS[i].sx, &FC_SOUNDS[i].s3, 1000u + i);
        CHECK(b == 0, "%s: denormals in %u blocks", FC_SOUNDS[i].name, b);
    }
    for (i = 0; i < 300u; i++) {                  /* random sounds, put in range as a loaded set would be */
        fc_set_t s;
        uint8_t *p = (uint8_t *)&s;
        srand(77u + i);
        for (k = 0; k < sizeof s; k++)
            p[k] = (uint8_t)rand();
        s.magic[0] = 'F';
        s.magic[1] = 'C';
        s.version = FC_SET_VERSION;
        s.nkeys = FC_NKEYS;
        CHECK(fc_set_check(&s) == 0, "random set %u not taken", i);
        hit += play(&s.sound, &s.sx, &s.s3, 5000u + i) != 0;
    }
    CHECK(hit == 0, "%u of 300 random sounds made denormals", hit);
    _mm_setcsr(_mm_getcsr() & ~0x3Fu);
    printf("ok   cpu_test: no denormals (%u factory sounds, 300 random; idle, playing, tails)\n", FC_NSOUNDS);
#else
    printf("skip cpu_test: denormal flags (not an x86 host)\n");
#endif

    /* the guard: a pretend FM-1 where the effects take BASE % of a block and each voice VOICE %; five-note chords
     * changed every half second over the last one's tails (DARK PAD: long release). After the first chord it must
     * keep every block under 90 %, and give the voices back when they are cheap */
    {
        static const double cost[3][2] = {{15.f, 12.f}, {20.f, 22.f}, {10.f, 4.f}};   /* heavy, very heavy, light */
        unsigned c;
        for (c = 0; c < 3u; c++) {
            unsigned over = 0, worst = 0, blocks_n = 0, cap = 10u, chord;
            fc_synth_init(&syn, rv, dly);
            fc_synth_sound(&syn, &FC_SOUNDS[1].snd, &FC_SOUNDS[1].sx, &FC_SOUNDS[1].s3);
            for (chord = 0; chord < 16u; chord++) {
                for (i = 0; i < 5u; i++)
                    fc_synth_on(&syn, 48u + (chord % 3u) * 2u + i * 4u, 100u);
                for (k = 0; k < 43u; k++) {           /* 43 blocks of 512: half a second */
                    unsigned pct, nn;
                    for (n = 0; n < 4u; n++)
                        fc_synth_render(&syn, buf, 128);
                    nn = fc_synth_active(&syn);
                    pct = (unsigned)(cost[c][0] + cost[c][1] * (double)nn);
                    if (chord > 0u) {
                        if (pct >= 90u)
                            over++;
                        if (pct > worst)
                            worst = pct;
                    }
                    blocks_n++;
                    cap = fc_synth_guard(&syn, pct);
                }
                for (i = 0; i < 5u; i++)
                    fc_synth_off(&syn, 48u + (chord % 3u) * 2u + i * 4u);
            }
            if (c < 2u)
                CHECK(over == 0u, "cost %.0f+%.0f/voice: %u of %u blocks over 90 %% (worst %u %%)", cost[c][0], cost[c][1],
                      over, blocks_n, worst);
            else
                CHECK(cap == 10u, "cheap voices: all ten allowed (%u)", cap);
            printf("     guard: effects %2.0f %%, voice %2.0f %%: cap %2u, worst block after the first chord %3u %%\n",
                   cost[c][0], cost[c][1], cap, worst);
        }
        fc_synth_voices(&syn, 6u);
        CHECK(fc_synth_guard(&syn, 30u) <= 6u, "never over VOICES");
    }
    printf(fails ? "cpu_test: %d failed\n" : "ok   cpu_test: the guard keeps every block under 90 %% once it knows the sound\n", fails);
    return fails ? 1 : 0;
}
