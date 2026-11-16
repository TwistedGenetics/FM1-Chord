/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: the app's entry points. src/hardware/fc_main_fm1.c calls them on the FM-1; tests/host/fc_host.c on
 * the host. Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>
#include "fc_set.h"
#include "fc_play.h"
#include "fc_synth.h"

void fc_app_init(void);                                  /* main loop, before the audio sounds */
void fc_app_render(int32_t *lr, uint32_t n);             /* audio interrupt: n stereo frames, Q15 in int32 */
void fc_app_midi(uint8_t st, uint8_t d1, uint8_t d2);    /* audio interrupt: a channel message in */
void fc_app_realtime(uint8_t b);                         /* audio interrupt: F8 clock, FA start, FB, FC stop */
void fc_app_input(void);                                 /* main loop: the panel */
void fc_app_draw(int force);                             /* main loop, ~30 a second */
void fc_app_panic(void);                                 /* everything off (an install is about to start) */
/* the editor's SysEx commands (src/app/fc_editor.c): 0 not ours, 1 a reply was put, 2 done without a reply */
int fc_ed_cmd(uint32_t cmd, const uint8_t *a, uint32_t na, void (*put)(uint32_t));
int fc_ed_long(uint32_t cmd);                            /* commands whose frames are long (handled in place) */
