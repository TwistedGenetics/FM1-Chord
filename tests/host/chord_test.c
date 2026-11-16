/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord host test: the chord theory (src/core/fc_chord.c), the set checks (fc_set.c) and the player
 * (fc_play.c): known chords note for note, inversions and voicings, slash bass, voice leading, strum timing,
 * the arpeggiator, latch. With "dump" it prints every quality x inversion x voicing x bass x octave as JSON lines
 * for tests/host/chord_xcheck.mjs (the editor's chord.js must give the same notes). Copyright (C) 2026 Jamie. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "fc_chord.h"
#include "fc_set.h"
#include "fc_play.h"

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

static fc_chord_t mk(uint32_t root, uint32_t q, uint32_t inv, uint32_t voicing, uint32_t bass, int oct)
{
    fc_chord_t c;
    memset(&c, 0, sizeof c);
    c.root = (uint8_t)root;
    c.quality = (uint8_t)q;
    c.inversion = (uint8_t)inv;
    c.voicing = (uint8_t)voicing;
    c.bass = (uint8_t)bass;
    c.octave = (int8_t)oct;
    return c;
}

static int same(const uint8_t *a, uint32_t na, const int *b, uint32_t nb)
{
    uint32_t i;
    if (na != nb)
        return 0;
    for (i = 0; i < na; i++)
        if (a[i] != b[i])
            return 0;
    return 1;
}
static void show(const uint8_t *a, uint32_t n, char *buf)
{
    uint32_t i, k = 0;
    for (i = 0; i < n; i++)
        k += (uint32_t)sprintf(buf + k, "%s%u", i ? " " : "", a[i]);
    buf[k] = 0;
}

#define EXPECT(c, shift, ...)                                                                                         \
    do {                                                                                                              \
        const int want[] = {__VA_ARGS__};                                                                             \
        uint8_t got[FC_MAXN];                                                                                         \
        char b1[64], nm[24];                                                                                          \
        uint32_t n = fc_chord_notes(&(c), shift, got);                                                                \
        fc_chord_name(&(c), nm, sizeof nm);                                                                           \
        show(got, n, b1);                                                                                             \
        CHECK(same(got, n, want, sizeof want / sizeof want[0]), "%s: got [%s]", nm, b1);                              \
    } while (0)

/* ---- the player, with a recording output ---- */
static struct { uint32_t t, note, on, vel; } ev[256];
static uint32_t nev, clock_now;
static void o_on(void *u, uint32_t n, uint32_t v)
{
    (void)u;
    if (nev < 256u)
        ev[nev].t = clock_now, ev[nev].note = n, ev[nev].on = 1, ev[nev].vel = v, nev++;
}
static void o_off(void *u, uint32_t n)
{
    (void)u;
    if (nev < 256u)
        ev[nev].t = clock_now, ev[nev].note = n, ev[nev].on = 0, ev[nev].vel = 0, nev++;
}
static uint32_t ons(void)
{
    uint32_t i, k = 0;
    for (i = 0; i < nev; i++)
        k += ev[i].on;
    return k;
}
static int balanced(void)        /* every on has its off, nothing on twice */
{
    int on[128] = {0};
    uint32_t i;
    for (i = 0; i < nev; i++) {
        if (ev[i].on) {
            if (on[ev[i].note])
                return 0;
            on[ev[i].note] = 1;
        } else {
            if (!on[ev[i].note])
                return 0;
            on[ev[i].note] = 0;
        }
    }
    for (i = 0; i < 128u; i++)
        if (on[i])
            return 0;
    return 1;
}
static void run(fc_player_t *p, const fc_set_t *s, uint32_t ms)
{
    uint32_t f = ms * 441u / 10u, k;
    while (f) {
        k = f > 128u ? 128u : f;
        fc_player_run(p, s, k, 0);
        clock_now += k;
        f -= k;
    }
}

static void dump(void)
{
    uint32_t q, inv, v, b, r;
    int o;
    for (q = 0; q <= FC_NQ_NAMED; q++)
        for (r = 0; r < 12u; r += 5u)
            for (inv = 0; inv < 4u; inv++)
                for (v = 0; v < FC_NV; v++)
                    for (b = 0; b < 13u; b += 4u)
                        for (o = -1; o <= 1; o++) {
                            fc_chord_t c = mk(r, q == FC_NQ_NAMED ? FC_Q_CUSTOM : q, inv, v, b == 12u ? FC_NOBASS : b, o);
                            uint8_t nt[FC_MAXN];
                            char nm[24];
                            uint32_t n, i;
                            if (q == FC_NQ_NAMED) {         /* a custom chord: root, b3, 5, 9, 11 (0x24489) */
                                c.custom[0] = 0x89;
                                c.custom[1] = 0x44;
                                c.custom[2] = 0x02;
                            }
                            n = fc_chord_notes(&c, 3, nt);
                            fc_chord_name(&c, nm, sizeof nm);
                            printf("{\"root\":%u,\"q\":%u,\"inv\":%u,\"v\":%u,\"bass\":%u,\"oct\":%d,\"name\":\"%s\",\"notes\":[",
                                   r, c.quality, inv, v, c.bass, o, nm);
                            for (i = 0; i < n; i++)
                                printf("%s%u", i ? "," : "", nt[i]);
                            printf("]}\n");
                        }
    /* voice leading: a chain of chords */
    {
        static const uint8_t ch[][3] = {{9, FC_Q_M9, 0}, {2, FC_Q_M7, 0}, {7, FC_Q_7, 0}, {0, FC_Q_MAJ7, 0},
                                        {5, FC_Q_MAJ9, 0}, {10, FC_Q_7, 2}, {4, FC_Q_SUS4, 0}, {9, FC_Q_M11, 0}};
        uint8_t prev[FC_MAXN];
        uint32_t np = 0, i, k;
        int32_t pb = -1;
        for (k = 0; k < sizeof ch / sizeof ch[0]; k++) {
            fc_chord_t c = mk(ch[k][0], ch[k][1], 0, 0, ch[k][2] ? ch[k][2] : FC_NOBASS, 0);
            uint8_t nt[FC_MAXN];
            uint32_t n = fc_chord_notes(&c, 0, nt), hb = c.bass < 12u;
            if (np)
                fc_voice_lead(prev, np, pb, nt, n, (int)hb);
            printf("{\"lead\":%u,\"root\":%u,\"q\":%u,\"bass\":%u,\"notes\":[", k, c.root, c.quality, c.bass);
            for (i = 0; i < n; i++)
                printf("%s%u", i ? "," : "", nt[i]);
            printf("]}\n");
            np = 0;
            for (i = hb; i < n; i++)
                prev[np++] = nt[i];
            pb = hb ? nt[0] : -1;
        }
    }
}

int main(int argc, char **argv)
{
    fc_chord_t c;
    fc_set_t set;
    fc_player_t pl;
    fc_out_t out = {o_on, o_off, 0};
    char nm[24];
    if (argc > 1 && !strcmp(argv[1], "dump")) {
        dump();
        return 0;
    }
    /* triads and sevenths, root position, close: root in the C3 octave */
    c = mk(0, FC_Q_MAJ, 0, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 48, 52, 55);
    c = mk(9, FC_Q_MIN, 0, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 57, 60, 64);
    c = mk(2, FC_Q_M9, 0, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 50, 53, 57, 60, 64);
    c = mk(7, FC_Q_7, 0, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 55, 59, 62, 65);
    c = mk(0, FC_Q_POWER, 0, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 48, 55, 60);
    /* inversions */
    c = mk(0, FC_Q_MAJ, 1, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 52, 55, 60);
    c = mk(0, FC_Q_MAJ, 2, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 55, 60, 64);
    c = mk(0, FC_Q_MAJ, 3, 0, FC_NOBASS, 0);     /* a triad has no third inversion: second */
    EXPECT(c, 0, 55, 60, 64);
    c = mk(0, FC_Q_MAJ7, 3, 0, FC_NOBASS, 0);
    EXPECT(c, 0, 59, 60, 64, 67);
    /* voicings on C maj7 (48 52 55 59) */
    c = mk(0, FC_Q_MAJ7, 0, FC_V_DROP2, FC_NOBASS, 0);
    EXPECT(c, 0, 43, 48, 52, 59);
    c = mk(0, FC_Q_MAJ7, 0, FC_V_DROP3, FC_NOBASS, 0);
    EXPECT(c, 0, 40, 48, 55, 59);
    c = mk(0, FC_Q_MAJ7, 0, FC_V_OPEN, FC_NOBASS, 0);
    EXPECT(c, 0, 48, 55, 64, 71);
    c = mk(0, FC_Q_MAJ, 0, FC_V_SPREAD, FC_NOBASS, 0);
    EXPECT(c, 0, 36, 52, 67);
    /* slash bass, octave, shift */
    c = mk(0, FC_Q_MAJ, 0, 0, 7, 0);
    EXPECT(c, 0, 43, 48, 52, 55);
    fc_chord_name(&c, nm, sizeof nm);
    CHECK(!strcmp(nm, "C/G"), "name %s", nm);
    c = mk(5, FC_Q_M9, 0, 0, 1, 1);
    fc_chord_name(&c, nm, sizeof nm);
    CHECK(!strcmp(nm, "Fm9/Db"), "name %s", nm);
    EXPECT(c, -12, 49, 53, 56, 60, 63, 67);
    c = mk(0, FC_Q_MAJ, 0, 0, 0, 0);              /* a slash bass on the root: an octave below, not named */
    EXPECT(c, 0, 36, 48, 52, 55);
    fc_chord_name(&c, nm, sizeof nm);
    CHECK(!strcmp(nm, "C"), "name %s", nm);
    c = mk(0, FC_EMPTY, 0, 0, FC_NOBASS, 0);
    {
        uint8_t t[FC_MAXN];
        CHECK(fc_chord_notes(&c, 0, t) == 0, "empty key plays nothing");
    }
    /* custom: C Eb G D' F' (bits 0 3 7 14 17) */
    c = mk(0, FC_Q_CUSTOM, 0, 0, FC_NOBASS, 0);
    c.custom[0] = 0x89;
    c.custom[1] = 0x40;
    c.custom[2] = 0x02;
    EXPECT(c, 0, 48, 51, 55, 62, 65);
    /* range: very high chords come down an octave, very low go up */
    c = mk(11, FC_Q_13, 0, FC_V_OPEN, FC_NOBASS, 2);
    {
        uint8_t t[FC_MAXN];
        uint32_t n = fc_chord_notes(&c, 36, t);
        CHECK(n == 6 && t[n - 1] <= 108 && t[0] >= 24, "range high: %u..%u", t[0], t[n - 1]);
        c = mk(0, FC_Q_MAJ, 0, FC_V_SPREAD, FC_NOBASS, -2);
        n = fc_chord_notes(&c, -36, t);
        CHECK(t[0] >= 24, "range low: %u", t[0]);
    }
    /* voice leading: Am9 -> Dm7 moves little */
    {
        fc_chord_t a = mk(9, FC_Q_M9, 0, 0, FC_NOBASS, 0), d = mk(2, FC_Q_M7, 0, 0, FC_NOBASS, 0);
        uint8_t ta[FC_MAXN], td[FC_MAXN];
        uint32_t na = fc_chord_notes(&a, 0, ta), nd = fc_chord_notes(&d, 0, td), i;
        int32_t before = 0, after = 0;
        for (i = 0; i < 4u; i++)
            before += abs((int)td[i] - (int)ta[i]);
        fc_voice_lead(ta, na, -1, td, nd, 0);
        for (i = 0; i < 4u; i++)
            after += abs((int)td[i] - (int)ta[i]);
        CHECK(after <= before, "voice leading moved more: %d > %d", after, before);
        CHECK(td[0] % 12u == 0 || td[0] % 12u == 2 || td[0] % 12u == 5 || td[0] % 12u == 9, "still Dm7");
    }
    /* LEARN: notes back to chords */
    {
        static const struct { uint8_t n[6]; uint32_t k, root, q, inv, bass; } L[] = {
            {{57, 60, 64, 67, 71}, 5, 9, FC_Q_M9, 0, FC_NOBASS},     /* Am9 */
            {{52, 55, 60}, 3, 0, FC_Q_MAJ, 1, FC_NOBASS},            /* C/E: first inversion */
            {{60, 64, 67, 69}, 4, 0, FC_Q_6, 0, FC_NOBASS},          /* C6, not Am7 (C at the bottom) */
            {{57, 60, 64, 67}, 4, 9, FC_Q_M7, 0, FC_NOBASS},         /* Am7, not C6 */
            {{50, 55, 57}, 3, 2, FC_Q_SUS4, 0, FC_NOBASS},           /* Dsus4 (preferred to Gsus2: D at the bottom) */
            {{48, 49, 55, 62}, 4, 0, FC_Q_CUSTOM, 0, FC_NOBASS},     /* nothing named */
        };
        uint32_t i;
        for (i = 0; i < sizeof L / sizeof L[0]; i++) {
            fc_chord_t got;
            uint8_t t[FC_MAXN];
            uint32_t n;
            fc_chord_identify(L[i].n, L[i].k, &got);
            fc_chord_name(&got, nm, sizeof nm);
            CHECK(got.root == L[i].root && got.quality == L[i].q && got.inversion == L[i].inv &&
                  got.bass == L[i].bass, "learn %u: %s inv %u", i, nm, got.inversion);
            n = fc_chord_notes(&got, 0, t);
            CHECK(n && t[0] == L[i].n[0], "learn %u: sits where played (%u, not %u)", i, t[0], L[i].n[0]);
        }
    }
    /* sets */
    fc_set_init(&set, "TEST");
    CHECK(fc_set_check(&set) == 0, "a new set checks");
    CHECK(fc_set_used_keys(&set) == 0, "a new set is empty");
    set.ch[0] = mk(9, FC_Q_M9, 0, 0, FC_NOBASS, 0);
    set.ch[1] = mk(5, FC_Q_MAJ7, 1, 0, FC_NOBASS, 0);
    set.ch[2] = mk(7, FC_Q_SUS4, 0, 0, 0, 0);
    set.ch[3].quality = 99;
    set.ch[4].root = 15;
    set.ch[4].quality = FC_Q_MAJ;
    CHECK(fc_set_check(&set) == 0 && set.ch[3].quality == FC_EMPTY && set.ch[4].root == 3, "values put in range");
    CHECK(fc_set_used_keys(&set) == 0x17u, "used keys %x", fc_set_used_keys(&set));
    set.magic[0] = 'X';
    CHECK(fc_set_check(&set) == -1, "not a set");
    set.magic[0] = 'F';
    /* the player: chord mode */
    fc_player_init(&pl, &out);
    nev = 0;
    fc_player_key(&pl, &set, 0, 100);
    CHECK(ons() == 5 && pl.key == 0, "Am9: five notes on (%u)", ons());
    run(&pl, &set, 50);
    fc_player_key(&pl, &set, 0, 0);
    CHECK(balanced(), "chord mode: on / off paired");
    /* octave and transpose */
    set.play.octave = 1;
    set.play.transpose = -2;
    nev = 0;
    fc_player_key(&pl, &set, 0, 100);
    CHECK(ev[0].note == 57 + 12 - 2, "octave +1, transpose -2: %u", ev[0].note);
    fc_player_key(&pl, &set, 0, 0);
    set.play.octave = 0;
    set.play.transpose = 0;
    /* latch: stays on after the key, the same key stops it, another key replaces it */
    set.play.latch = 1;
    nev = 0;
    fc_player_key(&pl, &set, 1, 100);
    fc_player_key(&pl, &set, 1, 0);
    CHECK(pl.key == 1, "latched");
    fc_player_key(&pl, &set, 2, 100);
    fc_player_key(&pl, &set, 2, 0);
    CHECK(pl.key == 2, "latched: the next key replaces it");
    fc_player_key(&pl, &set, 2, 100);
    CHECK(pl.key == -1, "latched: the same key again stops it");
    fc_player_key(&pl, &set, 2, 0);
    CHECK(balanced(), "latch: on / off paired");
    set.play.latch = 0;
    /* strum: 30 x 2 = 60 ms apart, upwards */
    set.play.mode = FC_M_STRUM;
    set.play.strum = 30;
    set.play.strum_dir = 0;
    nev = 0;
    clock_now = 0;
    fc_player_key(&pl, &set, 0, 100);
    run(&pl, &set, 400);
    CHECK(ons() == 5, "strum: all five (%u)", ons());
    {
        uint32_t i, ok = 1;
        for (i = 1; i < 5u; i++)
            if (ev[i].note <= ev[i - 1].note || ev[i].t - ev[i - 1].t > 2700u || ev[i].t - ev[i - 1].t < 2500u)
                ok = 0;
        CHECK(ok, "strum: rising, about 60 ms apart (%u %u)", ev[1].t - ev[0].t, ev[2].t - ev[1].t);
    }
    fc_player_key(&pl, &set, 0, 0);
    CHECK(balanced(), "strum: on / off paired");
    /* releasing mid-strum: the rest never starts */
    nev = 0;
    fc_player_key(&pl, &set, 0, 100);
    run(&pl, &set, 70);
    fc_player_key(&pl, &set, 0, 0);
    run(&pl, &set, 400);
    CHECK(ons() == 2 && balanced(), "strum cut: %u started", ons());
    /* arpeggiator: 1/16 at 120 = 125 ms a step, up, one octave, 50 % gate */
    set.play.mode = FC_M_ARP;
    set.play.arp_rate = FC_R_16;
    set.play.arp_dir = 0;
    set.play.arp_oct = 1;
    set.play.arp_gate = 50;
    set.tempo = 120;
    nev = 0;
    clock_now = 0;
    fc_player_key(&pl, &set, 0, 100);
    run(&pl, &set, 1000);
    CHECK(ons() == 8 || ons() == 9, "arp: 8 steps a second (%u)", ons());
    CHECK(ev[0].note == 57 && ev[2].note == 60, "arp: up from A (%u, %u)", ev[0].note, ev[2].note);
    fc_player_key(&pl, &set, 0, 0);
    CHECK(balanced(), "arp: on / off paired");
    /* arp on MIDI clock */
    nev = 0;
    fc_player_key(&pl, &set, 0, 100);
    {
        uint32_t i;
        for (i = 0; i < 24u; i++)
            fc_player_clock(&pl, &set);
    }
    CHECK(ons() == 5, "arp on MIDI clock: a quarter is four 1/16 steps after the first (%u)", ons());
    fc_player_stop(&pl);
    CHECK(balanced(), "stop: all off");
    /* humanise stays in range */
    set.play.mode = FC_M_CHORD;
    set.play.humanise = 127;
    nev = 0;
    {
        uint32_t i, ok = 1, lo = 127, hi = 0;
        for (i = 0; i < 40u; i++) {
            fc_player_key(&pl, &set, 0, 100);
            fc_player_key(&pl, &set, 0, 0);
        }
        for (i = 0; i < nev; i++)
            if (ev[i].on) {
                if (ev[i].vel < 60u || ev[i].vel > 127u)
                    ok = 0;
                lo = ev[i].vel < lo ? ev[i].vel : lo;
                hi = ev[i].vel > hi ? ev[i].vel : hi;
            }
        CHECK(ok && hi - lo > 20u, "humanise: %u..%u", lo, hi);
    }
    printf(fails ? "chord_test: %d FAILED\n" : "ok   chord_test: chords, inversions, voicings, slash bass, voice leading, "
                                               "sets, latch, strum, arp, humanise\n", fails);
    return fails != 0;
}
