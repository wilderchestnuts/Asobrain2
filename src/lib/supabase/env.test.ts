/**
 * URL normalisation.
 *
 * These are not hypothetical inputs: the deployment that prompted this had
 * `https://<ref>.supabase.co/rest/v1/` pasted in, which the SDK turned into
 * `…/rest/v1/rest/v1/games` and the gateway rejected as an invalid path.
 */

import { describe, expect, it } from 'vitest';
import { normalizeSupabaseUrl } from './env';

describe('normalizeSupabaseUrl', () => {
  const origin = 'https://abcdefghijkl.supabase.co';

  it('leaves a correct project URL alone', () => {
    expect(normalizeSupabaseUrl(origin)).toBe(origin);
  });

  it('drops trailing slashes', () => {
    expect(normalizeSupabaseUrl(`${origin}/`)).toBe(origin);
    expect(normalizeSupabaseUrl(`${origin}//`)).toBe(origin);
  });

  it('strips a pasted REST endpoint', () => {
    expect(normalizeSupabaseUrl(`${origin}/rest/v1`)).toBe(origin);
    expect(normalizeSupabaseUrl(`${origin}/rest/v1/`)).toBe(origin);
  });

  it('strips the other service paths too', () => {
    for (const suffix of [
      'auth/v1',
      'storage/v1',
      'functions/v1',
      'graphql/v1',
      'realtime/v1',
    ]) {
      expect(normalizeSupabaseUrl(`${origin}/${suffix}`)).toBe(origin);
    }
  });

  it('ignores case in the service path', () => {
    expect(normalizeSupabaseUrl(`${origin}/REST/V1`)).toBe(origin);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSupabaseUrl(`  ${origin}  `)).toBe(origin);
  });

  it('handles missing values', () => {
    expect(normalizeSupabaseUrl(undefined)).toBe('');
    expect(normalizeSupabaseUrl('')).toBe('');
    expect(normalizeSupabaseUrl('   ')).toBe('');
  });

  it('does not eat a path that merely resembles a service path', () => {
    // A self-hosted instance behind a prefix is legitimate; only an exact
    // trailing service path is removed.
    expect(normalizeSupabaseUrl('https://example.com/rest/v1/extra')).toBe(
      'https://example.com/rest/v1/extra',
    );
  });

  it('produces a REST endpoint with no doubled segment', () => {
    const normalized = normalizeSupabaseUrl(`${origin}/rest/v1/`);
    const rest = new URL('rest/v1', `${normalized}/`).href;
    expect(rest).toBe(`${origin}/rest/v1`);
    expect(rest).not.toContain('rest/v1/rest');
  });
});
