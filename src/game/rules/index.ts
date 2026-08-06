/**
 * The rules chain.
 *
 * Modules are consulted **most-specific-first**, so an expansion can claim an
 * action before the base game sees it. Lifecycle hooks run in the opposite
 * order (base first) — `rules/base.ts` reverses this list when it fires them.
 *
 * ---------------------------------------------------------------------------
 * Adding an expansion
 * ---------------------------------------------------------------------------
 * Import your module and put it *above* the ones it overrides:
 *
 *     import { citiesKnightsRules } from './citiesKnights';
 *     import { seafarersRules } from './seafarers';
 *
 *     export const RULES_MODULES: RulesModule[] = [
 *       citiesKnightsRules,
 *       seafarersRules,
 *       baseRules,
 *     ];
 *
 * Two things your module can rely on:
 *
 *  - `ctx.modules` holds this list, already filtered to nothing — filter with
 *    `enabled(state)` yourself. It is how `base` fires lifecycle hooks without
 *    importing this file (which would be a cycle).
 *  - Interruptions belong in `state.pending`. Register the phase your pending
 *    kind maps to by adding it to `PENDING_PHASE` in `rules/base.ts`, and push
 *    a `{ kind: 'resume', data: { phase } }` entry behind it so `advancePhase`
 *    knows where to return to.
 *
 * Keep this file free of anything but imports and the array — it sits inside
 * the `legal.ts` → `base.ts` dependency triangle and is easy to make circular.
 */

import type { RulesModule } from '../engine';
import { baseRules } from './base';

export const RULES_MODULES: RulesModule[] = [baseRules];

export { baseRules };
