/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the chord synth (fc_synth.h). The filter is the trapezoidal state-variable filter (Andrew Simper's
 * "linear trapezoidal" SVF); the oscillators are polyBLEP; the chorus is two modulated taps on one delay, as a
 * Juno's; the reverb is Freeverb's structure (Jezar, public domain) at a smaller size. Written for this project.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#include "fc_synth.h"
#include "fc_math.h"
#include "fc_wavetables.h"

#define FSF 44100.f
/* a tiny constant kept in the feedback paths: decaying tails never reach denormals (slow on PCs, and unknown on
 * the FM-1); far below the 16-bit output */
#define FC_ANTI_DENORMAL 1e-20f

static float t_sec(uint32_t v) { return 0.001f * fc_exp2f((float)v * (13.f / 127.f)); }   /* 1 ms .. 8.2 s */
static void env_coefs(fc_env_c *e, uint32_t a, uint32_t d, uint32_t s, uint32_t r)
{
    e->a = 1.f / (t_sec(a) * FSF);
    e->d = fc_exp2f(-9.966f / (t_sec(d) * FSF));      /* -60 dB in the time */
    e->s = (float)s * (1.f / 127.f);
    e->r = fc_exp2f(-9.966f / (t_sec(r) * FSF));
}

/* what a full (127) matrix amount does to each destination; pitch goes by the square of the amount, so small
 * amounts are fine vibrato and a full one is two octaves */
static float mod_scale(uint32_t dst, int32_t amt)
{
    float a = (float)amt * (1.f / 127.f);
    switch (dst) {
    case FC_MD_PITCH:
    case FC_MD_BPITCH: return 24.f * a * (a < 0.f ? -a : a);  /* semitones */
    case FC_MD_CUT:
    case FC_MD_FENV: return 6.f * a;                          /* octaves */
    case FC_MD_FM: return 0.5f * a;
    case FC_MD_PW: return 0.45f * a;
    case FC_MD_DETUNE: return 50.f * a;                       /* cents */
    case FC_MD_L1RATE: return 3.f * a;                        /* octaves */
    default: return a;                                        /* 0..1 values: resonance, levels, drive, mixes */
    }
}

static void delay_len(fc_synth_t *s)
{
    float n = FC_DIV_BEATS[s->sx.dly_time % FC_NDIV] * 60.f / s->tempo * FSF;
    while (n > (float)(FC_DLY_LEN - 1u))
        n *= 0.5f;                                  /* too long for the memory: half as long, still on the beat */
    s->dl_len = n < 1.f ? 1u : (uint32_t)n;
}

static void lfo_rates(fc_synth_t *s)
{
    uint32_t i;
    for (i = 0; i < 2u; i++) {
        uint32_t r = s->sx.lfo_rate[i];
        if (s->sx.lfo_sync[i])                      /* rate 0 = 8 bars .. 127 = 1/32 */
            s->lfo_hz[i] = s->tempo * (1.f / 60.f) / FC_DIV_BEATS[(FC_NDIV - 1u) - (r * FC_NDIV >> 7)];
        else
            s->lfo_hz[i] = 0.03f * fc_exp2f((float)r * (10.f / 127.f));   /* 0.03 .. 30 Hz */
    }
}

/* Juno-ish chorus modes: I, II (faster), I+II (fast and shallow) */
static const float CH_RATE[FC_NCMODE] = {0.5f, 0.83f, 8.f}, CH_DEPTH[FC_NCMODE] = {88.f, 88.f, 18.f};

