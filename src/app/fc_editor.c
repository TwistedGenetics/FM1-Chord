/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the web editor's commands (docs/PROTOCOL.md), in Felucca's editor frames F0 7D 46 4C cmd args F7.
 * Included by fc_app.c (its statics). web/editor/device.js asks; web/editor/mock-fm1.js answers the same way in the
 * demo. Copyright (C) 2026 Jamie (TwistedGenetics). */
enum { FC_ED_INFO = 40, FC_ED_SET_GET, FC_ED_SET_PUT, FC_ED_NAMES, FC_ED_SELECT, FC_ED_KEY, FC_ED_GLOB_GET,
       FC_ED_GLOB_PUT, FC_ED_EVT /* 48: sent by the FM-1 (live sync), never asked for */ };
#define FC_ED_WORKING 127u
#define FC_ED_PROTO 2u               /* 2 (0.3): set numbers are two bytes, hi lo (factory sets from 128) */

int fc_ed_long(uint32_t cmd) { return cmd == FC_ED_SET_PUT || cmd == FC_ED_GLOB_PUT; }

static void fc_ed_pack(void (*put)(uint32_t), const uint8_t *b, uint32_t n)
{
    uint32_t i, j;
    for (i = 0; i < n; i += 7u) {
        uint32_t m = 0, k = n - i < 7u ? n - i : 7u;
        for (j = 0; j < k; j++)
            m |= (uint32_t)(b[i + j] >> 7) << j;
        put(m);
        for (j = 0; j < k; j++)
            put(b[i + j] & 0x7Fu);
    }
}
static uint32_t fc_ed_unpack(const uint8_t *a, uint32_t na, uint8_t *out, uint32_t max)
{
    uint32_t n = 0;
    while (na && n < max) {
        uint32_t m = *a++, j;
        na--;
        for (j = 0; j < 7u && na && n < max; j++, na--)
            out[n++] = (uint8_t)(*a++ | ((m >> j) & 1u) << 7);
    }
    return n;
}

int fc_ed_cmd(uint32_t cmd, const uint8_t *a, uint32_t na, void (*put)(uint32_t))
{
    static fc_set_t t;
    uint32_t i, s;
    switch (cmd) {
    case FC_ED_INFO: {
        const char *v = "FM1-Chord " FC_VERSION;
        for (i = 0; v[i] && i < 24u; i++)
            put((uint8_t)v[i] & 0x7Fu);
        put(0);
        put(FC_ED_PROTO);
        put(FC_NFACTORY);
        put(FC_NUSER);
        put(fc_g.cur_set >> 7);
        put(fc_g.cur_set & 0x7Fu);
        put(fc_dirty);
        return 1;
    }
    case FC_ED_SET_GET:
        if (na < 2u)
            return 0;
        s = (uint32_t)a[0] << 7 | a[1];
        put(a[0]);
        put(a[1]);
        if (s == FC_ED_WORKING)
            t = fc_set;
        else if (s >= FC_FACTORY0 && s - FC_FACTORY0 < FC_NFACTORY)
            for (i = 0; i < FC_SET_BYTES; i++)
                ((uint8_t *)&t)[i] = FC_FACTORY[s - FC_FACTORY0][i];
        else if (s >= FC_NUSER || fc_user_load(s, &t)) {
            put(0);
            return 1;
        }
        put(1);
        fc_ed_pack(put, (const uint8_t *)&t, FC_SET_BYTES);
        return 1;
    case FC_ED_SET_PUT:
        if (na < 2u)
            return 0;
        s = (uint32_t)a[0] << 7 | a[1];
        put(a[0]);
        put(a[1]);
        if (fc_ed_unpack(a + 2, na - 2u, (uint8_t *)&t, FC_SET_BYTES) != FC_SET_BYTES) {
            put(1);
            return 1;
        }
        if (fc_set_check(&t)) {
            put(2);
            return 1;
        }
        if (s != FC_ED_WORKING && s >= FC_NUSER) {
            put(4);
            return 1;
        }
        if (s != FC_ED_WORKING) {
            fc_app_panic();
            if (fc_user_save(s, &t)) {
                put(3);
                return 1;
            }
        }
        if (s == FC_ED_WORKING || s == fc_g.cur_set) {   /* the keys play it now */
            uint32_t same = 1;
            for (i = 64; i < FC_SET_BYTES; i++)  /* the chords as they were: notes keep sounding (live editing) */
                if (((const uint8_t *)&t)[i] != ((const uint8_t *)&fc_set)[i])
                    same = 0;
            fc_lock();
            if (!same || t.play.mode != fc_set.play.mode || t.play.octave != fc_set.play.octave ||
                t.play.transpose != fc_set.play.transpose) {
                fc_player_release(&fc_pl);
                fc_synth_all_off(&fc_syn);
            }
            fc_set = t;
            fc_synth_sound(&fc_syn, &fc_set.sound);
            fc_unlock();
            fc_dirty = s == FC_ED_WORKING;
        }
        fc_rev_sent = fc_rev;                    /* the editor's own change: not announced back to it */
        fc_rev_kind = 0;
        fc_touch();
        put(0);
        return 1;
    case FC_ED_NAMES:
        put(FC_NUSER);
        for (s = 0; s < FC_NUSER; s++) {
            int ok = fc_user_load(s, &t) == 0;
            put(ok ? 1u : 0u);
            for (i = 0; i < 16u; i++)
                put(ok ? (uint8_t)t.name[i] & 0x7Fu : 0u);
        }
        return 1;
    case FC_ED_SELECT:
        if (na < 2u)
            return 0;
        put(a[0]);
        put(a[1]);
        if (fc_load_set((uint32_t)a[0] << 7 | a[1])) {
            put(1);
            return 1;
        }
        fc_rev_sent = fc_rev;                    /* the editor's own change: not announced back to it */
        fc_rev_kind = 0;
        fc_globals_save();
        put(0);
        return 1;
    case FC_ED_KEY:                                  /* audition from the editor: no reply */
        if (na >= 2u && a[0] < FC_NKEYS) {
            fc_lock();
            fc_player_key(&fc_pl, &fc_set, a[0], a[1]);
            fc_unlock();
        }
        return 2;
    case FC_ED_GLOB_GET:
        fc_ed_pack(put, (const uint8_t *)&fc_g, sizeof fc_g);
        return 1;
    case FC_ED_GLOB_PUT: {
        fc_globals_t g;
        if (fc_ed_unpack(a, na, (uint8_t *)&g, sizeof g) != sizeof g || fc_globals_check(&g)) {
            put(1);
            return 1;
        }
        g.cur_set = fc_g.cur_set;
        fc_g = g;
        fc_globals_save();
        fc_touch();
        put(0);
        return 1;
    }
    default:
        return 0;
    }
}
