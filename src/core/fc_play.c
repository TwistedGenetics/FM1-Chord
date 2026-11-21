/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the player (fc_play.h). Copyright (C) 2026 Jamie (TwistedGenetics). */
#include "fc_play.h"

/* the arpeggiator's step in MIDI clock ticks (24 per quarter): 1/4 1/8 1/8T 1/16 1/16T 1/32 */
static const uint8_t FC_RATE_TICKS[FC_NRATE] = {24, 12, 8, 6, 4, 3};

static uint32_t rnd(fc_player_t *p)
{
    p->rng ^= p->rng << 13;
    p->rng ^= p->rng >> 17;
    p->rng ^= p->rng << 5;
    return p->rng;
}

static void note_on(fc_player_t *p, uint32_t n, uint32_t v)
{
    n &= 127u;
    if (p->sounding[n >> 5] & (1u << (n & 31u)))
        p->out.off(p->out.u, n);                    /* retriggered: off first, so on and off stay paired */
    p->sounding[n >> 5] |= 1u << (n & 31u);
    p->out.on(p->out.u, n, v);
}
static void note_off(fc_player_t *p, uint32_t n)
{
    n &= 127u;
    if (p->sounding[n >> 5] & (1u << (n & 31u))) {
        p->sounding[n >> 5] &= ~(1u << (n & 31u));
        p->out.off(p->out.u, n);
    }
}
static void all_off(fc_player_t *p)
{
    uint32_t n;
    for (n = 0; n < 128u; n++)
        note_off(p, n);
    p->st_n = 0;
    p->arp_note = -1;
}

static uint32_t human(fc_player_t *p, const fc_set_t *s, uint32_t v)
{
    int32_t h = s->play.humanise, r, out;
    if (!h)
        return v;
    r = (int32_t)(rnd(p) % (uint32_t)(2 * h + 1)) - h;          /* +- humanise, then scaled to +- 40 */
    out = (int32_t)v + r * 40 / 127;
    return (uint32_t)(out < 1 ? 1 : out > 127 ? 127 : out);
}

void fc_player_init(fc_player_t *p, const fc_out_t *out)
{
    uint8_t *b = (uint8_t *)p;
    uint32_t i;
    for (i = 0; i < sizeof *p; i++)
        b[i] = 0;
    p->out = *out;
    p->key = -1;
    p->prev_bass = -1;
    p->prev_shift = 0;
    p->arp_note = -1;
    p->rng = 0x2545F491u;
}

uint32_t fc_player_preview(const fc_player_t *p, const fc_set_t *s, uint32_t key, uint8_t *notes, uint32_t *has_bass)
{
    const fc_chord_t *c;
    uint32_t n;
    if (key >= FC_NKEYS)
        return 0;
    c = &s->ch[key];
    n = fc_chord_notes(c, (int32_t)s->play.transpose + 12 * (int32_t)s->play.octave, notes);
    *has_bass = n && c->bass < 12u;
    if (n && s->play.voice_lead && p->nprev) {
        /* lead from the last chord as it would sound at today's octave / transpose, so OCT- / OCT+ still move the
         * chords when voice leading is on (it would otherwise pull every chord back next to the last one) */
        int32_t d = (int32_t)s->play.transpose + 12 * (int32_t)s->play.octave - p->prev_shift, b = p->prev_bass;
        uint8_t pv[FC_MAXN];
        uint32_t i;
        for (i = 0; i < p->nprev; i++) {
            int32_t v = (int32_t)p->prev[i] + d;
            pv[i] = (uint8_t)(v < 0 ? 0 : v > 127 ? 127 : v);
        }
        if (b >= 0) {
            b += d;
            b = b < 0 ? 0 : b > 127 ? 127 : b;
        }
        fc_voice_lead(pv, p->nprev, b, notes, n, (int)*has_bass);
    }
    return n;
}

static void arp_build(fc_player_t *p, const fc_set_t *s)
{
    uint32_t o, i, k = 0, oct = s->play.arp_oct ? s->play.arp_oct : 1u;
    for (o = 0; o < oct; o++)
        for (i = 0; i < p->n && k < FC_ARP_MAX; i++) {
            uint32_t v = p->notes[i] + 12u * o;
            if (v <= 127u)
                p->arp[k++] = (uint8_t)v;
        }
    p->arp_n = k;
}

