/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: chord theory (see fc_chord.h). No floating point, no library calls: it runs in the FM-1's main loop
 * and audio interrupt as well as on the host. Copyright (C) 2026 Jamie (TwistedGenetics). */
#include "fc_chord.h"

/* semitones above the root, ascending; 0-terminated after the first entry (the root is always 0) */
static const uint8_t FC_IV[FC_NQ_NAMED][7] = {
    {0, 4, 7},                  /* maj */
    {0, 3, 7},                  /* min */
    {0, 4, 7, 10},              /* 7 */
    {0, 4, 7, 11},              /* maj7 */
    {0, 3, 7, 10},              /* m7 */
    {0, 4, 7, 10, 14},          /* 9 */
    {0, 3, 7, 10, 14},          /* m9 */
    {0, 4, 7, 10, 14, 17},      /* 11 */
    {0, 4, 7, 10, 14, 21},      /* 13 (the 11th left out, as it is usually played) */
    {0, 2, 7},                  /* sus2 */
    {0, 5, 7},                  /* sus4 */
    {0, 3, 6},                  /* dim */
    {0, 4, 8},                  /* aug */
    {0, 4, 7, 14},              /* add9 */
    {0, 4, 7, 9},               /* 6 */
    {0, 3, 7, 9},               /* m6 */
    {0, 7, 12},                 /* power (5) */
    {0, 3, 7, 10, 14, 17},      /* m11 */
    {0, 3, 6, 10},              /* m7b5 */
    {0, 3, 6, 9},               /* dim7 */
    {0, 4, 7, 11, 14},          /* maj9 */
    {0, 5, 7, 10},              /* 7sus4 */
};
static const char *const FC_SUFFIX[FC_NQ_NAMED] = {
    "", "m", "7", "maj7", "m7", "9", "m9", "11", "13", "sus2", "sus4", "dim", "aug", "add9", "6", "m6", "5",
    "m11", "m7b5", "dim7", "maj9", "7sus4",
};
static const char *const FC_NOTE[12] = {"C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"};
static const char *const FC_VOICING[FC_NV] = {"CLOSE", "OPEN", "DROP 2", "DROP 3", "SPREAD"};

const char *fc_note_name(uint32_t pc) { return FC_NOTE[pc % 12u]; }
const char *fc_voicing_name(uint32_t v) { return v < FC_NV ? FC_VOICING[v] : "?"; }
const char *fc_quality_name(uint32_t q)
{
    if (q == FC_Q_CUSTOM)
        return "*";
    return q < FC_NQ_NAMED ? FC_SUFFIX[q] : "?";
}

static void sort_u8(uint8_t *a, uint32_t n)
{
    uint32_t i, j;
    for (i = 1; i < n; i++) {
        uint8_t v = a[i];
        for (j = i; j > 0 && a[j - 1] > v; j--)
            a[j] = a[j - 1];
        a[j] = v;
    }
}
static void sort_i32(int32_t *a, uint32_t n)
{
    uint32_t i, j;
    for (i = 1; i < n; i++) {
        int32_t v = a[i];
        for (j = i; j > 0 && a[j - 1] > v; j--)
            a[j] = a[j - 1];
        a[j] = v;
    }
}

uint32_t fc_tones(const fc_chord_t *c, uint8_t *iv)
{
    uint32_t n = 0, i;
    if (c->quality == FC_Q_CUSTOM) {
        uint32_t m = (uint32_t)c->custom[0] | (uint32_t)c->custom[1] << 8 | (uint32_t)c->custom[2] << 16;
        for (i = 0; i < 24u && n < FC_MAXN - 1u; i++)
            if (m & (1u << i))
                iv[n++] = (uint8_t)i;
        return n;
    }
    if (c->quality >= FC_NQ_NAMED)
        return 0;
    iv[n++] = 0;
    for (i = 1; i < 7u && FC_IV[c->quality][i]; i++)
        iv[n++] = FC_IV[c->quality][i];
    return n;
}

/* the voicing applied to tones (ascending, relative semitones, may go negative) */
static void voice(int32_t *t, uint32_t n, uint32_t v)
{
    uint32_t i;
    switch (v) {
    case FC_V_OPEN:                                 /* every other note from the bottom up an octave */
        if (n >= 3u)
            for (i = 1; i < n; i += 2u)
                t[i] += 12;
        break;
    case FC_V_DROP2:                                /* the second from the top down an octave */
        if (n >= 3u)
            t[n - 2u] -= 12;
        break;
    case FC_V_DROP3:                                /* the third from the top down an octave (drop 2 on a triad) */
        if (n >= 4u)
            t[n - 3u] -= 12;
        else if (n == 3u)
            t[1] -= 12;
        break;
    case FC_V_SPREAD:                               /* the bottom down an octave, the rest open */
        if (n >= 2u) {
            t[0] -= 12;
            for (i = 2; i < n; i += 2u)
                t[i] += 12;
        }
        break;
    default:
        break;
    }
    sort_i32(t, n);
}