void fc_synth_sound(fc_synth_t *s, const fc_sound_t *o, const fc_sound2_t *x, const fc_sound3_t *t)
{
    float lv;
    uint32_t i;
    s->snd = *o;
    s->sx = *x;
    s->s3 = *t;
    s->wt_pos = (float)t->wt_pos * (1.f / 127.f);
    s->spread = (float)t->spread * (1.f / 127.f);
    s->omode = t->osc_mode % FC_NOMODE;
    s->b_ratio = fc_exp2f((float)t->b_semi * (1.f / 12.f));
    s->wob_depth = (float)t->wobble * (1.f / 127.f);
    s->cr_step = t->crush_rate ? fc_exp2f(-(float)t->crush_rate * (5.f / 127.f)) : 1.f;
    s->cr_q = t->crush_bits ? fc_exp2f(15.f - (float)t->crush_bits * (13.f / 127.f)) : 0.f;   /* 2^(bits-1) */
    s->ph_mix = (float)(t->fx & 0x3Fu) * (1.f / 63.f);
    s->ch_rate = CH_RATE[(t->fx >> 6) % FC_NCMODE];
    s->ch_depth = CH_DEPTH[(t->fx >> 6) % FC_NCMODE];
    env_coefs(&s->amp, o->amp_a, o->amp_d, o->amp_s, o->amp_r);
    env_coefs(&s->flt, o->flt_a, o->flt_d, o->flt_s, o->flt_r);
    env_coefs(&s->menv, x->menv_a, x->menv_d, x->menv_s, x->menv_r);
    lv = (float)o->level * (1.f / 127.f);
    s->level = lv * lv;
    s->cut_st = 4.3219f + (float)o->cutoff * (9.8f / 127.f);         /* log2(Hz): 20 Hz .. 17.8 kHz */
    s->fenv_st = (float)o->fenv * (6.f / 127.f);                     /* up to six octaves */
    s->track = (float)o->ftrack * (1.f / 127.f);
    s->res = (float)o->res * (1.f / 127.f);
    s->detune_c = (float)o->detune * (50.f / 127.f);
    s->bl = (float)o->b_level * (1.f / 127.f);
    s->sub = (float)o->sub * (1.f / 127.f);
    s->fm = (float)o->fm * (0.5f / 127.f);
    s->vs = (float)o->vel_sens * (1.f / 127.f);
    s->drive = (float)x->drive * (1.f / 127.f);
    s->wa = o->wave_a % FC_NW;
    s->wb = o->wave_b % FC_NW;
    s->ch_mix = (float)o->chorus * (1.f / 127.f);
    s->rv_mix = (float)o->rev_mix * (1.f / 127.f);
    s->rv_fb = 0.70f + 0.28f * (float)o->rev_size * (1.f / 127.f);
    s->nmv = s->nmg = s->use_menv = 0;
    for (i = 0; i < FC_NMOD; i++) {
        const fc_mod_t *m = &x->mod[i];
        if (!m->src || !m->dst || !m->amt || m->src >= FC_NMS || m->dst >= FC_NMD)
            continue;
        if (FC_MD_GLOBAL(m->dst)) {                 /* the whole synth: only the LFOs and macros move it */
            if (m->src == FC_MS_MENV || m->src == FC_MS_VEL || m->src == FC_MS_KEY)
                continue;
            s->mg_src[s->nmg] = m->src;
            s->mg_dst[s->nmg] = m->dst;
            s->mg_amt[s->nmg++] = mod_scale(m->dst, m->amt);
        } else {
            s->mv_src[s->nmv] = m->src;
            s->mv_dst[s->nmv] = m->dst;
            s->mv_amt[s->nmv++] = mod_scale(m->dst, m->amt);
            s->use_menv |= m->src == FC_MS_MENV;
        }
    }
    for (i = 0; i < FC_NMACRO; i++)
        s->macro[i] = (float)x->macro[i] * (1.f / 127.f);
    s->dl_fb = 0.95f * (float)x->dly_fb * (1.f / 127.f);
    s->dl_mix = (float)x->dly_mix * (1.f / 127.f);
    s->dl_c = 1.f - fc_exp2f(-6.2832f * (500.f * fc_exp2f((float)x->dly_tone * (5.f / 127.f))) / FSF * 1.4427f);
    delay_len(s);
    lfo_rates(s);
}

void fc_synth_voices(fc_synth_t *s, uint32_t n)
{
    s->maxv = n < 1u ? 1u : n > FC_VOICES ? FC_VOICES : n;
}

void fc_synth_tempo(fc_synth_t *s, float bpm)
{
    s->tempo = fc_clampf(bpm, 20.f, 300.f);
    delay_len(s);
    lfo_rates(s);
}

void fc_synth_init(fc_synth_t *s, float *mem, int16_t *dly)
{
    static const uint16_t CL[FC_RV_NC] = {1116, 1188, 1277, 1356}, AL[FC_RV_NA] = {556, 441};
    uint8_t *b = (uint8_t *)s;
    uint32_t i, c, k, used = 0;
    fc_sound_t d;
    fc_sound2_t dx;
    fc_sound3_t d3;
    for (i = 0; i < sizeof *s; i++)
        b[i] = 0;
    for (c = 0; c < 2u; c++) {
        for (k = 0; k < FC_RV_NC; k++) {
            s->rv_c[c][k] = mem + used;
            s->rv_cl[c][k] = CL[k] + 23u * c;
            used += s->rv_cl[c][k];
        }
        for (k = 0; k < FC_RV_NA; k++) {
            s->rv_a[c][k] = mem + used;
            s->rv_al[c][k] = AL[k] + 23u * c;
            used += s->rv_al[c][k];
        }
    }
    for (i = 0; i < used && i < FC_RV_FLOATS; i++)
        mem[i] = 0.f;
    s->dl[0] = dly;
    s->dl[1] = dly + FC_DLY_LEN;
    for (i = 0; i < 2u * FC_DLY_LEN; i++)
        dly[i] = 0;
    s->rv_damp = 0.25f;
    s->rng = 0x9E3779B9u;
    s->tempo = 120.f;
    fc_sound_default(&d);
    fc_sound2_default(&dx);
    fc_sound3_default(&d3);
    s->wob = 1.f;
    s->maxv = FC_VOICES;
    s->gmax = FC_VOICES;
    fc_synth_sound(s, &d, &dx, &d3);
}

