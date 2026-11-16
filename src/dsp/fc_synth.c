/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the chord synth (fc_synth.h). The filter is the trapezoidal state-variable filter (Andrew Simper's
 * "linear trapezoidal" SVF); the oscillators are polyBLEP; the chorus is two modulated taps on one delay, as a
 * Juno's; the reverb is Freeverb's structure (Jezar, public domain) at a smaller size. Written for this project.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#include "fc_synth.h"
#include "fc_math.h"

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

void fc_synth_sound(fc_synth_t *s, const fc_sound_t *o)
{
    float lv;
    s->snd = *o;
    env_coefs(&s->amp, o->amp_a, o->amp_d, o->amp_s, o->amp_r);
    env_coefs(&s->flt, o->flt_a, o->flt_d, o->flt_s, o->flt_r);
    lv = (float)o->level * (1.f / 127.f);
    s->level = lv * lv;
    s->cut_st = 4.3219f + (float)o->cutoff * (9.8f / 127.f);         /* log2(Hz): 20 Hz .. 17.8 kHz */
    s->fenv_st = (float)o->fenv * (6.f / 127.f);                     /* up to six octaves */
    s->track = (float)o->ftrack * (1.f / 127.f);
    s->res_k = 2.f - 1.94f * (float)o->res * (1.f / 127.f);
    s->detune_r = fc_exp2f((float)o->detune * (50.f / 127.f) / 1200.f);
    s->bl = (float)o->b_level * (1.f / 127.f);
    s->sub = (float)o->sub * (1.f / 127.f);
    s->fm = (float)o->fm * (0.5f / 127.f);
    s->vs = (float)o->vel_sens * (1.f / 127.f);
    s->wa = o->wave_a % FC_NW;
    s->wb = o->wave_b % FC_NW;
    s->ch_mix = (float)o->chorus * (1.f / 127.f);
    s->rv_mix = (float)o->rev_mix * (1.f / 127.f);
    s->rv_fb = 0.70f + 0.28f * (float)o->rev_size * (1.f / 127.f);
}

void fc_synth_init(fc_synth_t *s, float *mem)
{
    static const uint16_t CL[FC_RV_NC] = {1116, 1188, 1277, 1356}, AL[FC_RV_NA] = {556, 441};
    uint8_t *b = (uint8_t *)s;
    uint32_t i, c, k, used = 0;
    fc_sound_t d;
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
    s->rv_damp = 0.25f;
    fc_sound_default(&d);
    fc_synth_sound(s, &d);
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
    if (!v)
        for (i = 0; i < FC_VOICES; i++) {
            fc_voice_t *x = &s->v[i];
            if (!x->stage_a) {
                v = x;
                break;
            }
            if (x->stage_a == 3u && (!rel || x->age < rel->age))
                rel = x;
            if (!old || x->age < old->age)
                old = x;
        }
    if (!v) {
        v = rel ? rel : old;
        v->ea = 0.f;                                /* stolen */
        v->ef = 0.f;
        v->ic1 = v->ic2 = 0.f;
    }
    if (!v->stage_a) {
        v->ea = v->ef = 0.f;
        v->ic1 = v->ic2 = 0.f;
        v->pa = 0.f;
        v->pb = 0.37f;                              /* B starts elsewhere: the detuned pair beats from the start */
        v->ps = 0.f;
    }
    v->note = (uint8_t)note;
    v->on = 1;
    v->stage_a = 1;
    v->stage_f = 1;
    v->age = ++s->age;
    hz = note_hz(note);
    v->inc_a = hz * (1.f / FSF);
    v->inc_b = v->inc_a * s->detune_r;
    v->vel = 1.f - s->vs + s->vs * (float)vel * (1.f / 127.f);
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
        }
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