static int32_t clamp_note(int32_t lo, int32_t hi, int32_t *t, uint32_t n)
{
    /* the shift, in whole octaves, that keeps t[0] >= lo and t[n-1] <= hi where possible */
    int32_t s = 0;
    while (n && t[0] + s < lo)
        s += 12;
    while (n && t[n - 1u] + s > hi && t[0] + s - 12 >= lo)
        s -= 12;
    return s;
}

uint32_t fc_chord_notes(const fc_chord_t *c, int32_t shift, uint8_t *out)
{
    uint8_t iv[FC_MAXN];
    int32_t t[FC_MAXN], base, s;
    uint32_t n, i, inv, k = 0;
    if (c->quality == FC_EMPTY)
        return 0;
    n = fc_tones(c, iv);
    if (!n)
        return 0;
    for (i = 0; i < n; i++)
        t[i] = iv[i];
    inv = c->inversion;
    if (inv > n - 1u)
        inv = n - 1u;
    for (i = 0; i < inv; i++) {                     /* inversion: the lowest note up an octave, inv times */
        t[0] += 12;
        sort_i32(t, n);
    }
    voice(t, n, c->voicing);
    base = 48 + (int32_t)(c->root % 12u) + 12 * (int32_t)c->octave + shift;
    for (i = 0; i < n; i++)
        t[i] += base;
    s = clamp_note(24, 108, t, n);
    for (i = 0; i < n; i++)
        t[i] += s;
    if (c->bass < 12u) {                            /* slash bass: the bass note below the chord's lowest */
        int32_t b = t[0] - (((t[0] - (int32_t)c->bass) % 12 + 12) % 12);
        if (b == t[0])
            b -= 12;
        if (b < 12)
            b += 12;
        out[k++] = (uint8_t)b;
    }
    for (i = 0; i < n && k < FC_MAXN; i++)
        out[k++] = (uint8_t)(t[i] < 0 ? 0 : t[i] > 127 ? 127 : t[i]);
    return k;
}

/* how far apart two chords are: each note to the nearest in the other, both ways */
static int32_t lead_cost(const int32_t *a, uint32_t na, const uint8_t *b, uint32_t nb)
{
    int32_t cost = 0;
    uint32_t i, j;
    for (i = 0; i < na; i++) {
        int32_t best = 1000;
        for (j = 0; j < nb; j++) {
            int32_t d = a[i] - (int32_t)b[j];
            if (d < 0)
                d = -d;
            if (d < best)
                best = d;
        }
        cost += best;
    }
    for (j = 0; j < nb; j++) {
        int32_t best = 1000;
        for (i = 0; i < na; i++) {
            int32_t d = a[i] - (int32_t)b[j];
            if (d < 0)
                d = -d;
            if (d < best)
                best = d;
        }
        cost += best;
    }
    return cost;
}

void fc_voice_lead(const uint8_t *prev, uint32_t np, int32_t prev_bass, uint8_t *notes, uint32_t n, int has_bass)
{
    const uint8_t *pu = prev;
    int32_t t[FC_MAXN], best[FC_MAXN], cand[FC_MAXN], center0 = 0, bestc = 0x7FFFFFFF, bestd = 0;
    uint32_t i, r, nu, npu = np, off = has_bass ? 1u : 0u;
    int32_t k, pbass = prev_bass, have_pbass = prev_bass >= 0;
    if (!np || n <= off)
        return;
    nu = n - off;
    for (i = 0; i < nu; i++) {
        t[i] = notes[off + i];
        center0 += t[i];
        best[i] = t[i];
    }
    for (r = 0; r < nu; r++) {                      /* every inversion of the voicing as played ... */
        for (k = -3; k <= 3; k++) {                 /* ... in every octave near */
            int32_t c, d, sum = 0;
            for (i = 0; i < nu; i++)
                cand[i] = t[i] + 12 * k;
            if (cand[0] < 36 || cand[nu - 1u] > 96)
                continue;
            c = lead_cost(cand, nu, pu, npu);
            for (i = 0; i < nu; i++)
                sum += cand[i];
            d = sum - center0;
            if (d < 0)
                d = -d;
            if (c < bestc || (c == bestc && d < bestd)) {
                bestc = c;
                bestd = d;
                for (i = 0; i < nu; i++)
                    best[i] = cand[i];
            }
        }
        t[0] += 12;                                 /* next inversion */
        sort_i32(t, nu);
    }
    for (i = 0; i < nu; i++)
        notes[off + i] = (uint8_t)best[i];
    sort_u8(notes + off, nu);
    if (off) {                                      /* the bass: below the chord, nearest the last bass */
        int32_t pc = notes[0] % 12, lo = notes[1], b = lo - ((lo - pc) % 12 + 12) % 12, bb;
        if (b == lo)
            b -= 12;
        bb = b;
        if (have_pbass) {
            int32_t c1 = b - pbass, c2 = b - 12 - pbass;
            if (c1 < 0)
                c1 = -c1;
            if (c2 < 0)
                c2 = -c2;
            if (c2 < c1 && b - 12 >= 24)
                bb = b - 12;
        }
        notes[0] = (uint8_t)(bb < 12 ? bb + 12 : bb);
    }
}