static float note_hz(uint32_t n) { return 440.f * fc_exp2f(((float)n - 69.f) * (1.f / 12.f)); }

void fc_synth_on(fc_synth_t *s, uint32_t note, uint32_t vel)
{
    fc_voice_t *v = 0, *old = 0, *rel = 0;
    uint32_t i;
    float hz;
    for (i = 0; i < FC_VOICES; i++) {               /* the same note again: that voice */
        fc_voice_t *x = &s->v[i];
        if (x->stage_a && x->note == note) {
            v = x;
            break;
        }
    }
    if (!v) {
        uint32_t cap = s->maxv < s->gmax ? s->maxv : s->gmax, n = 0;
        fc_voice_t *fr = 0;
        for (i = 0; i < FC_VOICES; i++) {
            fc_voice_t *x = &s->v[i];
            if (!x->stage_a) {
                if (!fr)
                    fr = x;
                continue;
            }
            if (x->shed)
                continue;
            n++;
            if (x->stage_a == 3u && (!rel || x->age < rel->age))
                rel = x;
            if (!old || x->age < old->age)
                old = x;
        }
        if (fr && n < cap)
            v = fr;
        else if (!rel && !old)                      /* every voice fading: take one */
            v = fr ? fr : &s->v[0];
    }
    if (!v) {
        v = rel ? rel : old;
        v->ea = 0.f;                                /* stolen */
        v->ef = v->em = 0.f;
        v->ic1 = v->ic2 = v->ic3 = v->ic4 = 0.f;
    }
    if (!v->stage_a) {
        v->ea = v->ef = v->em = 0.f;
        v->ic1 = v->ic2 = v->ic3 = v->ic4 = 0.f;
        v->pa = 0.f;
        v->pb = 0.37f;                              /* B starts elsewhere: the detuned pair beats from the start */
        v->ps = 0.f;
        {
            static const float P0[6] = {0.11f, 0.53f, 0.29f, 0.71f, 0.89f, 0.43f};
            uint32_t k;
            for (k = 0; k < 6u; k++) {
                v->ssa[k] = P0[k];
                v->ssb[k] = P0[5u - k];
            }
        }
    }
    v->note = (uint8_t)note;
    v->shed = 0;
    v->on = 1;
    v->stage_a = 1;
    v->stage_f = 1;
    v->stage_m = 1;
    v->age = ++s->age;
    hz = note_hz(note);
    v->inc_a = hz * (1.f / FSF);
    v->inc_b = v->inc_a * s->b_ratio * fc_exp2f(s->detune_c * (1.f / 1200.f));
    v->velr = (float)vel * (1.f / 127.f);
    v->vel = 1.f - s->vs + s->vs * v->velr;
    v->key = (float)note - 60.f;
}

void fc_synth_off(fc_synth_t *s, uint32_t note)
{
    uint32_t i;
    for (i = 0; i < FC_VOICES; i++) {
        fc_voice_t *v = &s->v[i];
        if (v->stage_a && v->on && v->note == note) {
            v->on = 0;
            v->stage_a = 3;
            v->stage_f = 3;
            v->stage_m = 3;
        }
    }
}

void fc_synth_all_off(fc_synth_t *s)
{
    uint32_t i;
    for (i = 0; i < FC_VOICES; i++)
        if (s->v[i].stage_a) {
            s->v[i].on = 0;
            s->v[i].stage_a = 3;
            s->v[i].stage_f = 3;
            s->v[i].stage_m = 3;
        }
}

static uint32_t sounding(const fc_synth_t *s)    /* voices playing that the guard hasn't taken */
{
    uint32_t i, n = 0;
    for (i = 0; i < FC_VOICES; i++)
        n += s->v[i].stage_a && !s->v[i].shed;
    return n;
}

uint32_t fc_synth_guard(fc_synth_t *s, uint32_t pct)
{
    uint32_t i, n, lim = s->maxv < s->gmax ? s->maxv : s->gmax;
    if (pct >= 85u) {
        s->gcool = 0;
        n = sounding(s);
        if (n > 3u && n - 1u < lim)
            lim = n - 1u;
        else if (lim > 3u)
            lim--;
        s->gmax = lim;
        for (; n > lim; n--) {                      /* fade out the rest: released ones first, then the oldest */
            fc_voice_t *w = 0;
            for (i = 0; i < FC_VOICES; i++) {
                fc_voice_t *x = &s->v[i];
                if (!x->stage_a || x->shed)
                    continue;
                if (!w || (x->stage_a == 3u) > (w->stage_a == 3u) ||
                    ((x->stage_a == 3u) == (w->stage_a == 3u) && x->age < w->age))
                    w = x;
            }
            if (!w)
                break;
            w->shed = 1;
            w->on = 0;
            w->stage_a = w->stage_f = w->stage_m = 3;
        }
    } else if (pct < 60u) {
        if (++s->gcool >= 86u && s->gmax < FC_VOICES) {   /* 86 FM-1 blocks of 512 samples: a second */
            s->gmax++;
            s->gcool = 0;
        }
    } else
        s->gcool = 0;
    return s->maxv < s->gmax ? s->maxv : s->gmax;
}

