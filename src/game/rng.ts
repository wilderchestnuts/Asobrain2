/**
 * Deterministic seeded randomness.
 *
 * Every random draw the game makes is derived from `(seed, cursor)`, and the
 * cursor lives in the game state. That means the whole game is reproducible
 * from its seed plus its action log, which makes bugs replayable and lets the
 * server verify a result rather than trusting a client.
 */

/** xmur3 string hash, used to turn a seed string into 32 bits of entropy. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: small, fast, good enough for a board game. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A cursor-based random source. Advancing it is explicit, so callers must
 * write the new cursor back into the game state.
 */
export class Rng {
  private next: () => number;

  constructor(
    private seed: string,
    public cursor: number = 0,
  ) {
    this.next = mulberry32(hashSeed(seed) + cursor);
  }

  /** Float in [0, 1). */
  float(): number {
    this.cursor++;
    this.next = mulberry32(hashSeed(this.seed) + this.cursor);
    return this.next();
  }

  /** Integer in [0, max). */
  int(max: number): number {
    return Math.floor(this.float() * max);
  }

  /** A single die, 1..6. */
  die(): number {
    return this.int(6) + 1;
  }

  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Fisher-Yates, returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** Build an RNG positioned at the state's current cursor. */
export const rngFor = (seed: string, cursor: number): Rng =>
  new Rng(seed, cursor);
