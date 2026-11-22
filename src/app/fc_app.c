/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord on the FM-1: the panel, the screen, the chord sets in flash, and the notes to the synth and MIDI out.
 * A unity-build fragment: on the FM-1 src/hardware/fc_main_fm1.c includes it after X0X's platform (gfx.c, plat.h)
 * and defines fc_lock() / fc_unlock(); on the host tests/host/fc_host.c does the same with stubs.
 *
 * Who runs what: fc_app_render, fc_app_midi and fc_app_realtime run in the audio interrupt; everything else in the
 * main loop. The main loop changes what the interrupt reads (the set, the player, the synth) only inside fc_lock().
 *
 * The panel (docs/MANUAL.md has the whole of it):
 *   keys            the chord on each key; LEARN (REC): notes, captured as a chord on the selected key
 *   OCT- / OCT+     the whole set an octave down / up (both held 5 s: the FM-1's update mode, as in every firmware)
 *   PRESET          the chord set (factory, then your user sets)      SELECT  the key being edited
 *   ALGO            tempo                                             K1..K4  the page's four values
 *   HOME            PLAY page    EDIT  the chord (again: bass, octave)   ENV  sound, amp, FX    FX  the FX page
 *   ARP             strum / arpeggio (again: arp settings)   GLO  MIDI and global   LFO  latch   SEL  voice leading
 *   SAVE            save the set to a user slot (SAVE again to confirm)   REC  learn   PLAY  all notes off
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#include "fc_app.h"
#include "fc_presets.h"
#include "fc_font.h"
#include "fc_math.h"
#include "fc_harmony.h"

#ifndef FC_VERSION
#define FC_VERSION "DEV"
#endif

/* ------------------------------------------------------------------------------------------------- state --- */
static fc_set_t fc_set;                          /* the working set: what the keys play */
static fc_globals_t fc_g;
static fc_player_t fc_pl;
static fc_synth_t fc_syn X0X_POOL;
static float fc_rv[FC_RV_FLOATS] X0X_POOL;
static int16_t fc_dly[2u * FC_DLY_LEN] X0X_POOL;  /* the delay's memory: 128 KB */
static volatile uint32_t fc_clock_n, fc_clock_t0;  /* MIDI clock: ticks counted for the tempo */
static volatile float fc_clock_bpm;
static uint8_t fc_obj[PLAT_STORE_MAX] X0X_POOL;  /* a store object being read or written */
static float fc_fbuf[2u * 128u];
static uint8_t fc_dirty;                          /* the working set differs from where it came from */
static volatile uint8_t fc_clock_seen;           /* MIDI clock arrived lately (the arp follows it) */
static volatile uint32_t fc_clock_ms;

enum { PG_PLAY, PG_EDIT, PG_EDIT2, PG_SOUND, PG_AMP, PG_FX, PG_MODE, PG_ARP, PG_GLOBAL, PG_SAVE, PG_LEARN,
       PG_MACRO, PG_FILTER, PG_MENV, PG_LFO, PG_DELAY, PG_OSC, PG_OSC2, PG_LOFI, PG_GLOBAL2, PG_N };
static const char *const FC_PG_NAME[PG_N] = {"PLAY", "CHORD", "CHORD 2", "SOUND", "AMP", "FX", "PLAYING", "ARP",
                                             "GLOBAL", "SAVE", "LEARN", "MACRO", "FILTER", "MOD ENV", "LFO",
                                             "DELAY", "OSC", "OSC 2", "LO-FI", "GLOBAL 2"};
static uint32_t fc_page = PG_PLAY;
static uint32_t fc_sel;                          /* the key being edited (the last pressed) */
static uint32_t fc_keys_prev, fc_btn_prev;
static uint32_t fc_ver = 1, fc_drawn;            /* the screen redraws when fc_ver moves on */
static char fc_msg[28];
static uint32_t fc_msg_until;
static int32_t fc_knob_hit = -1;                 /* the knob turned last (its value drawn highlighted) */
static uint32_t fc_knob_until;
static uint32_t fc_aud_key = 0xFFu, fc_aud_until;
/* the audio's load, set by the hardware layer after every block (0 on the host): GLOBAL 2 shows it */
static volatile uint32_t fc_cpu_now, fc_cpu_peak, fc_cpu_drops, fc_cpu_cap = FC_VOICES;
static uint32_t fc_cpu_shown, fc_cpu_t;
static uint32_t fc_save_slot;
/* SAVE's choices: 0x80 | slot overwrite the set's own slot, slot a new (empty) slot, 0x40 | slot replace another */
static uint8_t fc_sv[FC_NUSER + 1u];
static uint32_t fc_sv_n, fc_sv_i;
/* live sync: changes to the set made here are announced to the editor (FC_EVT), ~120 ms after they settle */
enum { FC_CH_LOADED = 1, FC_CH_EDITED = 2, FC_CH_SAVED = 4 };
static uint32_t fc_rev, fc_rev_sent, fc_rev_ms, fc_rev_kind;
static void fc_changed(uint32_t kind)
{
    fc_rev++;
    fc_rev_ms = plat_ms();
    fc_rev_kind |= kind;
}
/* learn */
static uint8_t fc_ln_notes[16];
static uint32_t fc_ln_n, fc_ln_held;

static void fc_touch(void) { fc_ver++; }
static void fc_flash(const char *m)
{
    uint32_t i;
    for (i = 0; m[i] && i < sizeof fc_msg - 1u; i++)
        fc_msg[i] = m[i];
    fc_msg[i] = 0;
    fc_msg_until = plat_ms() + 1400u;
    fc_touch();
}

/* -------------------------------------------------------------------------------------------- notes out --- */
static void fc_midi3(uint32_t st, uint32_t d1, uint32_t d2)
{
    plat_midi_out((st >> 4) | st << 8 | (d1 & 0x7Fu) << 16 | (d2 & 0x7Fu) << 24);
}
static void fc_out_on(void *u, uint32_t n, uint32_t v)
{
    (void)u;
    if (fc_g.output != 2u)
        fc_synth_on(&fc_syn, n, v);
    if (fc_g.output != 1u)
        fc_midi3(0x90u | fc_g.midi_ch, n, v);
}
static void fc_out_off(void *u, uint32_t n)
{
    (void)u;
    fc_synth_off(&fc_syn, n);
    if (fc_g.output != 1u)
        fc_midi3(0x80u | fc_g.midi_ch, n, 0);
}

/* ------------------------------------------------------------------------------------------------ storage --- */
static uint32_t fc_obj_of(uint32_t slot) { return slot < 10u ? OBJ_PAT0 : OBJ_PAT1; }
/* a store object of ten sets into fc_obj, laid out as now: one saved by 0.1 .. 0.5 (336-byte sets) or 0.6 (376) is
 * spread out to 384 bytes a set; fc_set_check fills in the parts of the sound those versions didn't have. The
 * bytes read, or < 0. */
static int fc_obj_load(uint32_t obj)
{
    int n = plat_store_load(obj, fc_obj, sizeof fc_obj);
    uint32_t i, k, old = n == (int)(10u * FC_SET_BYTES_V1) ? FC_SET_BYTES_V1 :
                          n == (int)(10u * FC_SET_BYTES_V2) ? FC_SET_BYTES_V2 : 0u;
    if (old) {
        for (i = 10u; i-- > 0u;) {
            for (k = old; k-- > 0u;)
                fc_obj[i * FC_SET_BYTES + k] = fc_obj[i * old + k];
            for (k = old; k < FC_SET_BYTES; k++)
                fc_obj[i * FC_SET_BYTES + k] = 0;
        }
        n = (int)(10u * FC_SET_BYTES);
    }
    return n;
}
static int fc_user_load(uint32_t slot, fc_set_t *s)
{
    int n;
    uint32_t off = (slot % 10u) * FC_SET_BYTES, i;
    if (slot >= FC_NUSER)
        return -1;
    n = fc_obj_load(fc_obj_of(slot));
    if (n < (int)(off + FC_SET_BYTES))
        return -1;
    for (i = 0; i < FC_SET_BYTES; i++)
        ((uint8_t *)s)[i] = fc_obj[off + i];
    return fc_set_check(s);
}
static int fc_user_used(uint32_t slot)
{
    static fc_set_t t;
    return fc_user_load(slot, &t) == 0;
}
static int fc_user_save(uint32_t slot, const fc_set_t *s)
{
    int n;
    uint32_t off = (slot % 10u) * FC_SET_BYTES, i;
    if (slot >= FC_NUSER)
        return -1;
    n = fc_obj_load(fc_obj_of(slot));
    for (i = n < 0 ? 0u : (uint32_t)n; i < 10u * FC_SET_BYTES; i++)
        fc_obj[i] = 0;                            /* slots never written: empty */
    for (i = 0; i < FC_SET_BYTES; i++)
        fc_obj[off + i] = ((const uint8_t *)s)[i];
    return plat_store_save(fc_obj_of(slot), fc_obj, 10u * FC_SET_BYTES);
}
static void fc_globals_save(void) { (void)plat_store_save(OBJ_SOUND, &fc_g, sizeof fc_g); }

/* the set the keys play from now: 0..19 a user set, FC_FACTORY0 + n factory set n; 0 = done */
static int fc_load_set(uint32_t idx)
{
    static fc_set_t t;
    uint32_t i;
    if (idx >= FC_FACTORY0) {
        if (idx - FC_FACTORY0 >= FC_NFACTORY)
            return -1;
        for (i = 0; i < FC_SET_BYTES; i++)
            ((uint8_t *)&t)[i] = FC_FACTORY[idx - FC_FACTORY0][i];
        if (fc_set_check(&t))
            return -1;
    } else if (fc_user_load(idx, &t))
        return -1;
    fc_lock();
    fc_player_stop(&fc_pl);
    fc_synth_all_off(&fc_syn);
    fc_set = t;
    fc_synth_sound(&fc_syn, &fc_set.sound, &fc_set.sx, &fc_set.s3);
    fc_unlock();
    fc_g.cur_set = (uint8_t)idx;
    fc_dirty = 0;
    fc_changed(FC_CH_LOADED);
    fc_touch();
    return 0;
}
/* the next set PRESET reaches: factory sets first, then the user sets that hold one */
static uint32_t fc_step_set(uint32_t idx, int32_t d)
{
    uint32_t order[FC_NFACTORY + FC_NUSER], n = 0, i, at = 0;
    for (i = 0; i < FC_NFACTORY; i++)
        order[n++] = FC_FACTORY0 + i;
    for (i = 0; i < FC_NUSER; i++)
        if (fc_user_used(i))
            order[n++] = i;
    for (i = 0; i < n; i++)
        if (order[i] == idx)
            at = i;
    at = (uint32_t)(((int32_t)at + d) % (int32_t)n + (int32_t)n) % n;
    return order[at];
}

/* --------------------------------------------------------------------------------------------- the values --- */
enum {
    P_NONE, P_SET, P_OCT, P_TRANS, P_TEMPO, P_ROOT, P_QUAL, P_INV, P_VOICE, P_BASS, P_COCT, P_LATCH, P_VLEAD,
    P_STYPE, P_CUT, P_RES, P_FENV, P_AA, P_AD, P_AS, P_AR, P_CHO, P_REV, P_SIZE, P_LEVEL, P_PMODE, P_STRUM, P_SDIR,
    P_HUMAN, P_RATE, P_ADIR, P_AOCT, P_GATE, P_MCH, P_OUT, P_CLK, P_VEL, P_SLOT,
    P_M1, P_M2, P_M3, P_M4, P_FMODE, P_SLOPE, P_DRIVE, P_FTRK, P_MA, P_MD, P_MS, P_MR, P_L1R, P_L1W, P_L2R, P_L2W,
    P_DTIME, P_DFB, P_DMIX, P_DTONE,
    P_WA, P_WB, P_WTPOS, P_SPREAD, P_BSEMI, P_BMODE, P_BLEV, P_SUB, P_BITS, P_CRATE, P_WOB, P_PHASER, P_VOICES, P_CPU, P_PEAK, P_DROPS
};
static const uint8_t FC_PAGE_P[PG_N][4] = {
    {P_SET, P_OCT, P_TRANS, P_TEMPO},         {P_ROOT, P_QUAL, P_INV, P_VOICE},
    {P_BASS, P_COCT, P_LATCH, P_VLEAD},       {P_STYPE, P_CUT, P_RES, P_FENV},
    {P_AA, P_AD, P_AS, P_AR},                 {P_CHO, P_REV, P_SIZE, P_LEVEL},
    {P_PMODE, P_STRUM, P_SDIR, P_HUMAN},      {P_RATE, P_ADIR, P_AOCT, P_GATE},
    {P_MCH, P_OUT, P_CLK, P_VEL},             {P_SLOT, P_NONE, P_NONE, P_NONE},
    {P_NONE, P_NONE, P_NONE, P_NONE},         {P_M1, P_M2, P_M3, P_M4},
    {P_FMODE, P_SLOPE, P_DRIVE, P_FTRK},      {P_MA, P_MD, P_MS, P_MR},
    {P_L1R, P_L1W, P_L2R, P_L2W},             {P_DTIME, P_DFB, P_DMIX, P_DTONE},
    {P_WA, P_WB, P_WTPOS, P_SPREAD},          {P_BSEMI, P_BMODE, P_BLEV, P_SUB},
    {P_BITS, P_CRATE, P_WOB, P_PHASER},       {P_VOICES, P_CPU, P_PEAK, P_DROPS},
};
static const char *const FC_P_LABEL[] = {
    "", "SET", "OCT", "TRANS", "TEMPO", "ROOT", "TYPE", "INV", "VOICE", "BASS", "OCTAVE", "LATCH", "V.LEAD",
    "SOUND", "CUTOFF", "RESO", "F.ENV", "ATTACK", "DECAY", "SUSTAIN", "RELEASE", "CHORUS", "REVERB", "SIZE", "LEVEL",
    "MODE", "STRUM", "DIR", "HUMAN", "RATE", "DIR", "OCTAVES", "GATE", "MIDI CH", "OUTPUT", "CLOCK", "VELO", "SLOT",
    "MACRO 1", "MACRO 2", "MACRO 3", "MACRO 4", "TYPE", "SLOPE", "DRIVE", "KEY TRK", "ATTACK", "DECAY", "SUSTAIN",
    "RELEASE", "L1 RATE", "L1 WAVE", "L2 RATE", "L2 WAVE", "TIME", "FEEDBK", "MIX", "TONE",
    "WAVE A", "WAVE B", "WT POS", "SPREAD", "B TUNE", "B MODE", "B LEVEL", "SUB", "BITS", "RATE", "WOBBLE", "PHASER", "VOICES", "CPU", "PEAK", "DROPS"};
static const char *const FC_WAVE_S[FC_NW] = {"SAW", "SQUARE", "TRI", "SINE", "ORGAN", "PULSE", "SUPER", "NOISE",
    "VOX", "PWM WT", "DIGI", "GLASS"};
/* a macro knob's label: what it moves first (the editor sets that up), else MACRO n */
static const char *const FC_MD_SHORT[FC_NMD] = {"", "PITCH", "CUTOFF", "RESO", "OSC B", "FM", "WIDTH", "VOLUME",
    "DETUNE", "SUB", "DRIVE", "F.ENV", "LFO1 RT", "DLY MIX", "REV MIX", "CHORUS"};
static const char *fc_plabel(uint32_t p)
{
    if (p >= P_M1 && p <= P_M4) {
        uint32_t i, src = FC_MS_M1 + (p - P_M1);
        for (i = 0; i < FC_NMOD; i++) {
            const fc_mod_t *m = &fc_set.sx.mod[i];
            if (m->src == src && m->dst && m->dst < FC_NMD && m->amt)
                return FC_MD_SHORT[m->dst];
        }
    }
    return FC_P_LABEL[p];
}
static const char *const FC_LW_S[FC_NLWAVE] = {"SINE", "TRI", "SAW", "SQUARE", "RAND"};
static const char *const FC_FM_S[FC_NFMODE] = {"LP", "BP", "HP", "NOTCH"};
static const char *const FC_QMENU[FC_NQ_NAMED] = {"MAJ", "MIN", "7", "MAJ7", "MIN7", "9", "MIN9", "11", "13", "SUS2",
    "SUS4", "DIM", "AUG", "ADD9", "6", "MIN6", "5", "MIN11", "M7B5", "DIM7", "MAJ9", "7SUS4", "7#9", "7B9", "7#5", "MMAJ7",
    "MAJ7#11", "7#11", "MIN13", "6/9"};
static const char *const FC_RATE_S[FC_NRATE] = {"1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"};

static fc_chord_t *fc_cur(void) { return &fc_set.ch[fc_sel % FC_NKEYS]; }
static int32_t lim32(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : v > hi ? hi : v; }

static void fc_num(char *b, int32_t v, int sign)
{
    char t[12];
    uint32_t n = 0, k = 0, u = (uint32_t)(v < 0 ? -v : v);
    if (v < 0)
        b[k++] = '-';
    else if (sign && v > 0)
        b[k++] = '+';
    do {
        t[n++] = (char)('0' + u % 10u);
        u /= 10u;
    } while (u);
    while (n)
        b[k++] = t[--n];
    b[k] = 0;
}
static void fc_cpy(char *b, const char *s)
{
    while ((*b++ = *s++))
        ;
}

/* the value as the screen shows it */
static void fc_ptext(uint32_t p, char *b)
{
    const fc_chord_t *c = fc_cur();
    int empty = c->quality == FC_EMPTY;
    const fc_sound_t *o = &fc_set.sound;
    const fc_play_t *pl = &fc_set.play;
    b[0] = 0;
    switch (p) {
    case P_SET:
        if (fc_g.cur_set >= FC_FACTORY0) {
            fc_cpy(b, "F");
            fc_num(b + 1, (int32_t)fc_g.cur_set - (int32_t)FC_FACTORY0 + 1, 0);
        } else {
            fc_cpy(b, "U");
            fc_num(b + 1, fc_g.cur_set + 1, 0);
        }
        break;
    case P_OCT: fc_num(b, pl->octave, 1); break;
    case P_TRANS: fc_num(b, pl->transpose, 1); break;
    case P_TEMPO: fc_num(b, fc_set.tempo, 0); break;
    case P_ROOT: fc_cpy(b, empty ? "-" : fc_note_name(c->root)); break;
    case P_QUAL: fc_cpy(b, empty ? "-" : c->quality == FC_Q_CUSTOM ? "CUSTOM" : FC_QMENU[c->quality]); break;
    case P_INV: fc_cpy(b, empty ? "-" : c->inversion == 0 ? "ROOT" : c->inversion == 1 ? "1ST" : c->inversion == 2 ? "2ND" : "3RD"); break;
    case P_VOICE: fc_cpy(b, empty ? "-" : fc_voicing_name(c->voicing)); break;
    case P_BASS: fc_cpy(b, empty || c->bass >= 12u ? "-" : fc_note_name(c->bass)); break;
    case P_COCT: if (empty) fc_cpy(b, "-"); else fc_num(b, c->octave, 1); break;
    case P_LATCH: fc_cpy(b, pl->latch ? "ON" : "OFF"); break;
    case P_VLEAD: fc_cpy(b, pl->voice_lead ? "ON" : "OFF"); break;
    case P_STYPE: {
        const char *n = FC_SOUNDS[o->type % FC_NSOUNDS].name;
        uint32_t i;
        for (i = 0; n[i] && n[i] != ' ' && i < 7u; i++)   /* the first word: WARM, NEURO ... */
            b[i] = n[i];
        b[i] = 0;
        break;
    }
    case P_CUT: fc_num(b, o->cutoff, 0); break;
    case P_RES: fc_num(b, o->res, 0); break;
    case P_FENV: fc_num(b, o->fenv, 0); break;
    case P_AA: fc_num(b, o->amp_a, 0); break;
    case P_AD: fc_num(b, o->amp_d, 0); break;
    case P_AS: fc_num(b, o->amp_s, 0); break;
    case P_AR: fc_num(b, o->amp_r, 0); break;
    case P_CHO: fc_num(b, o->chorus, 0); break;
    case P_REV: fc_num(b, o->rev_mix, 0); break;
    case P_SIZE: fc_num(b, o->rev_size, 0); break;
    case P_LEVEL: fc_num(b, o->level, 0); break;
    case P_PMODE: fc_cpy(b, pl->mode == FC_M_CHORD ? "CHORD" : pl->mode == FC_M_STRUM ? "STRUM" : "ARP"); break;
    case P_STRUM: fc_num(b, pl->strum * 2, 0); break;
    case P_SDIR: fc_cpy(b, pl->strum_dir == 0 ? "UP" : pl->strum_dir == 1 ? "DOWN" : "ALT"); break;
    case P_HUMAN: fc_num(b, pl->humanise, 0); break;
    case P_RATE: fc_cpy(b, FC_RATE_S[pl->arp_rate % FC_NRATE]); break;
    case P_ADIR: fc_cpy(b, pl->arp_dir == 0 ? "UP" : pl->arp_dir == 1 ? "DOWN" : pl->arp_dir == 2 ? "UP-DN" : "RAND"); break;
    case P_AOCT: fc_num(b, pl->arp_oct, 0); break;
    case P_GATE: fc_num(b, pl->arp_gate, 0); break;
    case P_MCH: fc_num(b, fc_g.midi_ch + 1, 0); break;
    case P_OUT: fc_cpy(b, fc_g.output == 0 ? "BOTH" : fc_g.output == 1 ? "SYNTH" : "MIDI"); break;
    case P_CLK: fc_cpy(b, fc_g.clock ? "MIDI" : "INT"); break;
    case P_VEL: fc_num(b, fc_g.velocity, 0); break;
    case P_SLOT: fc_cpy(b, "U"); fc_num(b + 1, (int32_t)fc_save_slot + 1, 0); break;
    case P_M1:
    case P_M2:
    case P_M3:
    case P_M4: fc_num(b, fc_set.sx.macro[p - P_M1], 0); break;
    case P_FMODE: fc_cpy(b, FC_FM_S[fc_set.sx.flt_mode % FC_NFMODE]); break;
    case P_SLOPE: fc_cpy(b, fc_set.sx.flt_slope ? "24DB" : "12DB"); break;
    case P_DRIVE: fc_num(b, fc_set.sx.drive, 0); break;
    case P_FTRK: fc_num(b, o->ftrack, 0); break;
    case P_MA: fc_num(b, fc_set.sx.menv_a, 0); break;
    case P_MD: fc_num(b, fc_set.sx.menv_d, 0); break;
    case P_MS: fc_num(b, fc_set.sx.menv_s, 0); break;
    case P_MR: fc_num(b, fc_set.sx.menv_r, 0); break;
    case P_L1R:
    case P_L2R: {
        uint32_t i = p == P_L2R, r = fc_set.sx.lfo_rate[i];
        if (fc_set.sx.lfo_sync[i])
            fc_cpy(b, FC_DIV_NAME[(FC_NDIV - 1u) - (r * FC_NDIV >> 7)]);
        else {                                   /* Hz, to a tenth (to a hundredth below 1 Hz) */
            float hz = 0.03f * fc_exp2f((float)r * (10.f / 127.f));
            uint32_t t = hz < 1.f ? (uint32_t)(hz * 100.f + 0.5f) : (uint32_t)(hz * 10.f + 0.5f), k;
            if (hz < 1.f) {
                b[0] = '0';
                b[1] = '.';
                b[2] = (char)('0' + t / 10u % 10u);
                b[3] = (char)('0' + t % 10u);
                b[4] = 0;
            } else {
                fc_num(b, (int32_t)(t / 10u), 0);
                for (k = 0; b[k]; k++)
                    ;
                b[k++] = '.';
                b[k++] = (char)('0' + t % 10u);
                b[k] = 0;
            }
        }
        break;
    }
    case P_L1W: fc_cpy(b, FC_LW_S[fc_set.sx.lfo_wave[0] % FC_NLWAVE]); break;
    case P_L2W: fc_cpy(b, FC_LW_S[fc_set.sx.lfo_wave[1] % FC_NLWAVE]); break;
    case P_DTIME: fc_cpy(b, FC_DIV_NAME[fc_set.sx.dly_time % FC_NDIV]); break;
    case P_DFB: fc_num(b, fc_set.sx.dly_fb, 0); break;
    case P_DMIX: if (fc_set.sx.dly_mix) fc_num(b, fc_set.sx.dly_mix, 0); else fc_cpy(b, "OFF"); break;
    case P_DTONE: fc_num(b, fc_set.sx.dly_tone, 0); break;
    case P_WA: fc_cpy(b, FC_WAVE_S[o->wave_a % FC_NW]); break;
    case P_WB: fc_cpy(b, FC_WAVE_S[o->wave_b % FC_NW]); break;
    case P_WTPOS: fc_num(b, fc_set.s3.wt_pos, 0); break;
    case P_SPREAD: fc_num(b, fc_set.s3.spread, 0); break;
    case P_BSEMI: fc_num(b, fc_set.s3.b_semi, 1); break;
    case P_BMODE: fc_cpy(b, fc_set.s3.osc_mode == FC_O_SYNC ? "SYNC" : fc_set.s3.osc_mode == FC_O_RING ? "RING" : "ADD"); break;
    case P_BLEV: fc_num(b, o->b_level, 0); break;
    case P_SUB: fc_num(b, o->sub, 0); break;
    case P_BITS:
        if (!fc_set.s3.crush_bits)
            fc_cpy(b, "OFF");
        else {
            uint32_t k;
            fc_num(b, 16 - (int32_t)((uint32_t)fc_set.s3.crush_bits * 13u + 63u) / 127, 0);
            for (k = 0; b[k]; k++)
                ;
            fc_cpy(b + k, "BIT");
        }
        break;
    case P_CRATE:
        if (!fc_set.s3.crush_rate)
            fc_cpy(b, "OFF");
        else {                                   /* the rate it's held to, in kHz */
            uint32_t k;
            fc_num(b, (int32_t)(44.1f * fc_exp2f(-(float)fc_set.s3.crush_rate * (5.f / 127.f)) + 0.5f), 0);
            for (k = 0; b[k]; k++)
                ;
            fc_cpy(b + k, "K");
        }
        break;
    case P_WOB: fc_num(b, fc_set.s3.wobble, 0); break;
    case P_PHASER: fc_num(b, fc_set.s3.fx & 0x3Fu, 0); break;
    case P_VOICES: {                             /* the setting; "6/10" while the CPU guard holds it to fewer */
        uint32_t want = fc_g.voices ? fc_g.voices : FC_VOICES, k = 0;
        if (fc_cpu_cap < want) {
            fc_num(b, (int32_t)fc_cpu_cap, 0);
            for (; b[k]; k++)
                ;
            b[k++] = '/';
        }
        fc_num(b + k, (int32_t)want, 0);
        break;
    }
    case P_CPU:
    case P_PEAK: {
        uint32_t k;
        fc_num(b, (int32_t)(p == P_CPU ? fc_cpu_now : fc_cpu_peak), 0);
        for (k = 0; b[k]; k++)
            ;
        fc_cpy(b + k, "%");
        break;
    }
    case P_DROPS: fc_num(b, (int32_t)fc_cpu_drops, 0); break;
    default: break;
    }
}

static void fc_audition(void)                    /* an edited chord plays for a moment */
{
    uint32_t k = fc_sel % FC_NKEYS;
    if (fc_keys_prev & (1u << k))
        return;                                  /* held: it's already sounding (and will be replayed below) */
    fc_lock();
    fc_player_key(&fc_pl, &fc_set, k, fc_g.velocity);
    fc_unlock();
    fc_aud_key = k;
    fc_aud_until = plat_ms() + 450u;
}

/* turn value p by d detents */
static void fc_pturn(uint32_t p, int32_t d)
{
    fc_chord_t *c = fc_cur();
    fc_sound_t *o = &fc_set.sound;
    fc_play_t *pl = &fc_set.play;
    int sound = 0, chord = 0;
    uint8_t *v8 = 0;
    int32_t d2 = d * 2;
    if (p >= P_ROOT && p <= P_COCT && p != P_LATCH && c->quality == FC_EMPTY) {
        c->quality = FC_Q_MAJ;                   /* turning a value of an empty key makes a chord there */
        c->root = fc_set.key_root;
        c->bass = FC_NOBASS;
        if (p == P_ROOT || p == P_QUAL)
            d = 0;
    }
    switch (p) {
    case P_SET: {
        uint32_t idx = fc_step_set(fc_g.cur_set, d);
        if (fc_load_set(idx) == 0)
            fc_flash("SET LOADED");
        return;
    }
    case P_OCT: pl->octave = (int8_t)lim32(pl->octave + d, -3, 3); break;
    case P_TRANS: pl->transpose = (int8_t)lim32(pl->transpose + d, -12, 12); break;
    case P_TEMPO: fc_set.tempo = (uint8_t)lim32(fc_set.tempo + d, 40, 250); break;
    case P_ROOT: c->root = (uint8_t)(((int32_t)c->root + d) % 12 + 12) % 12; chord = 1; break;
    case P_QUAL: {
        int32_t q = c->quality == FC_Q_CUSTOM ? (int32_t)FC_NQ_NAMED : c->quality;
        q = lim32(q + d, 0, (int32_t)FC_NQ_NAMED - (c->custom[0] | c->custom[1] | c->custom[2] | c->custom_hi ? 0 : 1));
        c->quality = (uint8_t)(q == (int32_t)FC_NQ_NAMED ? FC_Q_CUSTOM : (uint32_t)q);
        chord = 1;
        break;
    }
    case P_INV: c->inversion = (uint8_t)lim32(c->inversion + d, 0, 3); chord = 1; break;
    case P_VOICE: c->voicing = (uint8_t)lim32(c->voicing + d, 0, FC_NV - 1); chord = 1; break;
    case P_BASS: {
        int32_t b = c->bass >= 12u ? -1 : c->bass;
        b = lim32(b + d, -1, 11);
        c->bass = (uint8_t)(b < 0 ? FC_NOBASS : (uint32_t)b);
        chord = 1;
        break;
    }
    case P_COCT: c->octave = (int8_t)lim32(c->octave + d, -2, 2); chord = 1; break;
    case P_LATCH: pl->latch = d > 0; break;
    case P_VLEAD: pl->voice_lead = d > 0; break;
    case P_STYPE: {
        int32_t t = lim32((int32_t)o->type + d, 0, (int32_t)FC_NSOUNDS - 1);
        *o = FC_SOUNDS[t].snd;
        fc_set.sx = FC_SOUNDS[t].sx;             /* with its filter mode, LFOs, matrix, macros and delay */
        fc_set.s3 = FC_SOUNDS[t].s3;
        sound = 1;
        break;
    }
    case P_M1:
    case P_M2:
    case P_M3:
    case P_M4: v8 = &fc_set.sx.macro[p - P_M1]; break;
    case P_FMODE: fc_set.sx.flt_mode = (uint8_t)lim32(fc_set.sx.flt_mode + d, 0, FC_NFMODE - 1); sound = 1; break;
    case P_SLOPE: fc_set.sx.flt_slope = d > 0; sound = 1; break;
    case P_DRIVE: v8 = &fc_set.sx.drive; break;
    case P_FTRK: v8 = &o->ftrack; break;
    case P_MA: v8 = &fc_set.sx.menv_a; break;
    case P_MD: v8 = &fc_set.sx.menv_d; break;
    case P_MS: v8 = &fc_set.sx.menv_s; break;
    case P_MR: v8 = &fc_set.sx.menv_r; break;
    case P_L1R: v8 = &fc_set.sx.lfo_rate[0]; break;
    case P_L2R: v8 = &fc_set.sx.lfo_rate[1]; break;
    case P_L1W: fc_set.sx.lfo_wave[0] = (uint8_t)lim32(fc_set.sx.lfo_wave[0] + d, 0, FC_NLWAVE - 1); sound = 1; break;
    case P_L2W: fc_set.sx.lfo_wave[1] = (uint8_t)lim32(fc_set.sx.lfo_wave[1] + d, 0, FC_NLWAVE - 1); sound = 1; break;
    case P_DTIME: fc_set.sx.dly_time = (uint8_t)lim32(fc_set.sx.dly_time + d, 0, FC_D_1); sound = 1; break;
    case P_DFB: v8 = &fc_set.sx.dly_fb; break;
    case P_DMIX: v8 = &fc_set.sx.dly_mix; break;
    case P_DTONE: v8 = &fc_set.sx.dly_tone; break;
    case P_WA: o->wave_a = (uint8_t)lim32(o->wave_a + d, 0, FC_NW - 1); sound = 1; break;
    case P_WB: o->wave_b = (uint8_t)lim32(o->wave_b + d, 0, FC_NW - 1); sound = 1; break;
    case P_WTPOS: v8 = &fc_set.s3.wt_pos; break;
    case P_SPREAD: v8 = &fc_set.s3.spread; break;
    case P_BSEMI: fc_set.s3.b_semi = (int8_t)lim32(fc_set.s3.b_semi + d, -24, 24); sound = 1; break;
    case P_BMODE: fc_set.s3.osc_mode = (uint8_t)lim32(fc_set.s3.osc_mode + d, 0, FC_NOMODE - 1); sound = 1; break;
    case P_BLEV: v8 = &o->b_level; break;
    case P_SUB: v8 = &o->sub; break;
    case P_BITS: v8 = &fc_set.s3.crush_bits; break;
    case P_CRATE: v8 = &fc_set.s3.crush_rate; break;
    case P_WOB: v8 = &fc_set.s3.wobble; break;
    case P_PHASER:
        fc_set.s3.fx = (uint8_t)((fc_set.s3.fx & 0xC0u) | (uint32_t)lim32((int32_t)(fc_set.s3.fx & 0x3Fu) + d2, 0, 63));
        sound = 1;
        break;
    case P_CUT: v8 = &o->cutoff; break;
    case P_RES: v8 = &o->res; break;
    case P_FENV: v8 = &o->fenv; break;
    case P_AA: v8 = &o->amp_a; break;
    case P_AD: v8 = &o->amp_d; break;
    case P_AS: v8 = &o->amp_s; break;
    case P_AR: v8 = &o->amp_r; break;
    case P_CHO: v8 = &o->chorus; break;
    case P_REV: v8 = &o->rev_mix; break;
    case P_SIZE: v8 = &o->rev_size; break;
    case P_LEVEL: v8 = &o->level; break;
    case P_PMODE: pl->mode = (uint8_t)lim32(pl->mode + d, 0, FC_NMODE - 1); break;
    case P_STRUM: pl->strum = (uint8_t)lim32(pl->strum + d, 0, 127); break;
    case P_SDIR: pl->strum_dir = (uint8_t)lim32(pl->strum_dir + d, 0, 2); break;
    case P_HUMAN: pl->humanise = (uint8_t)lim32(pl->humanise + d2, 0, 127); break;
    case P_RATE: pl->arp_rate = (uint8_t)lim32(pl->arp_rate + d, 0, FC_NRATE - 1); break;
    case P_ADIR: pl->arp_dir = (uint8_t)lim32(pl->arp_dir + d, 0, 3); break;
    case P_AOCT: pl->arp_oct = (uint8_t)lim32(pl->arp_oct + d, 1, 3); break;
    case P_GATE: pl->arp_gate = (uint8_t)lim32(pl->arp_gate + d * 5, 5, 100); break;
    case P_MCH: fc_g.midi_ch = (uint8_t)lim32(fc_g.midi_ch + d, 0, 15); fc_touch(); return;
    case P_OUT: fc_g.output = (uint8_t)lim32(fc_g.output + d, 0, 2); fc_touch(); return;
    case P_CLK: fc_g.clock = (uint8_t)lim32(fc_g.clock + d, 0, 1); fc_touch(); return;
    case P_VEL: fc_g.velocity = (uint8_t)lim32(fc_g.velocity + d2, 1, 127); fc_touch(); return;
    case P_VOICES:
        fc_g.voices = (uint8_t)lim32((fc_g.voices ? fc_g.voices : (int32_t)FC_VOICES) + d, 4, FC_VOICES);
        fc_lock();
        fc_synth_voices(&fc_syn, fc_g.voices);
        fc_unlock();
        fc_touch();
        return;
    case P_SLOT:
        fc_sv_i = (uint32_t)lim32((int32_t)fc_sv_i + d, 0, (int32_t)fc_sv_n - 1);
        fc_save_slot = fc_sv[fc_sv_i] & 0x3Fu;
        fc_touch();
        return;
    default: return;
    }
    if (v8) {
        *v8 = (uint8_t)lim32(*v8 + d2, 0, 127);
        sound = 1;
    }
    if (sound) {
        fc_lock();
        fc_synth_sound(&fc_syn, &fc_set.sound, &fc_set.sx, &fc_set.s3);
        fc_unlock();
    }
    fc_dirty = 1;
    fc_changed(FC_CH_EDITED);
    fc_touch();
    if (chord)
        fc_audition();
}

/* ------------------------------------------------------------------------------------------------- learn --- */
static void fc_learn_key(uint32_t k, int down)
{
    uint32_t n = (uint32_t)((int32_t)FC_KEY0_NOTE + (int32_t)k + 12 * fc_set.play.octave), i;
    if (n > 127u)
        return;
    fc_lock();
    if (down)
        fc_synth_on(&fc_syn, n, fc_g.velocity);
    else
        fc_synth_off(&fc_syn, n);
    fc_unlock();
    if (down) {
        fc_ln_held |= 1u << k;
        for (i = 0; i < fc_ln_n; i++)
            if (fc_ln_notes[i] == n)
                return;
        if (fc_ln_n < sizeof fc_ln_notes)
            fc_ln_notes[fc_ln_n++] = (uint8_t)n;
        fc_touch();
        return;
    }
    fc_ln_held &= ~(1u << k);
    if (!fc_ln_held && fc_ln_n) {                /* all let go: that's the chord, on the selected key */
        fc_chord_t c;
        if (fc_chord_identify(fc_ln_notes, fc_ln_n, &c)) {
            int32_t o = (int32_t)c.octave - fc_set.play.octave;   /* the octave buttons stay out of it */
            c.octave = (int8_t)lim32(o, -2, 2);
            fc_set.ch[fc_sel % FC_NKEYS] = c;
            fc_dirty = 1;
            fc_changed(FC_CH_EDITED);
            fc_flash("LEARNT");
        }
        fc_ln_n = 0;
        fc_touch();
    }
}

/* --------------------------------------------------------------------------------------------- the panel --- */
static void fc_go(uint32_t pg)
{
    if (fc_page == PG_LEARN && pg != PG_LEARN) {
        fc_lock();
        fc_synth_all_off(&fc_syn);
        fc_unlock();
        fc_ln_n = fc_ln_held = 0;
    }
    fc_page = pg;
    fc_knob_hit = -1;
    fc_touch();
}

static void fc_button(uint32_t b)
{
    switch (b) {
    case B_HOME: fc_go(fc_page == PG_PLAY ? PG_MACRO : PG_PLAY); break;
    case B_EDIT: fc_go(fc_page == PG_EDIT ? PG_EDIT2 : PG_EDIT); break;
    case B_ENV:                                  /* SOUND, OSC, OSC 2, FILTER, AMP, MOD ENV, LFO, round again */
        fc_go(fc_page == PG_SOUND ? PG_OSC : fc_page == PG_OSC ? PG_OSC2 : fc_page == PG_OSC2 ? PG_FILTER :
              fc_page == PG_FILTER ? PG_AMP : fc_page == PG_AMP ? PG_MENV : fc_page == PG_MENV ? PG_LFO : PG_SOUND);
        break;
    case B_FX: fc_go(fc_page == PG_FX ? PG_DELAY : fc_page == PG_DELAY ? PG_LOFI : PG_FX); break;
    case B_ARP: fc_go(fc_page == PG_MODE ? PG_ARP : PG_MODE); break;
    case B_GLO: fc_go(fc_page == PG_GLOBAL ? PG_GLOBAL2 : PG_GLOBAL); break;
    case B_LFO:
        fc_set.play.latch ^= 1u;
        if (!fc_set.play.latch) {
            fc_lock();
            fc_player_release(&fc_pl);
            fc_unlock();
        }
        fc_dirty = 1;
        fc_changed(FC_CH_EDITED);
        fc_flash(fc_set.play.latch ? "LATCH ON" : "LATCH OFF");
        break;
    case B_SEL:
        fc_set.play.voice_lead ^= 1u;
        fc_dirty = 1;
        fc_changed(FC_CH_EDITED);
        fc_flash(fc_set.play.voice_lead ? "VOICE LEAD ON" : "VOICE LEAD OFF");
        break;
    case B_OCTDN:
    case B_OCTUP:
        fc_set.play.octave = (int8_t)lim32(fc_set.play.octave + (b == B_OCTUP ? 1 : -1), -3, 3);
        fc_dirty = 1;
        fc_changed(FC_CH_EDITED);
        fc_touch();
        break;
    case B_REC: fc_go(fc_page == PG_LEARN ? PG_EDIT : PG_LEARN); break;
    case B_PLAY:
        fc_app_panic();
        fc_flash("ALL NOTES OFF");
        break;
    case B_SEQ: fc_flash("PHRASES: NEXT VERSION"); break;
    case B_SAVE:
        if (fc_page != PG_SAVE) {                /* the choices: overwrite this set's slot, a new one, or replace */
            uint32_t i;
            fc_sv_n = 0;
            if (fc_g.cur_set < FC_NUSER)
                fc_sv[fc_sv_n++] = (uint8_t)(0x80u | fc_g.cur_set);
            for (i = 0; i < FC_NUSER; i++)
                if (!fc_user_used(i))
                    fc_sv[fc_sv_n++] = (uint8_t)i;
            for (i = 0; i < FC_NUSER; i++)
                if (fc_user_used(i) && i != fc_g.cur_set)
                    fc_sv[fc_sv_n++] = (uint8_t)(0x40u | i);
            fc_sv_i = 0;
            fc_save_slot = fc_sv[0] & 0x3Fu;
            fc_msg[0] = 0;
            fc_go(PG_SAVE);
        } else {
            fc_app_panic();
            if (fc_user_save(fc_save_slot, &fc_set) == 0) {
                fc_g.cur_set = (uint8_t)fc_save_slot;
                fc_dirty = 0;
                fc_globals_save();
                fc_changed(FC_CH_SAVED);
                fc_go(PG_PLAY);
                fc_flash("SAVED");
            } else
                fc_flash("SAVE FAILED");
        }
        break;
    default: break;
    }
}

void fc_app_input(void)
{
    uint32_t keys = plat_keys(), btn = plat_buttons(), now = plat_ms(), k, ch;
    int32_t d;
    /* keys */
    ch = keys ^ fc_keys_prev;
    for (k = 0; ch && k < FC_NKEYS; k++)
        if (ch & (1u << k)) {
            int down = (keys >> k) & 1u;
            if (fc_page == PG_LEARN) {
                fc_learn_key(k, down);
                continue;
            }
            if (down && fc_aud_key != 0xFFu) {   /* a key cuts a running audition */
                fc_lock();
                fc_player_key(&fc_pl, &fc_set, fc_aud_key, 0);
                fc_unlock();
                fc_aud_key = 0xFFu;
            }
            fc_lock();
            fc_player_key(&fc_pl, &fc_set, k, down ? fc_g.velocity : 0u);
            fc_unlock();
            if (down) {
                fc_sel = k;
                fc_touch();
            }
        }
    fc_keys_prev = keys;
    if (fc_page == PG_GLOBAL2 && now - fc_cpu_t >= 250u) {   /* the load figures, four times a second */
        uint32_t sig = fc_cpu_now | fc_cpu_peak << 8 | fc_cpu_cap << 16 | fc_cpu_drops << 20;
        fc_cpu_t = now;
        if (sig != fc_cpu_shown) {
            fc_cpu_shown = sig;
            fc_touch();
        }
    }
    if (fc_aud_key != 0xFFu && (int32_t)(now - fc_aud_until) >= 0) {
        if (!fc_set.play.latch) {
            fc_lock();
            fc_player_key(&fc_pl, &fc_set, fc_aud_key, 0);
            fc_unlock();
        }
        fc_aud_key = 0xFFu;
    }
    /* buttons: on press (OCT- and OCT+ together are the platform's, held for update mode) */
    ch = btn & ~fc_btn_prev;
    fc_btn_prev = btn;
    if ((btn & ((1u << B_OCTDN) | (1u << B_OCTUP))) != ((1u << B_OCTDN) | (1u << B_OCTUP)))
        for (k = 0; k < NB; k++)
            if (ch & (1u << k)) {
                if (fc_page == PG_SAVE && k != B_SAVE) {
                    fc_go(PG_PLAY);              /* any other button: no save */
                    fc_flash("NOT SAVED");
                    continue;
                }
                fc_button(k);
            }
    /* encoders */
    if ((d = plat_enc(EN_PRESET)) != 0)
        fc_pturn(fc_page == PG_SAVE ? P_SLOT : P_SET, d);
    if ((d = plat_enc(EN_SELECT)) != 0) {
        fc_sel = (uint32_t)lim32((int32_t)fc_sel + d, 0, FC_NKEYS - 1);
        if (fc_page == PG_PLAY)
            fc_go(PG_EDIT);
        fc_touch();
    }
    if ((d = plat_enc(EN_ALGO)) != 0)
        fc_pturn(P_TEMPO, d);
    for (k = 0; k < 4u; k++)
        if ((d = plat_enc(EN_K1 + (int)k)) != 0) {
            uint32_t p = FC_PAGE_P[fc_page][k];
            if (p != P_NONE) {
                fc_pturn(p, d);
                fc_knob_hit = (int32_t)k;
                fc_knob_until = now + 1200u;
            }
        }
    if (fc_knob_hit >= 0 && (int32_t)(now - fc_knob_until) >= 0) {
        fc_knob_hit = -1;
        fc_touch();
    }
    if (fc_msg[0] && (int32_t)(now - fc_msg_until) >= 0) {
        fc_msg[0] = 0;
        fc_touch();
    }
    if (fc_clock_seen && now - fc_clock_ms > 500u)
        fc_clock_seen = 0;
    if (fc_rev != fc_rev_sent && now - fc_rev_ms >= 120u) {   /* tell the editor (live sync): F0 7D 46 4C 48 ... */
        uint8_t ev[10] = {0xF0, 0x7D, 0x46, 0x4C, 48, 0, 0, 0, 0, 0xF7};
        ev[5] = (uint8_t)(fc_rev_kind & 0x7Fu);
        ev[6] = (uint8_t)(fc_g.cur_set >> 7);
        ev[7] = (uint8_t)(fc_g.cur_set & 0x7Fu);
        ev[8] = fc_dirty;
        fc_wire(ev, sizeof ev);
        fc_rev_sent = fc_rev;
        fc_rev_kind = 0;
    }
    {   /* the lights: keys with a chord dim, the sounding one bright; LATCH, V.LEAD, OCT, the page's button */
        uint32_t lit = 0, kl = 0;
        if (fc_page == PG_LEARN)
            kl = fc_ln_held;
        else if (fc_pl.key >= 0)
            kl = 1u << fc_pl.key;
        if (fc_set.play.latch)
            lit |= 1u << B_LFO;
        if (fc_set.play.voice_lead)
            lit |= 1u << B_SEL;
        if (fc_set.play.octave < 0)
            lit |= 1u << B_OCTDN;
        if (fc_set.play.octave > 0)
            lit |= 1u << B_OCTUP;
        if (fc_page == PG_PLAY) lit |= 1u << B_HOME;
        if (fc_page == PG_EDIT || fc_page == PG_EDIT2) lit |= 1u << B_EDIT;
        if (fc_page == PG_SOUND || fc_page == PG_AMP) lit |= 1u << B_ENV;
        if (fc_page == PG_FX) lit |= 1u << B_FX;
        if (fc_page == PG_MODE || fc_page == PG_ARP) lit |= 1u << B_ARP;
        if (fc_page == PG_GLOBAL || fc_page == PG_GLOBAL2) lit |= 1u << B_GLO;
        if (fc_page == PG_SAVE) lit |= 1u << B_SAVE;
        if (fc_page == PG_LEARN) lit |= 1u << B_REC;
        plat_keys_dim(fc_page == PG_LEARN ? 0u : fc_set_used_keys(&fc_set));
        plat_leds(lit, kl);
    }
}

/* ------------------------------------------------------------------------------------------------ screen --- */
/* Light, as the editor: warm white, near-black text, big type (the chord's name 50 px). */
/* 0.8: dark, module-panel look (like the editor): near-black, light text, one cyan accent */
#define FC_BG RGB(27, 29, 32)
#define FC_HDR RGB(40, 44, 49)
#define FC_INK RGB(236, 238, 240)
#define FC_SOFT RGB(163, 169, 177)
#define FC_HIT RGB(22, 64, 72)
#define FC_LINE RGB(58, 63, 69)
#define FC_ACC RGB(60, 200, 220)
#define FC_DARK RGB(14, 16, 18)                  /* text on the coloured rating bands */
static const uint16_t FC_TIER_COL[3] = {RGB(61, 220, 132), RGB(255, 176, 32), RGB(255, 90, 79)};
static const char *const FC_TIER_S[3] = {"STRONG", "OK", "FAR"};

/* the chord on the nearest key below k that has one, or 0 */
static const fc_chord_t *fc_prev_chord(uint32_t k)
{
    while (k-- > 0u)
        if (fc_set.ch[k].quality != FC_EMPTY)
            return &fc_set.ch[k];
    return 0;
}

static void fc_center(int32_t y, const felucca_font_t *f, const char *s, uint16_t c)
{
    cv_text((240 - text_w(f, s)) / 2, y, f, s, c);
}

void fc_app_draw(int force)
{
    char name[24], b[32];
    const fc_chord_t *c;
    uint32_t i, k, show;
    int32_t y;
    if (!force && fc_drawn == fc_ver)
        return;
    fc_drawn = fc_ver;
    show = fc_pl.key >= 0 ? (uint32_t)fc_pl.key : fc_sel % FC_NKEYS;
    if (fc_page != PG_PLAY && fc_page != PG_LEARN)
        show = fc_sel % FC_NKEYS;                /* the edit pages: the key being edited */
    c = &fc_set.ch[show];
    /* ---- top half: the set, the page, the chord's name ---- */
    cv_begin(240, 120, FC_BG);
    cv_rect(0, 0, 240, 30, FC_HDR);
    for (i = 0; i < 16u && fc_set.name[i]; i++)
        name[i] = fc_set.name[i];
    name[i] = 0;
    if (fc_dirty && i < 16u) {
        name[i++] = '*';
        name[i] = 0;
    }
    cv_text(6, 7, &FONT_B, name, FC_INK);
    cv_rect(0, 30, 240, 2, FC_ACC);
    cv_text(234 - text_w(&FONT_B, FC_PG_NAME[fc_page]), 7, &FONT_B, FC_PG_NAME[fc_page], FC_ACC);
    if (fc_page == PG_LEARN) {
        fc_center(40, &FONT_M, "PLAY THE NOTES", FC_INK);
        if (fc_ln_n) {
            fc_chord_t t;
            fc_chord_identify(fc_ln_notes, fc_ln_n, &t);
            fc_chord_name(&t, b, sizeof b);
            fc_center(72, text_w(&FONT_XL, b) <= 232 ? &FONT_XL : &FONT_B, b, FC_INK);
        } else
            fc_center(78, &FONT_B, "THEN LET GO", FC_SOFT);
    } else if (fc_page == PG_SAVE) {             /* OVERWRITE? / SAVE AS NEW / REPLACE?, then the slot, big */
        uint32_t e = fc_sv_n ? fc_sv[fc_sv_i] : 0u;
        fc_center(38, &FONT_M, e & 0x80u ? "OVERWRITE" : e & 0x40u ? "REPLACE" : "SAVE AS NEW", FC_INK);
        fc_ptext(P_SLOT, b);
        fc_center(66, &FONT_XL, b, FC_INK);
    } else {
        fc_chord_name(c, b, sizeof b);
        if (!b[0])
            fc_cpy(b, "--");
        y = 34 + (84 - (int32_t)FONT_XL.h) / 2;
        if (text_w(&FONT_XL, b) <= 236)
            fc_center(y, &FONT_XL, b, FC_INK);
        else
            fc_center(60, &FONT_M, b, FC_INK);
    }
    cv_blit(0, 0);
    /* ---- bottom half: inversion and voicing, octave, the four knobs ---- */
    cv_begin(240, 120, FC_BG);
    if (fc_msg[0]) {
        cv_rect(0, 2, 240, 30, FC_HIT);
        fc_center(5, &FONT_M, fc_msg, FC_INK);
    } else if (fc_page == PG_LEARN) {
        b[0] = 0;
        for (i = 0, k = 0; i < fc_ln_n && k < 26u; i++) {
            const char *n = fc_note_name(fc_ln_notes[i]);
            if (k)
                b[k++] = ' ';
            while (*n && k < 30u)
                b[k++] = *n++;
            b[k] = 0;
        }
        fc_center(6, &FONT_B, b[0] ? b : "-", FC_SOFT);
    } else if (fc_page == PG_SAVE) {
        static fc_set_t t;
        if (fc_user_load(fc_save_slot, &t) == 0) {
            for (i = 0; i < 16u && t.name[i]; i++)
                b[i] = t.name[i];
            b[i] = 0;
            fc_center(5, &FONT_M, b, FC_INK);            /* what is there now */
        } else
            fc_center(5, &FONT_M, "EMPTY SLOT", FC_SOFT);
    } else if (c->quality == FC_EMPTY) {
        fc_cpy(b, "KEY ");
        fc_num(b + 4, (int32_t)show + 1, 0);
        fc_center(5, &FONT_M, b, FC_SOFT);
    } else {
        fc_ptext(P_INV, b);
        k = 0;
        while (b[k])
            k++;
        if (c->inversion) {
            fc_cpy(b + k, " INV");
            k += 4;
        } else {
            fc_cpy(b, "ROOT POS");
            k = 8;
        }
        b[k++] = ' ';
        b[k++] = ' ';
        fc_cpy(b + k, fc_voicing_name(c->voicing));
        fc_center(5, &FONT_M, b, FC_INK);
    }
    /* octave line: OCT +1  TR -2  LATCH  VL */
    fc_cpy(b, "OCT ");
    fc_num(b + 4, fc_set.play.octave, 1);
    k = 0;
    while (b[k])
        k++;
    if (fc_set.play.transpose) {
        fc_cpy(b + k, "  TR ");
        fc_num(b + k + 5, fc_set.play.transpose, 1);
        while (b[k])
            k++;
    }
    if (fc_set.play.latch) {
        fc_cpy(b + k, "  LATCH");
        k += 7;
    }
    if (fc_set.play.voice_lead) {
        fc_cpy(b + k, "  VL");
        k += 4;
    }
    if (fc_page == PG_SAVE)                      /* the octave line is no use here: how to answer instead */
        fc_cpy(b, fc_sv_n > 1u ? "SAVE YES  K1 OTHER" : "PRESS SAVE");
    if ((fc_page == PG_EDIT || fc_page == PG_EDIT2) && c->quality != FC_EMPTY) {
        /* how this chord follows the one on the key before: green STRONG, amber OK, red FAR (the editor's rating) */
        const fc_chord_t *pv = fc_prev_chord(show);
        if (pv) {
            uint32_t t = fc_rate_tier(c, pv, fc_set.key_root, fc_set.key_scale, 1);
            char pn[24];
            fc_chord_name(pv, pn, sizeof pn);
            fc_cpy(b, FC_TIER_S[t]);
            k = 0;
            while (b[k])
                k++;
            fc_cpy(b + k, "  AFTER ");
            k += 8;
            for (i = 0; pn[i] && k < 30u; i++)
                b[k++] = pn[i];
            b[k] = 0;
            cv_rect(0, 33, 240, 29, FC_TIER_COL[t]);
            fc_center(36, text_w(&FONT_M, b) <= 236 ? &FONT_M : &FONT_B, b, FC_DARK);
        } else
            fc_center(36, &FONT_M, "FIRST CHORD", FC_SOFT);
    } else
        fc_center(36, &FONT_M, b, fc_page == PG_SAVE ? FC_SOFT : FC_INK);
    cv_rect(0, 64, 240, 2, FC_LINE);
    for (i = 0; i < 4u; i++) {
        uint32_t p = FC_PAGE_P[fc_page][i];
        int32_t x = (int32_t)i * 60;
        if (p == P_NONE)
            continue;
        if ((int32_t)i == fc_knob_hit)
            cv_rect(x + 1, 68, 58, 50, FC_HIT);
        cv_text(x + (60 - text_w(&FONT_XS, fc_plabel(p))) / 2, 72, &FONT_XS, fc_plabel(p), FC_SOFT);
        fc_ptext(p, b);
        cv_text(x + (60 - text_w(&FONT_B, b)) / 2, 92, &FONT_B, b, (int32_t)i == fc_knob_hit ? FC_ACC : FC_INK);
    }
    cv_blit(0, 120);
}

/* --------------------------------------------------------------------------------------------- the audio --- */
void fc_app_render(int32_t *lr, uint32_t n)
{
    uint32_t i;
    if (n > 128u)
        n = 128u;
    {                                            /* the synth's tempo (synced LFOs, delay): MIDI clock's or the set's */
        float bpm = fc_g.clock && fc_clock_seen && fc_clock_bpm > 0.f ? fc_clock_bpm : (float)fc_set.tempo;
        float dt = bpm - fc_syn.tempo;
        if (dt > 0.5f || dt < -0.5f)
            fc_synth_tempo(&fc_syn, bpm);
    }
    fc_player_run(&fc_pl, &fc_set, n, fc_g.clock && fc_clock_seen);
    fc_synth_render(&fc_syn, fc_fbuf, n);
    for (i = 0; i < 2u * n; i++)
        lr[i] = (int32_t)(fc_fbuf[i] * 32767.f);
}

void fc_app_midi(uint8_t st, uint8_t d1, uint8_t d2)
{
    uint32_t t = st & 0xF0u, ch = st & 0x0Fu;
    int32_t k;
    if (fc_g.midi_in_ch < 16u && ch != fc_g.midi_in_ch)
        return;
    if (t != 0x90u && t != 0x80u)
        return;
    k = (int32_t)d1 - (int32_t)FC_KEY0_NOTE;      /* F3 is key 1: a MIDI keyboard plays the chord keys */
    if (k < 0 || k >= (int32_t)FC_NKEYS)
        return;
    fc_player_key(&fc_pl, &fc_set, (uint32_t)k, t == 0x90u ? d2 : 0u);
}

void fc_app_realtime(uint8_t b)
{
    if (b == 0xF8u) {
        uint32_t now = plat_ms();
        if (!fc_clock_seen || now - fc_clock_ms > 500u)
            fc_clock_n = 0;                      /* (re)started: count from here */
        if (fc_clock_n == 0u)
            fc_clock_t0 = now;
        if (++fc_clock_n == 25u) {               /* a quarter note: 24 ticks */
            if (now > fc_clock_t0)
                fc_clock_bpm = 60000.f / (float)(now - fc_clock_t0);
            fc_clock_n = 1;
            fc_clock_t0 = now;
        }
        fc_clock_seen = 1;
        fc_clock_ms = now;
        if (fc_g.clock)
            fc_player_clock(&fc_pl, &fc_set);
    }
}

void fc_app_panic(void)
{
    uint32_t n;
    fc_lock();
    fc_player_stop(&fc_pl);
    fc_synth_all_off(&fc_syn);
    fc_unlock();
    if (fc_g.output != 1u)
        fc_midi3(0xB0u | fc_g.midi_ch, 123, 0);  /* all notes off for the synths on MIDI out */
    for (n = 0; n < sizeof fc_ln_notes; n++)
        fc_ln_notes[n] = 0;
    fc_ln_n = fc_ln_held = 0;
    fc_aud_key = 0xFFu;
}

void fc_app_init(void)
{
    static const fc_out_t out = {fc_out_on, fc_out_off, 0};
    fc_synth_init(&fc_syn, fc_rv, fc_dly);
    fc_player_init(&fc_pl, &out);
    if (plat_store_load(OBJ_SOUND, &fc_g, sizeof fc_g) != (int)sizeof fc_g || fc_globals_check(&fc_g))
        fc_globals_init(&fc_g);
    fc_synth_voices(&fc_syn, fc_g.voices ? fc_g.voices : FC_VOICES);
    if (fc_load_set(fc_g.cur_set) && fc_load_set(FC_FACTORY0)) {
        fc_set_init(&fc_set, "EMPTY");           /* (only if the factory content were broken) */
        fc_synth_sound(&fc_syn, &fc_set.sound, &fc_set.sx, &fc_set.s3);
    }
    fc_touch();
}

#include "fc_editor.c"
