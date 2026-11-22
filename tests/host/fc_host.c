/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord on the host: the app (src/app/fc_app.c) with the synth and the player, against a simulated FM-1 driven
 * by a script, as DREADNOUGHT's dn_host and X0X's x0x_host do. The screen goes to PPM pictures (run_host.sh turns
 * them into PNGs), the sound to WAV, and `expect` lines check the state. Copyright (C) 2026 Jamie (TwistedGenetics);
 * the screen stubs follow X0X's host/x0x_host.c (Charles Vestal, GPL-3.0-only).
 *
 *   fc_host SCRIPT [OUTDIR]
 *
 *   wait MS | press BTN | release BTN | tap BTN | key K down|up | tapkey K MS | turn ENC N
 *   midi B0 B1 B2 | sysex HEX... (an editor frame; the reply is kept for expect reply)
 *   wav FILE | wavstop | shot FILE.ppm | reboot
 *   expect WHAT VALUE     page set key oct notes (sounding notes) voices dirty midiout reply.N (byte N of the last
 *                         reply after the header) peak (Q15 since the last expect peak; VALUE "<N" / ">N")
 */
#define X0X_HOST 1
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#define __attribute__(x)

/* ---- screen ---- */
static uint16_t fb[240 * 240];
static void lcd_sync(void) {}
static void lcd_blit(uint32_t x, uint32_t y, uint32_t w, uint32_t h, const uint16_t *px)
{
    uint32_t i, j;
    for (j = 0; j < h; j++)
        for (i = 0; i < w; i++)
            if (x + i < 240u && y + j < 240u)
                fb[(y + j) * 240u + x + i] = px[j * w + i];
}
#include "../../x0x-firmware/firmware/src/gfx.c"
#undef __attribute__

/* ---- platform ---- */
#include "../../x0x-firmware/firmware/src/app/plat.h"
static uint32_t now_ms, held_btn, held_keys, lit_btn, lit_keys, dim_keys, midi_out_n, midi_notes_on;
static int32_t enc_acc[NE];
uint32_t plat_ms(void) { return now_ms; }
uint32_t plat_buttons(void) { return held_btn; }
uint32_t plat_keys(void) { return held_keys; }
int32_t plat_enc(int role)
{
    int32_t v = enc_acc[role];
    enc_acc[role] = 0;
    return v;
}
void plat_keys_dim(uint32_t k) { dim_keys = k; }
void plat_leds(uint32_t b, uint32_t k)
{
    lit_btn = b;
    lit_keys = k;
}
void plat_midi_out(uint32_t pkt)
{
    midi_out_n++;
    if (((pkt >> 8) & 0xF0u) == 0x90u && (pkt >> 24))
        midi_notes_on++;
}
static uint8_t store[OBJ_NOBJ][PLAT_STORE_MAX];
static int store_len[OBJ_NOBJ] = {-1, -1, -1, -1, -1, -1, -1};
int plat_store_load(uint32_t obj, void *dst, uint32_t max)
{
    int n;
    if (obj >= OBJ_NOBJ || (n = store_len[obj]) < 0)
        return -1;
    if ((uint32_t)n > max)
        n = (int)max;
    memcpy(dst, store[obj], (size_t)n);
    return n;
}
int plat_store_save(uint32_t obj, const void *src, uint32_t len)
{
    if (obj >= OBJ_NOBJ || len > PLAT_STORE_MAX)
        return -1;
    memcpy(store[obj], src, len);
    store_len[obj] = (int)len;
    return 0;
}
static void fc_lock(void) {}
static void fc_unlock(void) {}
static uint32_t evt_n, evt_kind;
static void fc_wire(const uint8_t *p, uint32_t n)
{
    if (n >= 10u && p[4] == 48u) {
        evt_n++;
        evt_kind |= p[5];
    }
}
#define FC_VERSION "HOST"

#include "../../src/app/fc_app.c"

