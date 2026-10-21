import { type AABB, type Collider, rayAABB, safeInv } from './aabb';

/**
 * Static AABB tree over the map's colliders. Built once with median splits;
 * nodes are stored in flat typed arrays for cache-friendly traversal.
 * Traversal order is fixed, so query results are deterministic.
 */
export class Bvh {
  private readonly bounds: Float64Array; // 6 per node
  private readonly left: Int32Array; // child index, or -1 for leaf
  private readonly right: Int32Array;
  private readonly start: Int32Array; // leaf: first item in `order`
  private readonly count: Int32Array; // leaf: item count
  private readonly order: Int32Array;
  private nodeCount = 0;
  /** colliders removed at runtime (destroyed cover), indexed by collider id */
  readonly disabled: Uint8Array;

  constructor(readonly items: readonly Collider[], private readonly leafSize = 4) {
    const maxNodes = Math.max(1, items.length * 2);
    this.bounds = new Float64Array(maxNodes * 6);
    this.left = new Int32Array(maxNodes).fill(-1);
    this.right = new Int32Array(maxNodes).fill(-1);
    this.start = new Int32Array(maxNodes);
    this.count = new Int32Array(maxNodes);
    this.order = new Int32Array(items.length);
    let maxId = 0;
    for (const it of items) maxId = Math.max(maxId, it.id);
    this.disabled = new Uint8Array(maxId + 1);
    for (let i = 0; i < items.length; i++) this.order[i] = i;
    if (items.length > 0) this.build(0, items.length);
    else this.nodeCount = 0;
  }

  private build(from: number, to: number): number {
    const node = this.nodeCount++;
    const b = this.bounds;
    const o = node * 6;
    b[o] = b[o + 1] = b[o + 2] = Infinity;
    b[o + 3] = b[o + 4] = b[o + 5] = -Infinity;
    for (let i = from; i < to; i++) {
      const it = this.items[this.order[i]];
      b[o] = Math.min(b[o], it.minX);
      b[o + 1] = Math.min(b[o + 1], it.minY);
      b[o + 2] = Math.min(b[o + 2], it.minZ);
      b[o + 3] = Math.max(b[o + 3], it.maxX);
      b[o + 4] = Math.max(b[o + 4], it.maxY);
      b[o + 5] = Math.max(b[o + 5], it.maxZ);
    }
    const n = to - from;
    if (n <= this.leafSize) {
      this.start[node] = from;
      this.count[node] = n;
      return node;
    }
    const ex = b[o + 3] - b[o];
    const ey = b[o + 4] - b[o + 1];
    const ez = b[o + 5] - b[o + 2];
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const centre = (c: Collider): number =>
      axis === 0 ? c.minX + c.maxX : axis === 1 ? c.minY + c.maxY : c.minZ + c.maxZ;
    const slice = Array.from(this.order.subarray(from, to));
    // Stable sort with id tie-break keeps the tree identical across engines.
    slice.sort((a, c) => centre(this.items[a]) - centre(this.items[c]) || this.items[a].id - this.items[c].id);
    this.order.set(slice, from);
    const mid = from + (n >> 1);
    this.left[node] = this.build(from, mid);
    this.right[node] = this.build(mid, to);
    return node;
  }

  private nodeOverlaps(node: number, q: AABB): boolean {
    const b = this.bounds;
    const o = node * 6;
    return (
      q.maxX >= b[o] && q.minX <= b[o + 3] && q.maxY >= b[o + 1] && q.minY <= b[o + 4] && q.maxZ >= b[o + 2] && q.minZ <= b[o + 5]
    );
  }

  /** Collect colliders whose bounds touch `q` (inclusive). */
  query(q: AABB, out: Collider[]): Collider[] {
    out.length = 0;
    if (this.nodeCount === 0) return out;
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (!this.nodeOverlaps(node, q)) continue;
      if (this.left[node] < 0) {
        const s = this.start[node];
        for (let i = 0; i < this.count[node]; i++) {
          const it = this.items[this.order[s + i]];
          if (this.disabled[it.id]) continue;
          if (q.maxX >= it.minX && q.minX <= it.maxX && q.maxY >= it.minY && q.minY <= it.maxY && q.maxZ >= it.minZ && q.minZ <= it.maxZ) {
            out.push(it);
          }
        }
      } else {
        stack.push(this.right[node], this.left[node]);
      }
    }
    return out;
  }

  /**
   * Nearest hit along a ray. `dir` need not be normalised; t is in units of
   * `dir`. `filter` may reject colliders (e.g. smoke-only or ignored ids).
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxT: number,
    filter?: (c: Collider) => boolean,
  ): { t: number; collider: Collider } | null {
    if (this.nodeCount === 0) return null;
    const idx = safeInv(dx);
    const idy = safeInv(dy);
    const idz = safeInv(dz);
    let bestT = maxT;
    let best: Collider | null = null;
    const stack = [0];
    const tmp: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    const b = this.bounds;
    while (stack.length) {
      const node = stack.pop()!;
      const o = node * 6;
      tmp.minX = b[o];
      tmp.minY = b[o + 1];
      tmp.minZ = b[o + 2];
      tmp.maxX = b[o + 3];
      tmp.maxY = b[o + 4];
      tmp.maxZ = b[o + 5];
      if (rayAABB(ox, oy, oz, idx, idy, idz, tmp, bestT) < 0) continue;
      if (this.left[node] < 0) {
        const s = this.start[node];
        for (let i = 0; i < this.count[node]; i++) {
          const it = this.items[this.order[s + i]];
          if (this.disabled[it.id]) continue;
          if (filter && !filter(it)) continue;
          const t = rayAABB(ox, oy, oz, idx, idy, idz, it, bestT);
          if (t >= 0 && (t < bestT || (t === bestT && best !== null && it.id < best.id))) {
            bestT = t;
            best = it;
          }
        }
      } else {
        stack.push(this.right[node], this.left[node]);
      }
    }
    return best ? { t: bestT, collider: best } : null;
  }
}
