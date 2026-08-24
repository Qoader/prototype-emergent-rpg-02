/** A small bounded LRU cache with optional read statistics. */
export class LruCache<T> {
  private readonly entries = new Map<string, T>();
  hits = 0;
  misses = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Cache capacity must be a positive integer');
  }

  get(key: string) {
    const value = this.entries.get(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    this.hits++;
    return value;
  }

  has(key: string) { return this.entries.has(key); }

  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }

  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}
