/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord host test: every factory set's chords as the firmware plays and names them (JSON lines), for
 * tests/host/sets_xcheck.mjs to compare with the editor. Copyright (C) 2026 Jamie (TwistedGenetics). */
#include <stdio.h>
#include <string.h>
#include "fc_chord.h"
#include "fc_presets.h"

int main(void)
{
    uint32_t s, k, i;
    for (s = 0; s < FC_NFACTORY; s++) {
        fc_set_t t;
        memcpy(&t, FC_FACTORY[s], sizeof t);
        if (fc_set_check(&t))
            return printf("set %u does not check\n", s), 1;
        for (k = 0; k < FC_NKEYS; k++) {
            uint8_t nt[FC_MAXN];
            char nm[24];
            uint32_t n = fc_chord_notes(&t.ch[k], 0, nt);
            fc_chord_name(&t.ch[k], nm, sizeof nm);
            printf("{\"set\":%u,\"key\":%u,\"name\":\"%s\",\"notes\":[", s, k, nm);
            for (i = 0; i < n; i++)
                printf("%s%u", i ? "," : "", nt[i]);
            printf("]}\n");
        }
    }
    return 0;
}