static void chord_start(fc_player_t *p, const fc_set_t *s, uint32_t key, uint32_t vel)
{
    uint32_t i, hb;
    all_off(p);
    p->n = fc_player_preview(p, s, key, p->notes, &hb);
    p->has_bass = hb;
    p->key = p->n ? (int32_t)key : -1;
    p->vel = (uint8_t)vel;
    if (!p->n)
        return;
    p->chord_count++;
    p->nprev = 0;                                   /* remembered for the next chord's voice leading */
    for (i = hb; i < p->n; i++)
        p->prev[p->nprev++] = p->notes[i];
    p->prev_bass = hb ? (int32_t)p->notes[0] : -1;
    p->prev_shift = (int32_t)s->play.transpose + 12 * (int32_t)s->play.octave;
    if (s->play.mode == FC_M_ARP) {
        arp_build(p, s);
        p->arp_i = 0;
        p->arp_up = 1;
        p->arp_phase = 0;
        p->arp_ticks = 0;
        p->arp_note = -1;
        if (p->arp_n) {                             /* the first step now */
            uint32_t v = s->play.arp_dir == 1u ? p->arp[p->arp_n - 1u] : p->arp[0];
            if (s->play.arp_dir == 3u)
                v = p->arp[rnd(p) % p->arp_n];
            if (s->play.arp_dir == 1u)
                p->arp_i = p->arp_n - 1u;
            note_on(p, v, human(p, s, vel));
            p->arp_note = (int32_t)v;
        }
        return;
    }
    if (s->play.mode == FC_M_STRUM && s->play.strum) {
        uint32_t down = s->play.strum_dir == 1u || (s->play.strum_dir == 2u && (p->st_alt & 1u));
        uint32_t gap = (uint32_t)s->play.strum * 2u * FC_FS / 1000u;
        p->st_alt++;
        p->st_n = 0;
        for (i = 0; i < p->n; i++) {
            uint32_t j = down ? p->n - 1u - i : i;
            p->st_note[p->st_n] = p->notes[j];
            p->st_vel[p->st_n] = (uint8_t)human(p, s, vel);
            p->st_at[p->st_n] = p->now + i * gap;
            p->st_n++;
        }
        fc_player_run(p, s, 0, 1);                  /* the first note now */
        return;
    }
    for (i = 0; i < p->n; i++)
        note_on(p, p->notes[i], human(p, s, vel));
}

void fc_player_release(fc_player_t *p)
{
    all_off(p);
    p->key = -1;
}

void fc_player_stop(fc_player_t *p)
{
    fc_player_release(p);
    p->held = 0;
}

void fc_player_key(fc_player_t *p, const fc_set_t *s, uint32_t key, uint32_t vel)
{
    if (key >= FC_NKEYS)
        return;
    if (vel) {
        p->held |= 1u << key;
        if (s->play.latch && p->key == (int32_t)key) {   /* latched: the same key again stops it */
            fc_player_release(p);
            return;
        }
        chord_start(p, s, key, vel);
        return;
    }
    p->held &= ~(1u << key);
    if (p->key == (int32_t)key && !s->play.latch)
        fc_player_release(p);
}

static void arp_step(fc_player_t *p, const fc_set_t *s)
{
    uint32_t v;
    if (p->arp_note >= 0)
        note_off(p, (uint32_t)p->arp_note);
    p->arp_note = -1;
    if (!p->arp_n || p->key < 0)
        return;
    switch (s->play.arp_dir) {
    case 1:                                         /* down */
        p->arp_i = p->arp_i ? p->arp_i - 1u : p->arp_n - 1u;
        break;
    case 2:                                         /* up-down, the ends once */
        if (p->arp_n < 2u)
            p->arp_i = 0;
        else if (p->arp_up) {
            if (++p->arp_i >= p->arp_n - 1u) {
                p->arp_i = p->arp_n - 1u;
                p->arp_up = 0;
            }
        } else if (p->arp_i == 0 || --p->arp_i == 0)
            p->arp_up = 1;
        break;
    case 3:                                         /* random */
        p->arp_i = rnd(p) % p->arp_n;
        break;
    default:                                        /* up */
        p->arp_i = (p->arp_i + 1u) % p->arp_n;
        break;
    }
    v = p->arp[p->arp_i];
    note_on(p, v, human(p, s, p->vel));
    p->arp_note = (int32_t)v;
}

static uint32_t step_samples(const fc_set_t *s)
{
    uint32_t bpm = s->tempo < 40u ? 40u : s->tempo;
    return FC_FS * 60u / bpm * FC_RATE_TICKS[s->play.arp_rate % FC_NRATE] / 24u;
}

void fc_player_run(fc_player_t *p, const fc_set_t *s, uint32_t frames, int ext_clock)
{
    uint32_t i, k;
    /* strum: start every note that is due by the end of this block */
    for (i = 0; i < p->st_n;) {
        if ((int32_t)(p->st_at[i] - (p->now + frames)) <= 0) {
            note_on(p, p->st_note[i], p->st_vel[i]);
            for (k = i + 1u; k < p->st_n; k++) {
                p->st_note[k - 1u] = p->st_note[k];
                p->st_vel[k - 1u] = p->st_vel[k];
                p->st_at[k - 1u] = p->st_at[k];
            }
            p->st_n--;
        } else
            i++;
    }
    if (s->play.mode == FC_M_ARP && p->key >= 0 && p->arp_n) {
        uint32_t len = step_samples(s), gate = len * s->play.arp_gate / 100u;
        if (p->arp_note >= 0 && p->arp_phase < gate && p->arp_phase + frames >= gate && s->play.arp_gate < 100u) {
            note_off(p, (uint32_t)p->arp_note);
            p->arp_note = -1;
        }
        p->arp_phase += frames;
        if (!ext_clock && p->arp_phase >= len) {
            p->arp_phase -= len;
            if (p->arp_phase >= len)
                p->arp_phase = 0;
            arp_step(p, s);
        }
    }
    p->now += frames;
}

void fc_player_clock(fc_player_t *p, const fc_set_t *s)
{
    if (s->play.mode != FC_M_ARP || p->key < 0 || !p->arp_n)
        return;
    if (++p->arp_ticks >= FC_RATE_TICKS[s->play.arp_rate % FC_NRATE]) {
        p->arp_ticks = 0;
        p->arp_phase = 0;
        arp_step(p, s);
    }
}