uint32_t fc_synth_active(const fc_synth_t *s)
{
    uint32_t i, n = 0;
    for (i = 0; i < FC_VOICES; i++)
        n += s->v[i].stage_a != 0;
    return n;
}

static inline float blep(float t, float dt)
{
    if (t < dt) {
        t /= dt;
        return t + t - t * t - 1.f;
    }
    if (t > 1.f - dt) {
        t = (t - 1.f) / dt;
        return t * t + t + t + 1.f;
    }
    return 0.f;
}
static inline float wrap1(float p) { return p >= 1.f ? p - 1.f : p < 0.f ? p + 1.f : p; }

/* pw: the pulse width's move from its own (square 50 %, pulse 25 %), -0.45 .. 0.45 */
static inline float osc(uint32_t w, float p, float dt, float pw)
{
    float y, q, h;
    switch (w) {
    case FC_W_SQUARE:
    case FC_W_PULSE:
        h = (w == FC_W_SQUARE ? 0.5f : 0.25f) + pw;
        h = fc_clampf(h, 0.04f, 0.96f);
        y = p < h ? 1.f : -1.f;
        q = wrap1(p + 1.f - h);
        return y + blep(p, dt) - blep(q, dt) + (2.f * h - 1.f) * -1.f;   /* centred */
    case FC_W_TRI:
        y = 4.f * p;
        return p < 0.5f ? y - 1.f : 3.f - y;
    case FC_W_SINE:
        return fc_sin_turn(p);
    case FC_W_ORGAN: {                              /* drawbars 8' 4' 2 2/3' */
        float p2 = p * 2.f, p3 = p * 3.f;
        p2 -= (float)(int32_t)p2;
        p3 -= (float)(int32_t)p3;
        return (fc_sin_turn(p) + 0.6f * fc_sin_turn(p2) + 0.45f * fc_sin_turn(p3)) * 0.55f;
    }
    default:                                        /* saw */
        return 2.f * p - 1.f - blep(p, dt);
    }
}

static inline float env_step(uint8_t *st, float e, const fc_env_c *c)
{
    switch (*st) {
    case 1:
        e += c->a;
        if (e >= 1.f) {
            e = 1.f;
            *st = 2;
        }
        return e;
    case 2:
        e = c->s + (e - c->s) * c->d;
        return (e - c->s < 1e-6f && c->s - e < 1e-6f) ? c->s : e;   /* settled: exactly the sustain (no denormals) */
    case 3:
        e *= c->r;
        if (e < 1e-4f) {
            e = 0.f;
            *st = 0;
        }
        return e;
    default:
        return 0.f;
    }
}

/* the supersaw: the saw at the note and six around it (the JP-8000's spacing), spread 0..1 */
static const float SS_OFF[6] = {-0.11002313f, -0.06288439f, -0.01952356f, 0.01991221f, 0.06216538f, 0.10745242f};
static inline float supersaw(float *ph, float p, float dt, float d)
{
    uint32_t k;
    float y = 0.6f * (2.f * p - 1.f - blep(p, dt)), sides = 0.f;
    for (k = 0; k < 6u; k++) {
        float q = ph[k] + dt * (1.f + SS_OFF[k] * d);
        q = q >= 1.f ? q - 1.f : q;
        ph[k] = q;
        sides += 2.f * q - 1.f;
    }
    return (y + (0.15f + 0.25f * d) * sides) * 0.55f;
}
/* a wavetable at a position 0..1 through its frames, the phase p */
static inline float wavetable(uint32_t t, float pos, float p)
{
    float f = pos * (float)(FC_WT_FRAMES - 1u), x = p * (float)FC_WT_N, u, w, a, b;
    uint32_t i = (uint32_t)f, j = (uint32_t)x, j1;
    const int16_t *f0, *f1;
    if (i >= FC_WT_FRAMES - 1u)
        i = FC_WT_FRAMES - 2u;
    u = f - (float)i;
    w = x - (float)j;
    j &= FC_WT_N - 1u;
    j1 = (j + 1u) & (FC_WT_N - 1u);
    f0 = FC_WT[t][i];
    f1 = FC_WT[t][i + 1u];
    a = (float)f0[j] + ((float)f0[j1] - (float)f0[j]) * w;
    b = (float)f1[j] + ((float)f1[j1] - (float)f1[j]) * w;
    return (a + (b - a) * u) * (1.f / 32767.f);
}
static inline float noise(fc_synth_t *s)
{
    s->rng = s->rng * 1664525u + 1013904223u;
    return (float)(int32_t)s->rng * (1.f / 2147483648.f);
}
/* any oscillator: the plain waves by osc(), the 0.7 ones here */
static inline float osc_any(fc_synth_t *s, uint32_t w, float p, float dt, float pw, float *ss, float spread, float pos)
{
    if (w == FC_W_SUPERSAW)
        return supersaw(ss, p, dt, spread);
    if (w == FC_W_NOISE)
        return noise(s);
    if (w >= FC_W_WT0)
        return wavetable(w - FC_W_WT0, pos, p);
    return osc(w, p, dt, pw);
}