/* ---- the run ---- */
static int fails;
static FILE *wavf;
static uint32_t wav_frames;
static int32_t peak;
static uint8_t reply[700];
static uint32_t reply_n;
static void put_reply(uint32_t v)
{
    if (reply_n < sizeof reply)
        reply[reply_n++] = (uint8_t)(v & 0x7Fu);
}
static void run_ms(uint32_t ms)
{
    static int32_t lr[2 * 128];
    static uint32_t frac;
    uint32_t t;
    for (t = 0; t < ms; t++) {
        frac += 44100u;
        while (frac >= 1000u * 128u) {             /* a block of 128 every 2.9 ms */
            uint32_t i;
            frac -= 1000u * 128u;
            fc_app_render(lr, 128);
            for (i = 0; i < 256u; i++) {
                int32_t a = lr[i] < 0 ? -lr[i] : lr[i];
                if (a > peak)
                    peak = a;
            }
            if (wavf) {
                for (i = 0; i < 256u; i++) {
                    int16_t s = (int16_t)(lr[i] > 32767 ? 32767 : lr[i] < -32768 ? -32768 : lr[i]);
                    fwrite(&s, 2, 1, wavf);
                }
                wav_frames += 128;
            }
        }
        now_ms++;
        if (t % 5u == 0u)
            fc_app_input();
        if (t % 33u == 0u)
            fc_app_draw(0);
    }
}
static void wav_hdr(FILE *f, uint32_t frames)
{
    uint32_t v, data = frames * 4u;
    uint16_t s;
    fseek(f, 0, SEEK_SET);
    fwrite("RIFF", 1, 4, f);
    v = 36u + data;
    fwrite(&v, 4, 1, f);
    fwrite("WAVEfmt ", 1, 8, f);
    v = 16;
    fwrite(&v, 4, 1, f);
    s = 1;
    fwrite(&s, 2, 1, f);
    s = 2;
    fwrite(&s, 2, 1, f);
    v = 44100;
    fwrite(&v, 4, 1, f);
    v = 176400;
    fwrite(&v, 4, 1, f);
    s = 4;
    fwrite(&s, 2, 1, f);
    s = 16;
    fwrite(&s, 2, 1, f);
    fwrite("data", 1, 4, f);
    fwrite(&data, 4, 1, f);
}
static void shot(const char *path)
{
    FILE *f = fopen(path, "wb");
    uint32_t i;
    if (!f)
        return;
    fc_app_draw(1);
    fprintf(f, "P6\n240 240\n255\n");
    for (i = 0; i < 240u * 240u; i++) {
        uint32_t c = fb[i], px = ((c >> 8) & 0xFFu) | ((c & 0xFFu) << 8);   /* stored byte-swapped */
        uint8_t rgb[3] = {(uint8_t)(((px >> 11) & 31u) * 255u / 31u), (uint8_t)(((px >> 5) & 63u) * 255u / 63u),
                          (uint8_t)((px & 31u) * 255u / 31u)};
        fwrite(rgb, 1, 3, f);
    }
    fclose(f);
}
static int btn_id(const char *s)
{
    static const char *const N[NB] = {"FX", "SEL", "ENV", "LFO", "EDIT", "GLO", "HOME", "SAVE", "ARP", "SEQ",
                                      "PLAY", "REC", "OCT-", "OCT+"};
    int i;
    for (i = 0; i < (int)NB; i++)
        if (!strcmp(s, N[i]))
            return i;
    fprintf(stderr, "unknown button %s\n", s);
    exit(2);
}
static int enc_id(const char *s)
{
    static const char *const N[NE] = {"SELECT", "ALGO", "PRESET", "K1", "K2", "K3", "K4"};
    int i;
    for (i = 0; i < (int)NE; i++)
        if (!strcmp(s, N[i]))
            return i;
    fprintf(stderr, "unknown encoder %s\n", s);
    exit(2);
}
static int cmp(const char *want, long got)
{
    if (want[0] == '<')
        return got < atol(want + 1);
    if (want[0] == '>')
        return got > atol(want + 1);
    return got == atol(want);
}