void fc_chord_name(const fc_chord_t *c, char *buf, uint32_t n)
{
    const char *p;
    uint32_t k = 0;
    buf[0] = 0;
    if (c->quality == FC_EMPTY || n < 16u)
        return;
    for (p = FC_NOTE[c->root % 12u]; *p && k < n - 1u; p++)
        buf[k++] = *p;
    for (p = fc_quality_name(c->quality); *p && k < n - 1u; p++)
        buf[k++] = *p;
    if (c->bass < 12u && c->bass != c->root % 12u) {
        if (k < n - 1u)
            buf[k++] = '/';
        for (p = FC_NOTE[c->bass]; *p && k < n - 1u; p++)
            buf[k++] = *p;
    }
    buf[k] = 0;
}

static uint32_t pc_mask(const uint8_t *iv, uint32_t n, uint32_t root)
{
    uint32_t m = 0, i;
    for (i = 0; i < n; i++)
        m |= 1u << ((iv[i] + root) % 12u);
    return m;
}

static void place(fc_chord_t *c, uint32_t low)
{
    uint8_t t[FC_MAXN];
    int32_t o, best = 0, bd = 1000;
    for (o = -2; o <= 2; o++) {                     /* the octave whose lowest note is nearest the one played */
        int32_t d;
        c->octave = (int8_t)o;
        if (!fc_chord_notes(c, 0, t))
            return;
        d = (int32_t)t[0] - (int32_t)low;
        if (d < 0)
            d = -d;
        if (d < bd) {
            bd = d;
            best = o;
        }
    }
    c->octave = (int8_t)best;
}

int fc_chord_identify(const uint8_t *notes, uint32_t n, fc_chord_t *c)
{
    uint8_t s[16], iv[FC_MAXN];
    uint32_t i, q, r, k, low, have = 0, m = 0;
    if (!n)
        return 0;
    if (n > 16u)
        n = 16u;
    for (i = 0; i < n; i++)
        s[i] = notes[i];
    sort_u8(s, n);
    low = s[0];
    for (i = 0; i < n; i++)
        have |= 1u << (s[i] % 12u);
    c->custom[0] = c->custom[1] = c->custom[2] = 0;
    c->voicing = FC_V_CLOSE;
    c->bass = FC_NOBASS;
    c->reserved = 0;
    for (k = 0; k < 12u; k++) {                     /* roots: the lowest note first, then up from it */
        r = (low + k) % 12u;
        if (!(have & (1u << r)))
            continue;
        for (q = 0; q < FC_NQ_NAMED; q++) {
            fc_chord_t t;
            uint32_t nt, inv = 0;
            t.quality = (uint8_t)q;
            nt = fc_tones(&t, iv);
            if (pc_mask(iv, nt, r) != have)
                continue;
            for (i = 0; i < nt; i++)                /* which chord tone is at the bottom: the inversion */
                if ((iv[i] + r) % 12u == low % 12u) {
                    inv = i;
                    break;
                }
            c->root = (uint8_t)r;
            c->quality = (uint8_t)q;
            if (inv <= 3u) {
                c->inversion = (uint8_t)inv;
            } else {                                /* an extension at the bottom: a slash bass */
                c->inversion = 0;
                c->bass = (uint8_t)(low % 12u);
            }
            place(c, c->bass < 12u ? low + 12u : low);
            return 1;
        }
    }
    for (i = 0; i < n; i++)                         /* not a named chord: the notes as they are */
        if (s[i] - low < 24u)
            m |= 1u << (s[i] - low);
    c->root = (uint8_t)(low % 12u);
    c->quality = FC_Q_CUSTOM;
    c->custom[0] = (uint8_t)m;
    c->custom[1] = (uint8_t)(m >> 8);
    c->custom[2] = (uint8_t)(m >> 16);
    c->inversion = 0;
    place(c, low);
    return 1;
}
