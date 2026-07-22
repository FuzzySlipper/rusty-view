/**
 * Small in-memory LRU with both entry-count and approximate-weight bounds.
 *
 * Transcript caches use logical event/message units rather than retaining an
 * unbounded number of large projections. This is intentionally process-local:
 * external-agent transcript data must never cross the browser-persistence
 * boundary.
 */
export class WeightedLruCache<K, V> {
  private readonly entries = new Map<K, { value: V; weight: number }>();
  private currentWeight = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number,
  ) {
    if (maxEntries < 1 || maxWeight < 1) {
      throw new Error('WeightedLruCache bounds must be positive.');
    }
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, weight: number): void {
    const normalizedWeight = Math.max(1, Math.ceil(weight));
    this.delete(key);
    if (normalizedWeight > this.maxWeight) return;
    this.entries.set(key, { value, weight: normalizedWeight });
    this.currentWeight += normalizedWeight;
    this.evictToBounds();
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (entry === undefined) return false;
    this.currentWeight -= entry.weight;
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.currentWeight = 0;
  }

  private evictToBounds(): void {
    while (
      this.entries.size > this.maxEntries ||
      this.currentWeight > this.maxWeight
    ) {
      const oldestKey = this.entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) return;
      this.delete(oldestKey);
    }
  }
}
