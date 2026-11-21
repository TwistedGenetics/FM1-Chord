/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the player. Keys in, notes out: the chord a key holds, with the octave buttons, the set's transpose,
 * auto voice leading, strum, the arpeggiator, latch and velocity humanise. It makes no sound: notes go to
 * fc_out_t (the app sends them to the synth and / or MIDI out). Time is counted in samples at 44.1 kHz.
 * web/editor/player.js is the same logic in JavaScript for the editor's preview. Copyright (C) 2026 Jamie. */
#pragma once
#include <stdint.h>
#include "fc_set.h"

#define FC_FS 44100u
#define FC_ARP_MAX 24u
#define FC_STRUM_MAX FC_MAXN

typedef struct {
    void (*on)(void *u, uint32_t note, uint32_t vel);
    void (*off)(void *u, uint32_t note);
    void *u;
} fc_out_t;

typedef struct {
    fc_out_t out;
    int32_t key;                    /* the key whose chord is playing (or latched), -1 none */
    uint32_t held;                  /* keys held, bit k */
    uint8_t notes[FC_MAXN];         /* the chord as it was placed (voice leading included) */
    uint32_t n, has_bass;
    uint8_t prev[FC_MAXN];          /* the last chord's upper notes, for voice leading */
    uint32_t nprev;
    int32_t prev_bass;
    int32_t prev_shift;             /* the set's octave and transpose it was played at (they move voice leading too) */
    uint8_t vel;
    uint32_t sounding[4];           /* notes on, bit per MIDI note */
    /* strum: notes still to start, and when */
    uint8_t st_note[FC_STRUM_MAX], st_vel[FC_STRUM_MAX];
    uint32_t st_at[FC_STRUM_MAX], st_n, st_alt;
    /* arpeggiator */
    uint8_t arp[FC_ARP_MAX];
    uint32_t arp_n, arp_i, arp_up;
    int32_t arp_note;               /* sounding arp note, -1 */
    uint32_t arp_phase, arp_off_at; /* samples into the step; when the note ends */
    uint32_t arp_ticks;             /* MIDI clock ticks into the step */
    uint32_t now;                   /* samples since start */
    uint32_t rng;
    uint32_t chord_count;           /* chords started (the display's change counter) */
} fc_player_t;

void fc_player_init(fc_player_t *p, const fc_out_t *out);
/* a key down (vel 1..127) or up (vel 0) */
void fc_player_key(fc_player_t *p, const fc_set_t *s, uint32_t key, uint32_t vel);
/* time moves on by frames samples; ext_clock: the arpeggiator steps on fc_player_clock instead */
void fc_player_run(fc_player_t *p, const fc_set_t *s, uint32_t frames, int ext_clock);
void fc_player_clock(fc_player_t *p, const fc_set_t *s);  /* one MIDI clock (24 per quarter) */
void fc_player_stop(fc_player_t *p);                      /* everything off, latch released */
void fc_player_release(fc_player_t *p);                   /* the chord off (e.g. the set changed) */
/* the chord as it would sound now (voice leading from the last one included), without playing it; returns n */
uint32_t fc_player_preview(const fc_player_t *p, const fc_set_t *s, uint32_t key, uint8_t *notes, uint32_t *has_bass);
