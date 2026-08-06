/**
 * Helpers for the resource/commodity bags players carry. Hands are plain
 * objects with optional keys, so every read goes through `count` and every
 * write returns a new object.
 */

import type { Hand, Tradeable } from './types';
import { COMMODITIES, RESOURCES } from './types';

export const ALL_TRADEABLES: Tradeable[] = [...RESOURCES, ...COMMODITIES];

export const count = (hand: Hand, what: Tradeable): number => hand[what] ?? 0;

export const totalCards = (hand: Hand): number =>
  ALL_TRADEABLES.reduce((sum, k) => sum + count(hand, k), 0);

export const isEmpty = (hand: Hand): boolean => totalCards(hand) === 0;

/** Every card in the hand, expanded one entry per card. */
export function toList(hand: Hand): Tradeable[] {
  const out: Tradeable[] = [];
  for (const k of ALL_TRADEABLES) {
    for (let i = 0; i < count(hand, k); i++) out.push(k);
  }
  return out;
}

export function fromList(cards: Tradeable[]): Hand {
  const out: Hand = {};
  for (const c of cards) out[c] = (out[c] ?? 0) + 1;
  return out;
}

/** Sum of two hands. */
export function add(a: Hand, b: Hand): Hand {
  const out: Hand = { ...a };
  for (const k of ALL_TRADEABLES) {
    const n = count(b, k);
    if (n) out[k] = count(out, k) + n;
  }
  return normalize(out);
}

/** `a` minus `b`. Does not check for sufficiency — call `canAfford` first. */
export function subtract(a: Hand, b: Hand): Hand {
  const out: Hand = { ...a };
  for (const k of ALL_TRADEABLES) {
    const n = count(b, k);
    if (n) out[k] = count(out, k) - n;
  }
  return normalize(out);
}

/** True when `hand` holds at least everything in `cost`. */
export const canAfford = (hand: Hand, cost: Hand): boolean =>
  ALL_TRADEABLES.every((k) => count(hand, k) >= count(cost, k));

/** Drop zero and negative entries so hands compare and serialise cleanly. */
export function normalize(hand: Hand): Hand {
  const out: Hand = {};
  for (const k of ALL_TRADEABLES) {
    const n = count(hand, k);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** True when every entry is non-negative. */
export const isValid = (hand: Hand): boolean =>
  ALL_TRADEABLES.every((k) => count(hand, k) >= 0);

export const scale = (hand: Hand, factor: number): Hand =>
  normalize(
    Object.fromEntries(
      ALL_TRADEABLES.map((k) => [k, count(hand, k) * factor]),
    ) as Hand,
  );
