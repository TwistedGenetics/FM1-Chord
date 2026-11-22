/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord host test: the FM-1's harmony tiers (fc_rate_tier) for harmony_xcheck.mjs to compare with the editor's.
 * Every root x quality after six chords (one empty), in three keys x every scale, with and without the bias: one line
 * of 12 x 30 digits each. Then every factory set's chords, each after the key before it.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#include <stdio.h>
#include "fc_harmony.h"
#include "fc_set.h"
#include "fc_presets.h"

static fc_chord_t mk(uint32_t root, uint32_t q, uint32_t bass)
{
    fc_chord_t c = {0};
    c.root = (uint8_t)root;
    c.quality = (uint8_t)q;
    c.bass = (uint8_t)bass;
    return c;
}

int main(void)
{
    static const uint8_t KEYS[3] = {0, 5, 9};
    fc_chord_t prev[6];
    uint32_t p, k, s, b, r, q, i, j;
    prev[0] = mk(0, FC_EMPTY, FC_NOBASS);
    prev[1] = mk(5, FC_Q_M9, FC_NOBASS);
    prev[2] = mk(1, FC_Q_MAJ7, FC_NOBASS);
    prev[3] = mk(7, FC_Q_7, 11);
    prev[4] = mk(2, FC_Q_M7B5, FC_NOBASS);
    prev[5] = mk(10, FC_Q_SUS4, FC_NOBASS);
    for (p = 0; p < 6u; p++)
        for (k = 0; k < 3u; k++)
            for (s = 0; s < FC_NSCALE; s++)
                for (b = 0; b < 2u; b++) {
                    printf("G %u %u %u %u ", p, KEYS[k], s, b);
                    for (r = 0; r < 12u; r++)
                        for (q = 0; q < 30u; q++) {
                            fc_chord_t c = mk(r, q, FC_NOBASS);
                            putchar('0' + (int)fc_rate_tier(&c, &prev[p], KEYS[k], s, (int)b));
                        }
                    putchar('\n');
                }
    for (i = 0; i < FC_NFACTORY; i++) {
        const fc_set_t *st = (const fc_set_t *)FC_FACTORY[i];
        printf("S %u ", i);
        for (j = 0; j < FC_NKEYS; j++) {
            const fc_chord_t *pv = 0;
            uint32_t m;
            for (m = j; m-- > 0u;)
                if (st->ch[m].quality != FC_EMPTY) {
                    pv = &st->ch[m];
                    break;
                }
            if (st->ch[j].quality == FC_EMPTY || !pv)
                putchar('-');
            else
                putchar('0' + (int)fc_rate_tier(&st->ch[j], pv, st->key_root, st->key_scale, 1));
        }
        putchar('\n');
    }
    return 0;
}
