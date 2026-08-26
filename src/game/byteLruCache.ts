/** Byte-budgeted LRU for immutable payloads and GPU resources. */
export class ByteLruCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  constructor(private readonly maxBytes: number, private readonly onEvict: (value: T) => void = () => undefined) {}
  get(key: string) { const entry = this.entries.get(key); if (!entry) return undefined; this.entries.delete(key); this.entries.set(key, entry); return entry.value; }
  set(key: string, value: T, bytes: number) { const previous = this.entries.get(key); if (previous) { this.entries.delete(key); this.onEvict(previous.value); } this.entries.set(key, { value, bytes }); this.trim(); }
  delete(key: string) { const entry = this.entries.get(key); if (!entry) return false; this.entries.delete(key); this.onEvict(entry.value); return true; }
  has(key: string) { return this.entries.has(key); }
  clear() { for (const entry of this.entries.values()) this.onEvict(entry.value); this.entries.clear(); }
  get size() { return this.entries.size; }
  get bytes() { let total = 0; for (const entry of this.entries.values()) total += entry.bytes; return total; }
  private trim() { while (this.bytes > this.maxBytes && this.entries.size) this.delete(this.entries.keys().next().value!); }
}