static inline float osc(uint32_t w, float p, float dt)
{
    float y, q;
    switch (w) {
    case FC_W_SQUARE:
        y = p < 0.5f ? 1.f : -1.f;
        q = wrap1(p + 0.5f);
        return y + blep(p, dt) - blep(q, dt);
    case FC_W_PULSE:
        y = p < 0.25f ? 1.f : -1.f;
        q = wrap1(p + 0.75f);
        return (y + blep(p, dt) - blep(q, dt)) + 0.5f;     /* centred */
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

static void voice_render(fc_synth_t *s, fc_voice_t *v, float *mono, uint32_t n)
{
    uint32_t i, j;
    const float gain = 0.16f * v->vel;
    for (i = 0; i < n; i += FC_CTRL) {
        uint32_t m = n - i < FC_CTRL ? n - i : FC_CTRL;
        float lc = s->cut_st + s->fenv_st * v->ef + s->track * v->key * (1.f / 12.f), f, g, a1, a2, a3;
        f = fc_exp2f(lc);
        if (f > 0.45f * FSF)
            f = 0.45f * FSF;
        g = fc_tanf(3.14159265f * f * (1.f / FSF));
        a1 = 1.f / (1.f + g * (g + s->res_k));
        a2 = g * a1;
        a3 = g * a2;
        for (j = 0; j < m; j++) {
            float x, pa, v1, v2, v3;
            pa = v->pa;
            if (s->fm > 0.f)
                pa = wrap1(pa + s->fm * fc_sin_turn(v->pb));
            x = osc(s->wa, pa, v->inc_a);
            if (s->bl > 0.f)
                x += s->bl * osc(s->wb, v->pb, v->inc_b);
            if (s->sub > 0.f)
                x += s->sub * osc(FC_W_SQUARE, v->ps, v->inc_a * 0.5f);
            v->pa = wrap1(v->pa + v->inc_a);
            v->pb = wrap1(v->pb + v->inc_b);
            v->ps = wrap1(v->ps + v->inc_a * 0.5f);
            v3 = x - v->ic2;
            v1 = a1 * v->ic1 + a2 * v3;
            v2 = v->ic2 + a2 * v->ic1 + a3 * v3;
            v->ic1 = 2.f * v1 - v->ic1;
            v->ic2 = 2.f * v2 - v->ic2;
            v->ea = env_step(&v->stage_a, v->ea, &s->amp);
            v->ef = env_step(&v->stage_f, v->ef, &s->flt);
            mono[i + j] += v2 * v->ea * gain;
        }
        if (!v->stage_a)
            break;
    }
    if (!v->stage_a) {
        v->ic1 = v->ic2 = 0.f;
        v->stage_f = 0;
    }
}

void fc_synth_render(fc_synth_t *s, float *lr, uint32_t n)
{
    float *mono = s->mono;
    uint32_t i, k, c, done;
    for (done = 0; done < n; done += k) {
        k = n - done > 128u ? 128u : n - done;
        for (i = 0; i < k; i++)
            mono[i] = 0.f;
        for (i = 0; i < FC_VOICES; i++)
            if (s->v[i].stage_a)
                voice_render(s, &s->v[i], mono, k);
        for (i = 0; i < k; i++) {
            float x = mono[i], l = x, r = x, in, out[2];
            /* chorus: two taps 1.5 .. 5.5 ms, a 0.5 Hz triangle, opposite on each side */
            s->ch_buf[s->ch_w & (FC_CH_LEN - 1u)] = x;
            if (s->ch_mix > 0.f) {
                float tri = s->ch_ph < 0.5f ? 4.f * s->ch_ph - 1.f : 3.f - 4.f * s->ch_ph;
                float d1 = 154.f + 88.f * tri, d2 = 154.f - 88.f * tri, t1, t2, w1, w2;
                uint32_t i1 = (uint32_t)d1, i2 = (uint32_t)d2;
                t1 = d1 - (float)i1;
                t2 = d2 - (float)i2;
                w1 = s->ch_buf[(s->ch_w - i1) & (FC_CH_LEN - 1u)] * (1.f - t1) +
                     s->ch_buf[(s->ch_w - i1 - 1u) & (FC_CH_LEN - 1u)] * t1;
                w2 = s->ch_buf[(s->ch_w - i2) & (FC_CH_LEN - 1u)] * (1.f - t2) +
                     s->ch_buf[(s->ch_w - i2 - 1u) & (FC_CH_LEN - 1u)] * t2;
                l = x * (1.f - 0.4f * s->ch_mix) + w1 * s->ch_mix;
                r = x * (1.f - 0.4f * s->ch_mix) + w2 * s->ch_mix;
                s->ch_ph += 0.5f / FSF;
                if (s->ch_ph >= 1.f)
                    s->ch_ph -= 1.f;
            }
            s->ch_w++;
            /* reverb */
            if (s->rv_mix > 0.f) {
                in = (l + r) * 0.015f;
                for (c = 0; c < 2u; c++) {
                    uint32_t q;
                    float acc = 0.f;
                    for (q = 0; q < FC_RV_NC; q++) {
                        float *bf = s->rv_c[c][q], o = bf[s->rv_ci[c][q]];
                        s->rv_cs[c][q] = o * (1.f - s->rv_damp) + s->rv_cs[c][q] * s->rv_damp + FC_ANTI_DENORMAL;
                        bf[s->rv_ci[c][q]] = in + s->rv_cs[c][q] * s->rv_fb;
                        if (++s->rv_ci[c][q] >= s->rv_cl[c][q])
                            s->rv_ci[c][q] = 0;
                        acc += o;
                    }
                    for (q = 0; q < FC_RV_NA; q++) {
                        float *bf = s->rv_a[c][q], bo = bf[s->rv_ai[c][q]];
                        float o = bo - acc;
                        bf[s->rv_ai[c][q]] = acc + bo * 0.5f + FC_ANTI_DENORMAL;
                        if (++s->rv_ai[c][q] >= s->rv_al[c][q])
                            s->rv_ai[c][q] = 0;
                        acc = o;
                    }
                    out[c] = acc;
                }
                l += out[0] * s->rv_mix * 3.f;
                r += out[1] * s->rv_mix * 3.f;
            }
            lr[2u * (done + i)] = fc_soft(l * s->level);
            lr[2u * (done + i) + 1u] = fc_soft(r * s->level);
        }
    }
}