static float mod_src(const fc_synth_t *s, const fc_voice_t *v, uint32_t src, uint32_t blk)
{
    switch (src) {
    case FC_MS_LFO1: return s->lfo_blk[0][blk];
    case FC_MS_LFO2: return s->lfo_blk[1][blk];
    case FC_MS_MENV: return v ? v->em : 0.f;
    case FC_MS_VEL: return v ? v->velr : 0.f;
    case FC_MS_KEY: return v ? v->key * (1.f / 60.f) : 0.f;
    case FC_MS_M1:
    case FC_MS_M2:
    case FC_MS_M3:
    case FC_MS_M4: return s->macro[src - FC_MS_M1];
    default: return 0.f;
    }
}

/* the filter's output for its mode from the SVF's three outputs (x in, v1 band, v2 low) */
static inline float svf_out(uint32_t mode, float x, float v1, float v2, float k)
{
    switch (mode) {
    case FC_F_BP: return v1;
    case FC_F_HP: return x - k * v1 - v2;
    case FC_F_NOTCH: return x - k * v1;
    default: return v2;
    }
}

static void voice_render(fc_synth_t *s, fc_voice_t *v, float *mono, uint32_t n)
{
    uint32_t i, j, q, mode = s->sx.flt_mode, slope = s->sx.flt_slope;
    for (i = 0; i < n; i += FC_CTRL) {
        uint32_t m = n - i < FC_CTRL ? n - i : FC_CTRL, blk = i / FC_CTRL;
        float md[FC_NMD];
        float lc, f, g, k, a1, a2, a3, b1 = 0.f, b2 = 0.f, b3 = 0.f, ia = v->inc_a, ib = v->inc_b;
        float bl = s->bl, sub = s->sub, fm = s->fm, pw = 0.f, drv = s->drive, dg, dc, gain;
        float pos = s->wt_pos, spr = s->spread, ga, gb;
        for (q = 0; q < FC_NMD; q++)
            md[q] = 0.f;
        for (q = 0; q < s->nmv; q++)
            md[s->mv_dst[q]] += s->mv_amt[q] * mod_src(s, v, s->mv_src[q], blk);
        if (s->nmv || s->wob != 1.f) {
            if (md[FC_MD_PITCH] != 0.f || md[FC_MD_DETUNE] != 0.f || md[FC_MD_BPITCH] != 0.f || s->wob != 1.f) {
                ia = v->inc_a * fc_exp2f(md[FC_MD_PITCH] * (1.f / 12.f)) * s->wob;
                ib = ia * s->b_ratio * fc_exp2f((s->detune_c + md[FC_MD_DETUNE]) * (1.f / 1200.f) +
                                                md[FC_MD_BPITCH] * (1.f / 12.f));
            }
            pos = fc_clampf(pos + md[FC_MD_WTPOS], 0.f, 1.f);
            spr = fc_clampf(spr + md[FC_MD_SPREAD], 0.f, 1.f);
            bl = fc_clampf(bl + md[FC_MD_BLEV], 0.f, 1.f);
            sub = fc_clampf(sub + md[FC_MD_SUB], 0.f, 1.f);
            fm = fc_clampf(fm + md[FC_MD_FM], 0.f, 0.5f);
            pw = md[FC_MD_PW];
            drv = fc_clampf(drv + md[FC_MD_DRIVE], 0.f, 1.f);
        }
        gain = 0.16f * v->vel * fc_clampf(1.f + md[FC_MD_AMP], 0.f, 2.f);
        lc = s->cut_st + (s->fenv_st + md[FC_MD_FENV]) * v->ef + s->track * v->key * (1.f / 12.f) + md[FC_MD_CUT];
        f = fc_exp2f(lc);
        if (f > 0.45f * FSF)
            f = 0.45f * FSF;
        g = fc_tanf(3.14159265f * f * (1.f / FSF));
        k = 2.f - 1.94f * fc_clampf(s->res + md[FC_MD_RES], 0.f, 1.f);
        a1 = 1.f / (1.f + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
        if (slope) {                                /* the second stage: no resonance of its own */
            b1 = 1.f / (1.f + g * (g + 1.41421356f));
            b2 = g * b1;
            b3 = g * b2;
        }
        dg = 0.5f + 3.5f * drv;                     /* drive: x/2 .. 4x into a soft curve */
        dc = 2.f / (1.f + drv);
        ga = s->omode == FC_O_ADD ? 1.f : 1.f - bl; /* sync and ring: B level fades from A to the effect */
        gb = s->omode == FC_O_RING ? 1.4f * bl : bl;
        for (j = 0; j < m; j++) {
            float x, pa, v1, v2, v3, y;
            pa = v->pa;
            if (fm > 0.f)
                pa = wrap1(pa + fm * fc_sin_turn(v->pb));
            x = osc_any(s, s->wa, pa, ia, pw, v->ssa, spr, pos);
            if (bl > 0.f) {
                float y2 = osc_any(s, s->wb, v->pb, ib, pw, v->ssb, spr, pos);
                x = ga * x + gb * (s->omode == FC_O_RING ? x * y2 : y2);
            }
            if (sub > 0.f)
                x += sub * osc(FC_W_SQUARE, v->ps, ia * 0.5f, 0.f);
            v->pa += ia;
            if (v->pa >= 1.f) {
                v->pa -= 1.f;
                if (s->omode == FC_O_SYNC)          /* B starts again with A */
                    v->pb = v->pa * (ib / ia);
            }
            v->pb = wrap1(v->pb + ib);
            v->ps = wrap1(v->ps + ia * 0.5f);
            if (drv > 0.f) {
                float u = x * dg;
                x = dc * u / (1.f + (u < 0.f ? -u : u));
            }
            v3 = x - v->ic2;
            v1 = a1 * v->ic1 + a2 * v3;
            v2 = v->ic2 + a2 * v->ic1 + a3 * v3;
            v->ic1 = 2.f * v1 - v->ic1 + FC_ANTI_DENORMAL;   /* on a square's flat top the band dies away: */
            v->ic2 = 2.f * v2 - v->ic2;                     /* never into denormals (slow on the FM-1's CPU) */
            y = svf_out(mode, x, v1, v2, k);
            if (slope) {
                float w1, w2, w3;
                w3 = y - v->ic4;
                w1 = b1 * v->ic3 + b2 * w3;
                w2 = v->ic4 + b2 * v->ic3 + b3 * w3;
                v->ic3 = 2.f * w1 - v->ic3 + FC_ANTI_DENORMAL;
                v->ic4 = 2.f * w2 - v->ic4;
                y = svf_out(mode, y, mode == FC_F_BP ? 1.41421356f * w1 : w1, w2, 1.41421356f);
            }
            v->ea = env_step(&v->stage_a, v->ea, &s->amp);
            if (v->shed && (v->ea *= 0.995f) < 1e-4f) {    /* the guard's fast fade: about 20 ms */
                v->ea = 0.f;
                v->stage_a = 0;
            }
            v->ef = env_step(&v->stage_f, v->ef, &s->flt);
            if (s->use_menv)
                v->em = env_step(&v->stage_m, v->em, &s->menv);
            mono[i + j] += y * v->ea * gain;
        }
        if (!v->stage_a)
            break;
    }
    if (!v->stage_a) {
        v->ic1 = v->ic2 = v->ic3 = v->ic4 = 0.f;
        v->stage_f = 0;
        v->stage_m = 0;
        v->em = 0.f;
    }
}

static float lfo_val(fc_synth_t *s, uint32_t i)
{
    float p = s->lfo_ph[i];
    switch (s->sx.lfo_wave[i]) {
    case FC_L_TRI: return p < 0.5f ? 4.f * p - 1.f : 3.f - 4.f * p;
    case FC_L_SAW: return 1.f - 2.f * p;
    case FC_L_SQUARE: return p < 0.5f ? 1.f : -1.f;
    case FC_L_SH: return s->lfo_sh[i];
    default: return fc_sin_turn(p);
    }
}

void fc_synth_render(fc_synth_t *s, float *lr, uint32_t n)
{
    float *mono = s->mono;
    uint32_t i, k, c, done, q;
    for (done = 0; done < n; done += k) {
        float g[FC_NMD], ch_mix, rv_mix, dl_mix, l1;
        k = n - done > FC_BLOCK ? FC_BLOCK : n - done;
        /* the LFOs, once every 16 samples; then what they (and the macros) do to the whole synth */
        for (q = 0; q < FC_NMD; q++)
            g[q] = 0.f;
        for (q = 0; q < s->nmg; q++)
            g[s->mg_dst[q]] += s->mg_amt[q] * mod_src(s, 0, s->mg_src[q], 0);
        l1 = g[FC_MD_L1RATE] != 0.f ? fc_exp2f(g[FC_MD_L1RATE]) : 1.f;
        for (i = 0; i < k; i += FC_CTRL) {
            uint32_t m = k - i < FC_CTRL ? k - i : FC_CTRL;
            for (c = 0; c < 2u; c++) {
                s->lfo_blk[c][i / FC_CTRL] = lfo_val(s, c);
                s->lfo_ph[c] += s->lfo_hz[c] * (c ? 1.f : l1) * (float)m * (1.f / FSF);
                if (s->lfo_ph[c] >= 1.f) {
                    s->lfo_ph[c] -= (float)(int32_t)s->lfo_ph[c];
                    s->rng = s->rng * 1664525u + 1013904223u;
                    s->lfo_sh[c] = (float)(s->rng >> 8) * (2.f / 16777216.f) - 1.f;
                }
            }
        }
        if (s->wob_depth > 0.f) {                   /* tape: a slow wow and a quicker flutter, on the pitch */
            float st;
            s->wob_ph[0] += 0.55f * (float)k * (1.f / FSF);
            s->wob_ph[1] += 6.3f * (float)k * (1.f / FSF);
            for (c = 0; c < 2u; c++)
                if (s->wob_ph[c] >= 1.f)
                    s->wob_ph[c] -= 1.f;
            st = s->wob_depth * (0.25f * fc_sin_turn(s->wob_ph[0]) + 0.04f * fc_sin_turn(s->wob_ph[1]));
            s->wob = fc_exp2f(st * (1.f / 12.f));
        } else
            s->wob = 1.f;
        ch_mix = fc_clampf(s->ch_mix + g[FC_MD_CHORUS], 0.f, 1.f);
        rv_mix = fc_clampf(s->rv_mix + g[FC_MD_REVMIX], 0.f, 1.f);
        dl_mix = fc_clampf(s->dl_mix + g[FC_MD_DLYMIX], 0.f, 1.f);
        for (i = 0; i < k; i++)
            mono[i] = 0.f;
        for (i = 0; i < FC_VOICES; i++)
            if (s->v[i].stage_a)
                voice_render(s, &s->v[i], mono, k);
        if (s->cr_q > 0.f || s->cr_step < 1.f)      /* the crusher: fewer samples, fewer bits */
            for (i = 0; i < k; i++) {
                float x = mono[i];
                if (s->cr_step < 1.f) {
                    s->cr_ph += s->cr_step;
                    if (s->cr_ph >= 1.f) {
                        s->cr_ph -= 1.f;
                        s->cr_hold = x;
                    }
                    x = s->cr_hold;
                }
                if (s->cr_q > 0.f) {
                    float y = x * s->cr_q;
                    x = (float)(int32_t)(y + (y < 0.f ? -0.5f : 0.5f)) / s->cr_q;
                }
                mono[i] = x;
            }
        if (s->ph_mix > 0.f) {                       /* the phaser's all-passes sweep 300 Hz .. 3 kHz at 0.3 Hz */
            s->ph_ph += 0.3f * (float)k * (1.f / FSF);
            if (s->ph_ph >= 1.f)
                s->ph_ph -= 1.f;
            for (c = 0; c < 2u; c++) {               /* the right side a quarter turn on */
                float p = s->ph_ph + 0.25f * (float)c, tri, tn;
                p = p >= 1.f ? p - 1.f : p;
                tri = p < 0.5f ? 2.f * p : 2.f - 2.f * p;
                tn = fc_tanf(3.14159265f * 300.f * fc_exp2f(3.32f * tri) * (1.f / FSF));
                s->ph_a[c] = (tn - 1.f) / (tn + 1.f);
            }
        }
        for (i = 0; i < k; i++) {
            float x = mono[i], l = x, r = x, in, out[2];
            /* chorus: two taps 1.5 .. 5.5 ms, a 0.5 Hz triangle, opposite on each side */
            s->ch_buf[s->ch_w & (FC_CH_LEN - 1u)] = x;
            if (ch_mix > 0.f) {
                float tri = s->ch_ph < 0.5f ? 4.f * s->ch_ph - 1.f : 3.f - 4.f * s->ch_ph;
                float d1 = 154.f + s->ch_depth * tri, d2 = 154.f - s->ch_depth * tri, t1, t2, w1, w2;
                uint32_t i1 = (uint32_t)d1, i2 = (uint32_t)d2;
                t1 = d1 - (float)i1;
                t2 = d2 - (float)i2;
                w1 = s->ch_buf[(s->ch_w - i1) & (FC_CH_LEN - 1u)] * (1.f - t1) +
                     s->ch_buf[(s->ch_w - i1 - 1u) & (FC_CH_LEN - 1u)] * t1;
                w2 = s->ch_buf[(s->ch_w - i2) & (FC_CH_LEN - 1u)] * (1.f - t2) +
                     s->ch_buf[(s->ch_w - i2 - 1u) & (FC_CH_LEN - 1u)] * t2;
                l = x * (1.f - 0.4f * ch_mix) + w1 * ch_mix;
                r = x * (1.f - 0.4f * ch_mix) + w2 * ch_mix;
                s->ch_ph += s->ch_rate / FSF;
                if (s->ch_ph >= 1.f)
                    s->ch_ph -= 1.f;
            }
            s->ch_w++;
            if (s->ph_mix > 0.f) {                   /* phaser: four all-passes a side, a little feedback */
                float io[2];
                io[0] = l;
                io[1] = r;
                for (c = 0; c < 2u; c++) {
                    float y = io[c] + 0.4f * s->ph_y[c];
                    uint32_t q2;
                    for (q2 = 0; q2 < 4u; q2++) {
                        float o2 = s->ph_a[c] * y + s->ph_z[c][q2];
                        s->ph_z[c][q2] = y - s->ph_a[c] * o2 + FC_ANTI_DENORMAL;
                        y = o2;
                    }
                    s->ph_y[c] = y;
                    io[c] += s->ph_mix * y;
                }
                l = io[0] * (1.f - 0.3f * s->ph_mix);
                r = io[1] * (1.f - 0.3f * s->ph_mix);
            }
            /* delay: 16-bit memory, a low-pass (tone) and a gentle high-pass in the feedback, stereo or ping-pong */
            if (dl_mix > 0.f) {
                uint32_t rd = (s->dl_w - s->dl_len) & (FC_DLY_LEN - 1u), w = s->dl_w & (FC_DLY_LEN - 1u);
                float dlv = (float)s->dl[0][rd] * (1.f / 32767.f), drv = (float)s->dl[1][rd] * (1.f / 32767.f);
                float fl, fr, il, ir;
                s->dl_lp[0] += s->dl_c * (dlv - s->dl_lp[0]) + FC_ANTI_DENORMAL;
                s->dl_lp[1] += s->dl_c * (drv - s->dl_lp[1]) + FC_ANTI_DENORMAL;
                s->dl_hp[0] += 0.0171f * (s->dl_lp[0] - s->dl_hp[0]);    /* about 120 Hz */
                s->dl_hp[1] += 0.0171f * (s->dl_lp[1] - s->dl_hp[1]);
                fl = (s->dl_lp[0] - s->dl_hp[0]) * s->dl_fb;
                fr = (s->dl_lp[1] - s->dl_hp[1]) * s->dl_fb;
                if (s->sx.dly_mode) {                /* ping-pong: in on the left, across each time round */
                    il = (l + r) * 0.5f + fr;
                    ir = fl;
                } else {
                    il = l + fl;
                    ir = r + fr;
                }
                s->dl[0][w] = (int16_t)(fc_soft(il) * 32767.f);
                s->dl[1][w] = (int16_t)(fc_soft(ir) * 32767.f);
                l += dlv * dl_mix;
                r += drv * dl_mix;
            }
            s->dl_w++;
            /* reverb */
            if (rv_mix > 0.f) {
                in = (l + r) * 0.015f;
                for (c = 0; c < 2u; c++) {
                    uint32_t qq;
                    float acc = 0.f;
                    for (qq = 0; qq < FC_RV_NC; qq++) {
                        float *bf = s->rv_c[c][qq], o = bf[s->rv_ci[c][qq]];
                        s->rv_cs[c][qq] = o * (1.f - s->rv_damp) + s->rv_cs[c][qq] * s->rv_damp + FC_ANTI_DENORMAL;
                        bf[s->rv_ci[c][qq]] = in + s->rv_cs[c][qq] * s->rv_fb;
                        if (++s->rv_ci[c][qq] >= s->rv_cl[c][qq])
                            s->rv_ci[c][qq] = 0;
                        acc += o;
                    }
                    for (qq = 0; qq < FC_RV_NA; qq++) {
                        float *bf = s->rv_a[c][qq], bo = bf[s->rv_ai[c][qq]];
                        float o = bo - acc;
                        bf[s->rv_ai[c][qq]] = acc + bo * 0.5f + FC_ANTI_DENORMAL;
                        if (++s->rv_ai[c][qq] >= s->rv_al[c][qq])
                            s->rv_ai[c][qq] = 0;
                        acc = o;
                    }
                    out[c] = acc;
                }
                l += out[0] * rv_mix * 3.f;
                r += out[1] * rv_mix * 3.f;
            }
            lr[2u * (done + i)] = fc_soft(l * s->level);
            lr[2u * (done + i) + 1u] = fc_soft(r * s->level);
        }
    }
}
