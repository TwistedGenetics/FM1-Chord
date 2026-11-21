/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: chord sets (fc_set.h). Copyright (C) 2026 Jamie (TwistedGenetics). */
#include "fc_set.h"

static void zero(void *p, uint32_t n)
{
    uint8_t *b = (uint8_t *)p;
    while (n--)
        *b++ = 0;
}
static uint8_t lim(uint8_t v, uint8_t lo, uint8_t hi) { return v < lo ? lo : v > hi ? hi : v; }
static int8_t lims(int8_t v, int8_t lo, int8_t hi) { return v < lo ? lo : v > hi ? hi : v; }

/* beat divisions: beats (quarter notes) long */
const float FC_DIV_BEATS[FC_NDIV] = {0.125f, 1.f / 6.f, 0.25f, 1.f / 3.f, 0.375f, 0.5f, 2.f / 3.f, 0.75f, 1.f, 1.5f,
                                     2.f, 4.f, 8.f, 16.f, 32.f};
const char *const FC_DIV_NAME[FC_NDIV] = {"1/32", "1/16T", "1/16", "1/8T", "1/16D", "1/8", "1/4T", "1/8D", "1/4",
                                          "1/4D", "1/2", "1 BAR", "2 BARS", "4 BARS", "8 BARS"};

void fc_sound3_default(fc_sound3_t *x)
{
    zero(x, sizeof *x);
    x->spread = 50;
}

void fc_sound2_default(fc_sound2_t *x)
{
    zero(x, sizeof *x);
    x->lfo_rate[0] = 64;                     /* about 1 Hz */
    x->lfo_rate[1] = 40;
    x->lfo_sync[1] = 0;
    x->menv_a = 40;
    x->menv_d = 80;
    x->menv_s = 0;
    x->menv_r = 70;
    x->macro[0] = x->macro[1] = x->macro[2] = x->macro[3] = 64;
    x->dly_time = FC_D_8D;
    x->dly_fb = 50;
    x->dly_tone = 80;
}

void fc_sound_default(fc_sound_t *s)         /* a warm pad: the editor's "WARM PAD" (web/editor/presets.json) */
{
    zero(s, sizeof *s);
    s->type = 0;
    s->wave_a = FC_W_SAW;
    s->wave_b = FC_W_SAW;
    s->detune = 18;
    s->b_level = 100;
    s->sub = 20;
    s->cutoff = 70;
    s->res = 20;
    s->fenv = 25;
    s->ftrack = 40;
    s->amp_a = 70;
    s->amp_d = 80;
    s->amp_s = 110;
    s->amp_r = 85;
    s->flt_a = 75;
    s->flt_d = 90;
    s->flt_s = 60;
    s->flt_r = 85;
    s->chorus = 70;
    s->rev_mix = 45;
    s->rev_size = 90;
    s->level = 100;
    s->vel_sens = 40;
}

void fc_set_init(fc_set_t *s, const char *name)
{
    uint32_t i;
    zero(s, sizeof *s);
    s->magic[0] = 'F';
    s->magic[1] = 'C';
    s->version = FC_SET_VERSION;
    s->nkeys = FC_NKEYS;
    for (i = 0; name && name[i] && i < 16u; i++)
        s->name[i] = name[i];
    s->key_root = 0;
    s->key_scale = FC_SC_MINOR;
    s->tempo = 120;
    fc_sound_default(&s->sound);
    fc_sound2_default(&s->sx);
    fc_sound3_default(&s->s3);
    s->play.mode = FC_M_CHORD;
    s->play.strum = 15;
    s->play.arp_rate = FC_R_16;
    s->play.arp_oct = 1;
    s->play.arp_gate = 60;
    s->play.swing = 50;
    for (i = 0; i < FC_NKEYS; i++) {
        s->ch[i].quality = FC_EMPTY;
        s->ch[i].bass = FC_NOBASS;
    }
}

