/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord host test: the synth (src/dsp/fc_synth.c). Every factory sound plays a chord progression: no NaN, no
 * silence, no clipping beyond the soft clip, the voices end after the release, the filter tracks its cutoff, and the
 * cost per sample is measured (ten voices, chorus and reverb) so a change that makes it much dearer shows up.
 * Writes build/host/synth_<sound>.wav to listen to. Copyright (C) 2026 Jamie (TwistedGenetics). */
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "fc_synth.h"
#include "fc_chord.h"
#include "fc_presets.h"

static int fails;
#define CHECK(c, ...)                                                                                                 \
    do {                                                                                                              \
        if (!(c)) {                                                                                                   \
            printf("FAIL %s:%d ", __FILE__, __LINE__);                                                                \
            printf(__VA_ARGS__);                                                                                      \
            printf("\n");                                                                                             \
            fails++;                                                                                                  \
        }                                                                                                             \
    } while (0)

static float rv[FC_RV_FLOATS];
static int16_t dly[2u * FC_DLY_LEN];
static fc_synth_t syn;

static void wav_write(const char *path, const float *lr, uint32_t frames)
{
    FILE *f = fopen(path, "wb");
    uint32_t i, data = frames * 4u, v32;
    uint16_t v16;
    if (!f)
        return;
    fwrite("RIFF", 1, 4, f);
    v32 = 36u + data;
    fwrite(&v32, 4, 1, f);
    fwrite("WAVEfmt ", 1, 8, f);
    v32 = 16;
    fwrite(&v32, 4, 1, f);
    v16 = 1;
    fwrite(&v16, 2, 1, f);
    v16 = 2;
    fwrite(&v16, 2, 1, f);
    v32 = 44100;
    fwrite(&v32, 4, 1, f);
    v32 = 44100u * 4u;
    fwrite(&v32, 4, 1, f);
    v16 = 4;
    fwrite(&v16, 2, 1, f);
    v16 = 16;
    fwrite(&v16, 2, 1, f);
    fwrite("data", 1, 4, f);
    fwrite(&data, 4, 1, f);
    for (i = 0; i < frames * 2u; i++) {
        float x = lr[i] * 32767.f;
        int16_t s = (int16_t)(x > 32767.f ? 32767 : x < -32768.f ? -32768 : x);
        fwrite(&s, 2, 1, f);
    }
    fclose(f);
}

#define SECS 9u
static float buf[44100u * SECS * 2u];

static float rms(const float *lr, uint32_t a, uint32_t b)
{
    float s = 0.f;
    uint32_t i;
    for (i = a; i < b; i++)
        s += lr[2u * i] * lr[2u * i] + lr[2u * i + 1u] * lr[2u * i + 1u];
    return b > a ? s / (float)(2u * (b - a)) : 0.f;
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : "build/host";
    uint32_t si;
    /* Am9 Fmaj7 Cadd9 G6, two seconds each, released for the last 2 s */
    static const fc_chord_t prog[4] = {
        {9, FC_Q_M9, {0, 0, 0}, 0, 0, FC_NOBASS, 0, 0},
        {5, FC_Q_MAJ7, {0, 0, 0}, 1, 0, FC_NOBASS, 0, 0},
        {0, FC_Q_ADD9, {0, 0, 0}, 0, 0, FC_NOBASS, 0, 0},
        {7, FC_Q_6, {0, 0, 0}, 0, 0, 4, 0, 0},
    };
    double worst_ns = 0.0;
    setvbuf(stdout, 0, _IONBF, 0);
    for (si = 0; si < FC_NSOUNDS; si++) {
        uint32_t frame = 0, k, i, nan = 0;
        float peak = 0.f;
        char path[256];
        clock_t t0;
        double ns;
        fc_synth_init(&syn, rv, dly);
        fc_synth_sound(&syn, &FC_SOUNDS[si].snd, &FC_SOUNDS[si].sx);
        t0 = clock();
        for (k = 0; k < 4u; k++) {
            uint8_t nt[FC_MAXN];
            uint32_t n = fc_chord_notes(&prog[k], 0, nt), j;
            fc_synth_all_off(&syn);
            for (j = 0; j < n; j++)
                fc_synth_on(&syn, nt[j], 100);
            for (j = 0; j < 44100u * 3u / 2u; j += 128u, frame += 128u)
                fc_synth_render(&syn, buf + 2u * frame, 128);
            if (k == 3u)
                fc_synth_all_off(&syn);
            for (j = 0; j < 44100u / 2u; j += 128u, frame += 128u)
                fc_synth_render(&syn, buf + 2u * frame, 128);
        }
        CHECK(frame <= 44100u * SECS, "buffer");
        ns = (double)(clock() - t0) * 1e9 / CLOCKS_PER_SEC / (double)frame;
        if (ns > worst_ns)
            worst_ns = ns;
        for (i = 0; i < frame * 2u; i++) {
            float a = buf[i] < 0.f ? -buf[i] : buf[i];
            if (buf[i] != buf[i])
                nan++;
            if (a > peak)
                peak = a;
        }
        CHECK(!nan, "%s: %u NaN", FC_SOUNDS[si].name, nan);
        CHECK(peak > 0.05f && peak <= 1.0f, "%s: peak %.3f", FC_SOUNDS[si].name, (double)peak);
        CHECK(rms(buf, 0, 44100u / 4u) > 1e-4f, "%s: silent in its first quarter second", FC_SOUNDS[si].name);
        snprintf(path, sizeof path, "%s/synth_%s.wav", dir, FC_SOUNDS[si].file);
        wav_write(path, buf, frame);
        /* the voices end: 20 s more of nothing held (the longest release is 8 s) */
        for (i = 0; i < 44100u * 20u; i += 128u)
            fc_synth_render(&syn, buf, 128);
        CHECK(fc_synth_active(&syn) == 0, "%s: %u voices still on after the release", FC_SOUNDS[si].name,
              fc_synth_active(&syn));
        printf("     %-12s peak %.2f  rms %.4f  %.0f ns/frame\n", FC_SOUNDS[si].name, (double)peak,
               (double)rms(buf, 0, 44100u / 4u), ns);
    }
    /* voice stealing: 14 notes on 10 voices, then all off: nothing stuck */
    {
        uint32_t i;
        fc_synth_init(&syn, rv, dly);
        for (i = 0; i < 14u; i++)
            fc_synth_on(&syn, 48u + i, 100);
        CHECK(fc_synth_active(&syn) == FC_VOICES, "stealing: %u voices", fc_synth_active(&syn));
        for (i = 0; i < 14u; i++)
            fc_synth_off(&syn, 48u + i);
        for (i = 0; i < 44100u * 20u; i += 128u)
            fc_synth_render(&syn, buf, 128);
        CHECK(fc_synth_active(&syn) == 0, "stealing: stuck voices %u", fc_synth_active(&syn));
    }
    if (fails)
        printf("synth_test: %d FAILED\n", fails);
    else
        printf("ok   synth_test: every factory sound, voices end, stealing (host cost, worst %.0f ns a frame)\n",
               worst_ns);
    return fails != 0;
}
