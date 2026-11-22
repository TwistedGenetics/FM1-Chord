/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the few maths functions the synth needs, single-precision only (doubles go through software helpers on
 * the FM-1 and the build refuses them), no libm. web/editor/synth-core.js has the same in JavaScript.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>

/* 2^x for x in about -30 .. 30: the integer part by exponent bits, the fraction by a 5th-order polynomial
 * (relative error below 2e-6) */
static inline float fc_exp2f(float x)
{
    union { float f; uint32_t u; } r;
    int32_t i;
    float f, p;
    if (x < -30.f)
        x = -30.f;
    if (x > 30.f)
        x = 30.f;
    i = (int32_t)x;
    if (x < (float)i)
        i--;                                        /* floor */
    f = x - (float)i;
    p = 1.f + f * (0.69314718f + f * (0.24022650f + f * (0.05550411f + f * (0.00961813f + f * 0.00133336f))));
    r.u = (uint32_t)(i + 127) << 23;
    return r.f * p;
}

/* sin(2 pi t) for t in [0, 1): a parabola, corrected (the classic 0.225 refinement: error about 0.1 %) */
static inline float fc_sin_turn(float t)
{
    float u = 2.f * t - 1.f, au = u < 0.f ? -u : u;          /* sin(2 pi t) = -sin(pi u) */
    float y = 4.f * u * (1.f - au), ay = y < 0.f ? -y : y;
    y = 0.225f * (y * ay - y) + y;
    return -y;
}

/* tan(x) for x in [0, 1.45]: sin / cos by their series (enough for the filter's g = tan(pi fc / fs)) */
static inline float fc_tanf(float x)
{
    float x2 = x * x;
    float s = x * (1.f - x2 * (1.f / 6.f - x2 * (1.f / 120.f - x2 * (1.f / 5040.f - x2 * (1.f / 362880.f)))));
    float c = 1.f - x2 * (0.5f - x2 * (1.f / 24.f - x2 * (1.f / 720.f - x2 * (1.f / 40320.f - x2 * (1.f / 3628800.f)))));
    return s / c;
}

static inline float fc_clampf(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }

/* a soft clip: linear to about 0.5, 1 at the limit. Below 1e-5 the cube is under 1e-16 of x: x as it is, so the
 * anti-denormal offsets (1e-20) and quiet tails are never cubed into denormals (1e-60), which a CPU without
 * denormal hardware works out very slowly, sample after sample, while nothing plays */
static inline float fc_soft(float x)
{
    float a = x < 0.f ? -x : x;
    if (a < 1e-5f)
        return x;
    if (x > 1.5f)
        return 1.f;
    if (x < -1.5f)
        return -1.f;
    return x - (4.f / 27.f) * x * x * x;
}
