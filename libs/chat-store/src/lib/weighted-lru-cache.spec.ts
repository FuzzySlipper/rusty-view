import { describe, expect, it } from 'vitest';

import { WeightedLruCache } from './weighted-lru-cache';

describe('WeightedLruCache', () => {
  it('evicts the least-recently-used entry at the count bound', () => {
    const cache = new WeightedLruCache<string, number>(2, 100);
    cache.set('a', 1, 1);
    cache.set('b', 2, 1);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3, 1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('evicts by approximate weight and rejects one oversized entry', () => {
    const cache = new WeightedLruCache<string, number>(10, 5);
    cache.set('a', 1, 3);
    cache.set('b', 2, 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    cache.set('oversized', 3, 6);
    expect(cache.get('oversized')).toBeUndefined();
  });
});
