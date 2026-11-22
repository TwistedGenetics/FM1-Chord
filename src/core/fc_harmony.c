/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the harmony rating, as web/editor/harmony.js rate() works out its tier.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#include "fc_harmony.h"
#include "fc_set.h"

static const uint16_t HZ_SCALE_MASK[FC_NSCALE] = {
    /* major, minor, dorian, phrygian, lydian, mixolydian, locrian, harmonic minor, melodic minor */
    0xAB5u, 0x5ADu, 0x6ADu, 0x5ABu, 0xAD5u, 0x6B5u, 0x56Bu, 0x9ADu, 0xAADu,
};
#define HZ_MINORISH(s) ((s) == 1u || (s) == 2u || (s) == 3u || (s) == 6u || (s) == 7u || (s) == 8u)
static const uint8_t HZ_COMMON_MAJOR[][2] = {{0, 5}, {0, 7}, {0, 9}, {2, 7}, {5, 7}, {7, 0}, {9, 5}, {9, 2}, {4, 9},
                                          {5, 0}, {5, 2}, {0, 2}, {7, 9}, {2, 5}, {0, 4}};
static const uint8_t HZ_COMMON_MINOR[][2] = {{0, 5}, {0, 8}, {0, 10}, {5, 7}, {5, 0}, {8, 10}, {10, 0}, {8, 5}, {0, 7},
                                          {2, 7}, {7, 0}, {0, 3}, {3, 8}, {10, 3}, {8, 7}, {0, 1}, {1, 0}, {5, 8}};

static int hz_is_empty(const fc_chord_t *c) { return c->quality == FC_EMPTY; }

/* the chord's pitch classes as a 12-bit mask (its slash bass too) */
static uint32_t hz_pcs(const fc_chord_t *c)
{
    uint8_t iv[32];
    uint32_t n, i, m = 0;
    if (hz_is_empty(c))
        return 0;
    n = fc_tones(c, iv);
    for (i = 0; i < n; i++)
        m |= 1u << ((iv[i] + c->root) % 12u);
    if (c->bass < 12u)
        m |= 1u << c->bass;
    return m;
}
static uint32_t hz_rot(uint32_t m, uint32_t root)            /* relative to the key's root */
{
    root %= 12u;
    return ((m >> root) | (m << (12u - root))) & 0xFFFu;
}
static int hz_in_scale(uint32_t m, uint32_t root, uint32_t scale) { return (hz_rot(m, root) & ~(uint32_t)HZ_SCALE_MASK[scale]) == 0; }
static int hz_minor_q(uint32_t q)
{
    return q == FC_Q_MIN || q == FC_Q_M7 || q == FC_Q_M9 || q == FC_Q_M11 || q == FC_Q_M6 || q == FC_Q_DIM ||
           q == FC_Q_M7B5 || q == FC_Q_DIM7;
}
static int hz_borrowed(uint32_t m, uint32_t root, uint32_t scale)
{
    static const uint8_t HZ_FROM_MAJOR[] = {1, 2, 3, 5}, HZ_FROM_MINOR[] = {0, 1, 2, 3, 5}, HZ_FROM_OTHER[] = {0, 1};
    const uint8_t *o = scale == 0u ? HZ_FROM_MAJOR : HZ_MINORISH(scale) ? HZ_FROM_MINOR : HZ_FROM_OTHER;
    uint32_t n = scale == 0u ? 4u : HZ_MINORISH(scale) ? 5u : 2u, i;
    for (i = 0; i < n; i++)
        if (o[i] != scale && hz_in_scale(m, root, o[i]))
            return 1;
    return 0;
}
static uint32_t hz_popc(uint32_t m)
{
    uint32_t n = 0;
    for (; m; m &= m - 1u)
        n++;
    return n;
}

uint32_t fc_rate_tier(const fc_chord_t *cand, const fc_chord_t *sel, uint32_t key_root, uint32_t scale, int bias)
{
    fc_chord_t ref;
    uint32_t m, rm, shared, from, to, k, i, nc, sec_target, q = cand->quality;
    int diatonic, common = 0, bor, is_dom, secondary, phr2, empty_sel = hz_is_empty(sel);
    scale = scale < FC_NSCALE ? scale : 1u;
    key_root %= 12u;
    if (empty_sel) {
        ref.root = (uint8_t)key_root;
        ref.quality = HZ_MINORISH(scale) ? FC_Q_MIN : FC_Q_MAJ;
        ref.custom[0] = ref.custom[1] = ref.custom[2] = 0;
        ref.inversion = ref.voicing = 0;
        ref.bass = FC_NOBASS;
        ref.octave = 0;
        ref.custom_hi = 0;
        sel = &ref;
    }
    m = hz_pcs(cand);
    rm = hz_pcs(sel);
    shared = hz_popc(m & rm);
    diatonic = hz_in_scale(m, key_root, scale);
    from = (sel->root + 12u - key_root) % 12u;
    to = (cand->root + 12u - key_root) % 12u;
    nc = HZ_MINORISH(scale) ? sizeof HZ_COMMON_MINOR / 2u : sizeof HZ_COMMON_MAJOR / 2u;
    for (i = 0; i < nc; i++) {
        const uint8_t *p = HZ_MINORISH(scale) ? HZ_COMMON_MINOR[i] : HZ_COMMON_MAJOR[i];
        if (p[0] == from && p[1] == to)
            common = 1;
    }
    bor = !diatonic && hz_borrowed(m, key_root, scale);
    is_dom = q == FC_Q_7 || q == FC_Q_MAJ || q == FC_Q_9;
    sec_target = (cand->root + 5u) % 12u;
    k = (sec_target + 12u - key_root) % 12u;
    secondary = !diatonic && is_dom && ((HZ_SCALE_MASK[scale] >> k) & 1u);
    phr2 = to == 1u && HZ_MINORISH(scale) && !hz_minor_q(q) && q != FC_Q_AUG;
    (void)empty_sel;
    if ((diatonic && (common || shared >= 2u)) || (bias && phr2))
        return FC_TIER_STRONG;
    if (diatonic || bor || secondary || phr2 || shared >= 2u)
        return FC_TIER_OK;
    return FC_TIER_FAR;
}
