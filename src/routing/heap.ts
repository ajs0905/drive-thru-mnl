/**
 * A binary min-heap of (priority, item) pairs in typed arrays, for the route searches:
 * O(log n) push and pop, no per-entry objects (a search on the BGC graph pushes a few
 * thousand entries; objects would be garbage for the collector mid-drive). Items are
 * integers (edge or node ids). Duplicates are allowed: a search skips stale entries
 * instead of decreasing keys ("lazy deletion"), which is simpler and as fast here.
 */
export class MinHeap {
  private keys: Float64Array;
  private items: Int32Array;
  size = 0;

  constructor(capacity = 256) {
    this.keys = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
  }

  clear() {
    this.size = 0;
  }

  push(key: number, item: number) {
    if (this.size === this.keys.length) this.grow();
    let i = this.size++;
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }

  /** Priority of the smallest entry (Infinity when empty). */
  peekKey(): number {
    return this.size ? this.keys[0] : Infinity;
  }

  /** Removes the smallest entry and returns its item (-1 when empty). */
  pop(): number {
    if (!this.size) return -1;
    const top = this.items[0];
    const n = --this.size;
    if (n > 0) {
      const key = this.keys[n];
      const item = this.items[n];
      // Sift down.
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.keys[c + 1] < this.keys[c]) c++;
        if (this.keys[c] >= key) break;
        this.keys[i] = this.keys[c];
        this.items[i] = this.items[c];
        i = c;
      }
      this.keys[i] = key;
      this.items[i] = item;
    }
    return top;
  }

  private grow() {
    const keys = new Float64Array(this.keys.length * 2);
    const items = new Int32Array(this.items.length * 2);
    keys.set(this.keys);
    items.set(this.items);
    this.keys = keys;
    this.items = items;
  }
}