int fc_set_check(fc_set_t *s)
{
    uint32_t i;
    fc_sound_t *o = &s->sound;
    fc_play_t *p = &s->play;
    if (s->magic[0] != 'F' || s->magic[1] != 'C' || s->version == 0 || s->version > FC_SET_VERSION ||
        s->nkeys != FC_NKEYS)
        return -1;
    for (i = 0; i < 16u; i++)
        if ((uint8_t)s->name[i] >= 127u || ((uint8_t)s->name[i] && (uint8_t)s->name[i] < 32u))
            s->name[i] = ' ';
    s->key_root %= 12u;
    s->key_scale = lim(s->key_scale, 0, FC_NSCALE - 1u);
    s->tempo = lim(s->tempo, 40, 250);
    o->wave_a = lim(o->wave_a, 0, FC_NW - 1u);
    o->wave_b = lim(o->wave_b, 0, FC_NW - 1u);
    {
        uint8_t *b = &o->detune, *e = &o->vel_sens;
        for (; b <= e; b++)
            *b = lim(*b, 0, 127);
    }
    p->mode = lim(p->mode, 0, FC_NMODE - 1u);
    p->strum = lim(p->strum, 0, 127);
    p->strum_dir = lim(p->strum_dir, 0, 2);
    p->arp_rate = lim(p->arp_rate, 0, FC_NRATE - 1u);
    p->arp_dir = lim(p->arp_dir, 0, 3);
    p->arp_oct = lim(p->arp_oct, 1, 3);
    p->arp_gate = lim(p->arp_gate, 5, 100);
    p->latch = p->latch ? 1u : 0u;
    p->voice_lead = p->voice_lead ? 1u : 0u;
    p->humanise = lim(p->humanise, 0, 127);
    p->transpose = lims(p->transpose, -12, 12);
    p->octave = lims(p->octave, -3, 3);
    p->swing = lim(p->swing, 0, 100);
    for (i = 0; i < FC_NKEYS; i++) {
        fc_chord_t *c = &s->ch[i];
        if (c->quality != FC_EMPTY && c->quality != FC_Q_CUSTOM && c->quality >= FC_NQ_NAMED)
            c->quality = FC_EMPTY;
        if (c->quality == FC_Q_CUSTOM && !(c->custom[0] | c->custom[1] | c->custom[2] | c->custom_hi))
            c->quality = FC_EMPTY;
        c->root %= 12u;
        c->inversion = lim(c->inversion, 0, 3);
        c->voicing = lim(c->voicing, 0, FC_NV - 1u);
        if (c->bass != FC_NOBASS)
            c->bass %= 12u;
        c->octave = lims(c->octave, -2, 2);
    }
    if (s->version == 1u) {                   /* 0.1 .. 0.5: the sound had no part 2 */
        fc_sound2_default(&s->sx);
        s->version = 2;
    }
    if (s->version == 2u) {                   /* 0.6: nor part 3 */
        fc_sound3_default(&s->s3);
        s->version = FC_SET_VERSION;
    }
    {
        fc_sound3_t *t = &s->s3;
        t->wt_pos = lim(t->wt_pos, 0, 127);
        t->spread = lim(t->spread, 0, 127);
        t->osc_mode = lim(t->osc_mode, 0, FC_NOMODE - 1u);
        t->b_semi = lims(t->b_semi, -24, 24);
        t->crush_bits = lim(t->crush_bits, 0, 127);
        t->crush_rate = lim(t->crush_rate, 0, 127);
        t->wobble = lim(t->wobble, 0, 127);
        if ((t->fx >> 6) >= FC_NCMODE)
            t->fx &= 0x3Fu;
    }
    {
        fc_sound2_t *x = &s->sx;
        uint8_t *b;
        for (b = &x->drive; b <= &x->menv_r; b++)
            *b = lim(*b, 0, 127);
        x->flt_mode = lim(x->flt_mode, 0, FC_NFMODE - 1u);
        x->flt_slope = lim(x->flt_slope, 0, 1);
        for (i = 0; i < 2u; i++) {
            x->lfo_wave[i] = lim(x->lfo_wave[i], 0, FC_NLWAVE - 1u);
            x->lfo_sync[i] = x->lfo_sync[i] ? 1u : 0u;
        }
        for (i = 0; i < FC_NMOD; i++) {
            fc_mod_t *m = &x->mod[i];
            if (m->src >= FC_NMS || m->dst >= FC_NMD)
                m->src = m->dst = 0;
            m->amt = lims(m->amt, -127, 127);
        }
        for (i = 0; i < FC_NMACRO; i++)
            x->macro[i] = lim(x->macro[i], 0, 127);
        x->dly_time = lim(x->dly_time, 0, FC_D_1);
        x->dly_fb = lim(x->dly_fb, 0, 127);
        x->dly_mix = lim(x->dly_mix, 0, 127);
        x->dly_tone = lim(x->dly_tone, 0, 127);
        x->dly_mode = x->dly_mode ? 1u : 0u;
    }
    return 0;
}

void fc_globals_init(fc_globals_t *g)
{
    zero(g, sizeof *g);
    g->magic[0] = 'F';
    g->magic[1] = 'G';
    g->version = 2;
    g->cur_set = FC_FACTORY0;                 /* the first factory set */
    g->velocity = 100;
    g->midi_in_ch = 16;
}

int fc_globals_check(fc_globals_t *g)
{
    if (g->magic[0] != 'F' || g->magic[1] != 'G' || g->version < 1u || g->version > 2u)
        return -1;
    if (g->version == 1u) {                   /* 0.1 / 0.2 numbered factory sets from 64 */
        if (g->cur_set >= 64u)
            g->cur_set = (uint8_t)(FC_FACTORY0 + (g->cur_set - 64u));
        g->version = 2;
    }
    g->midi_ch &= 15u;
    g->output = lim(g->output, 0, 2);
    g->clock = lim(g->clock, 0, 1);
    g->velocity = lim(g->velocity, 1, 127);
    g->midi_in_ch = lim(g->midi_in_ch, 0, 16);
    if (g->voices)
        g->voices = lim(g->voices, 4, 10);
    return 0;
}

uint32_t fc_set_used_keys(const fc_set_t *s)
{
    uint32_t i, m = 0;
    for (i = 0; i < FC_NKEYS; i++)
        if (s->ch[i].quality != FC_EMPTY)
            m |= 1u << i;
    return m;
}