int main(int argc, char **argv)
{
    char line[1024], path[512];
    const char *out = argc > 2 ? argv[2] : "build/host";
    FILE *sc;
    int ln = 0;
    if (argc < 2 || !(sc = fopen(argv[1], "r"))) {
        fprintf(stderr, "usage: fc_host SCRIPT [OUTDIR]\n");
        return 2;
    }
    fc_app_init();
    fc_app_draw(1);
    while (fgets(line, sizeof line, sc)) {
        char a[64] = "", b[64] = "", c[64] = "";
        ln++;
        if (line[0] == '#' || sscanf(line, "%63s %63s %63s", a, b, c) < 1)
            continue;
        if (!strcmp(a, "wait"))
            run_ms((uint32_t)atoi(b));
        else if (!strcmp(a, "press"))
            held_btn |= 1u << btn_id(b), run_ms(10);
        else if (!strcmp(a, "release"))
            held_btn &= ~(1u << btn_id(b)), run_ms(10);
        else if (!strcmp(a, "tap")) {
            held_btn |= 1u << btn_id(b);
            run_ms(20);
            held_btn &= ~(1u << btn_id(b));
            run_ms(20);
        } else if (!strcmp(a, "key")) {
            if (!strcmp(c, "down"))
                held_keys |= 1u << atoi(b);
            else
                held_keys &= ~(1u << atoi(b));
            run_ms(10);
        } else if (!strcmp(a, "tapkey")) {
            held_keys |= 1u << atoi(b);
            run_ms((uint32_t)atoi(c));
            held_keys &= ~(1u << atoi(b));
            run_ms(10);
        } else if (!strcmp(a, "turn")) {
            enc_acc[enc_id(b)] += atoi(c);
            run_ms(10);
        } else if (!strcmp(a, "midi")) {
            fc_app_midi((uint8_t)strtol(b, 0, 16), (uint8_t)strtol(c, 0, 16), (uint8_t)strtol(line + strlen(a) + strlen(b) + strlen(c) + 3, 0, 16));
            run_ms(5);
        } else if (!strcmp(a, "sysex")) {           /* the bytes after F0 7D 46 4C: cmd args (hex) */
            uint8_t f[700];
            uint32_t n = 0;
            char *p = line + 5;
            while (*p && n < sizeof f) {
                char *e;
                long v = strtol(p, &e, 16);
                if (e == p)
                    break;
                f[n++] = (uint8_t)v;
                p = e;
            }
            reply_n = 0;
            if (n && !fc_ed_cmd(f[0], f + 1, n - 1u, put_reply))
                reply_n = 0;
            run_ms(5);
        } else if (!strcmp(a, "wav")) {
            snprintf(path, sizeof path, "%s/%s", out, b);
            wavf = fopen(path, "wb");
            wav_frames = 0;
            if (wavf)
                wav_hdr(wavf, 0);
        } else if (!strcmp(a, "wavstop")) {
            if (wavf) {
                wav_hdr(wavf, wav_frames);
                fclose(wavf);
                wavf = 0;
            }
        } else if (!strcmp(a, "shot")) {
            snprintf(path, sizeof path, "%s/%s", out, b);
            shot(path);
        } else if (!strcmp(a, "oldstore")) {     /* the user sets as older versions saved them: oldstore 336 | 376 */
            static uint8_t t[PLAT_STORE_MAX];
            uint32_t o, i, sz = (uint32_t)atoi(b), ver = sz == FC_SET_BYTES_V1 ? 1u : 2u;
            for (o = OBJ_PAT0; o <= OBJ_PAT1; o++)
                if (store_len[o] == (int)(10u * FC_SET_BYTES)) {
                    for (i = 0; i < 10u; i++) {
                        memcpy(t + i * sz, store[o] + i * FC_SET_BYTES, sz);
                        if (t[i * sz] == 'F')
                            t[i * sz + 2u] = (uint8_t)ver;
                    }
                    memcpy(store[o], t, 10u * sz);
                    store_len[o] = (int)(10u * sz);
                }
        } else if (!strcmp(a, "reboot")) {
            fc_app_init();
            fc_page = PG_PLAY;
            run_ms(10);
        } else if (!strcmp(a, "expect")) {
            long got = 0;
            if (!strcmp(b, "page"))
                got = (long)fc_page;
            else if (!strcmp(b, "set"))
                got = fc_g.cur_set;
            else if (!strcmp(b, "key"))
                got = fc_pl.key;
            else if (!strcmp(b, "sel"))
                got = (long)fc_sel;
            else if (!strcmp(b, "version"))
                got = fc_set.version;
            else if (!strcmp(b, "tier")) {         /* the edit pages' rating of the key against the one before */
                const fc_chord_t *pv = fc_prev_chord(fc_sel % FC_NKEYS);
                got = pv ? (long)fc_rate_tier(&fc_set.ch[fc_sel % FC_NKEYS], pv, fc_set.key_root, fc_set.key_scale, 1) : -1;
            } else if (!strcmp(b, "fmode"))
                got = fc_set.sx.flt_mode;
            else if (!strcmp(b, "macro1"))
                got = fc_set.sx.macro[0];
            else if (!strcmp(b, "spread"))
                got = fc_set.s3.spread;
            else if (!strcmp(b, "dlymix"))
                got = fc_set.sx.dly_mix;
            else if (!strcmp(b, "tempo"))
                got = (long)(fc_syn.tempo + 0.5f);
            else if (!strcmp(b, "sound"))
                got = fc_set.sound.type;
            else if (!strcmp(b, "synthcut"))
                got = fc_syn.snd.cutoff;
            else if (!strcmp(b, "oct"))
                got = fc_set.play.octave;
            else if (!strcmp(b, "notes")) {
                uint32_t i;
                for (i = 0; i < 128u; i++)
                    got += (fc_pl.sounding[i >> 5] >> (i & 31u)) & 1u;
            } else if (!strcmp(b, "voices"))
                got = (long)fc_synth_active(&fc_syn);
            else if (!strcmp(b, "dirty"))
                got = fc_dirty;
            else if (!strcmp(b, "events")) {        /* live-sync frames sent since the last look */
                got = (long)evt_n;
                evt_n = 0;
            } else if (!strcmp(b, "eventkind")) {
                got = (long)evt_kind;
                evt_kind = 0;
            } else if (!strcmp(b, "midiout"))
                got = (long)midi_notes_on;
            else if (!strcmp(b, "slot"))
                got = (long)fc_save_slot;
            else if (!strcmp(b, "quality"))
                got = fc_set.ch[fc_sel % FC_NKEYS].quality;
            else if (!strcmp(b, "root"))
                got = fc_set.ch[fc_sel % FC_NKEYS].root;
            else if (!strcmp(b, "inv"))
                got = fc_set.ch[fc_sel % FC_NKEYS].inversion;
            else if (!strcmp(b, "replylen"))
                got = (long)reply_n;
            else if (!strncmp(b, "reply.", 6))
                got = reply[atoi(b + 6)];
            else if (!strcmp(b, "peak")) {
                got = peak;
                peak = 0;
            } else {
                fprintf(stderr, "%s:%d: unknown expect %s\n", argv[1], ln, b);
                return 2;
            }
            if (!cmp(c, got)) {
                printf("FAIL %s:%d: expect %s %s, got %ld\n", argv[1], ln, b, c, got);
                fails++;
            }
        } else {
            fprintf(stderr, "%s:%d: unknown command %s\n", argv[1], ln, a);
            return 2;
        }
    }
    fclose(sc);
    if (wavf) {
        wav_hdr(wavf, wav_frames);
        fclose(wavf);
    }
    printf(fails ? "FAIL %s: %d\n" : "ok   %s\n", argv[1], fails);
    return fails != 0;
}
