/* SPDX-License-Identifier: GPL-3.0-only
 * FM1-Chord: how well a chord follows another, in the set's key: the editor's green "Strong" / amber "OK" /
 * red "Far" (web/editor/harmony.js rate(); tests/host/harmony_xcheck checks they agree). On the FM-1 it rates a
 * chord as you choose it against the chord on the key before.
 * Copyright (C) 2026 Jamie (TwistedGenetics). */
#pragma once
#include <stdint.h>
#include "fc_chord.h"

enum { FC_TIER_STRONG, FC_TIER_OK, FC_TIER_FAR };
/* cand after prev (prev empty: against the key's own tonic chord); bias: the dark jungle / DnB leaning */
uint32_t fc_rate_tier(const fc_chord_t *cand, const fc_chord_t *prev, uint32_t key_root, uint32_t scale, int bias);
