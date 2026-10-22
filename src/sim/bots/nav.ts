import { MOVEMENT } from '../../config/movement';
import type { MapData } from '../map/map-def';
import { bodyOverlaps } from '../physics/body';
import type { Bvh } from '../physics/bvh';

/**
 * Walkability grid + A*. Each cell stores the floor height at its centre;
 * neighbours connect when the height difference is climbable. Pure TS and
 * deterministic (fixed neighbour order, index tie-breaks), so the same path
 * is produced in the browser and in headless self-play.
 */
export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

/** highest floor surface (9 levels × 0.4 m) */
const MAX_FLOOR = 3.65;

const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export class NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly minX: number;
  readonly minZ: number;
  /** floor height per cell, NaN = blocked */
  readonly height: Float64Array;
  /** connected-component id per cell (-1 blocked) */
  readonly component: Int32Array;

  // A* scratch
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;

  constructor(
    readonly map: MapData,
    readonly bvh: Bvh,
    cell = 1,
  ) {
    this.cell = cell;
    this.minX = map.bounds.minX;
    this.minZ = map.bounds.minZ;
    this.cols = Math.round((map.bounds.maxX - map.bounds.minX) / cell);
    this.rows = Math.round((map.bounds.maxZ - map.bounds.minZ) / cell);
    const n = this.cols * this.rows;
    this.height = new Float64Array(n).fill(NaN);
    this.component = new Int32Array(n).fill(-1);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.build();
  }

  private build(): void {
    const probe = { x: 0, y: 0, z: 0, radius: MOVEMENT.bodyRadius + 0.08, height: MOVEMENT.standHeight - 0.05 };
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + (c + 0.5) * this.cell;
        const z = this.minZ + (r + 0.5) * this.cell;
        const y = this.floorAt(x, z);
        if (y === null) continue;
        probe.x = x;
        probe.y = y + 0.02;
        probe.z = z;
        if (bodyOverlaps(this.bvh, probe)) continue;
        this.height[r * this.cols + c] = y;
      }
    }
    // flood fill components
    let comp = 0;
    const stack: number[] = [];
    for (let i = 0; i < this.height.length; i++) {
      if (Number.isNaN(this.height[i]) || this.component[i] >= 0) continue;
      this.component[i] = comp;
      stack.push(i);
      while (stack.length) {
        const cur = stack.pop()!;
        this.forEachNeighbour(cur, (nb) => {
          if (this.component[nb] < 0) {
            this.component[nb] = comp;
            stack.push(nb);
          }
        });
      }
      comp++;
    }
  }

  /**
   * Height of the walkable floor at (x, z), or null. Floors go up to 3.6 m
   * (level 9); anything higher is a roof, lintel or wall top, so the probe
   * continues below it.
   */
  private floorAt(x: number, z: number): number | null {
    let from = MAX_FLOOR + 1;
    for (let k = 0; k < 4; k++) {
      const hit = this.bvh.raycast(x, from, z, 0, -1, 0, from + 2);
      if (!hit) return null;
      const top = from - hit.t;
      if (top <= MAX_FLOOR) return top;
      from = hit.collider.minY - 0.01;
      if (from < 0) return null;
    }
    return null;
  }

  private forEachNeighbour(i: number, fn: (nb: number, cost: number) => void): void {
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    const h = this.height[i];
    for (const [dc, dr, cost] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const nb = nr * this.cols + nc;
      const nh = this.height[nb];
      if (Number.isNaN(nh) || Math.abs(nh - h) > MOVEMENT.stepHeight) continue;
      if (dc !== 0 && dr !== 0) {
        // no corner cutting
        const a = r * this.cols + nc;
        const b = nr * this.cols + c;
        if (Number.isNaN(this.height[a]) || Number.isNaN(this.height[b])) continue;
      }
      fn(nb, cost * this.cell);
    }
  }

  index(x: number, z: number): number {
    const c = Math.floor((x - this.minX) / this.cell);
    const r = Math.floor((z - this.minZ) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  centre(i: number): NavPoint {
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    return { x: this.minX + (c + 0.5) * this.cell, y: this.height[i], z: this.minZ + (r + 0.5) * this.cell };
  }

  walkable(i: number): boolean {
    return i >= 0 && !Number.isNaN(this.height[i]);
  }

  /** Nearest walkable cell to (x, z), searching outward in rings. */
  nearestWalkable(x: number, z: number, preferComponent = -1): number {
    const start = this.index(x, z);
    if (this.walkable(start) && (preferComponent < 0 || this.component[start] === preferComponent)) return start;
    const c0 = Math.floor((x - this.minX) / this.cell);
    const r0 = Math.floor((z - this.minZ) / this.cell);
    for (let ring = 1; ring < 12; ring++) {
      let best = -1;
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const i = r * this.cols + c;
          if (!this.walkable(i)) continue;
          if (preferComponent >= 0 && this.component[i] !== preferComponent) continue;
          const d = dr * dr + dc * dc;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** A* from world point to world point. Returns smoothed waypoints (excluding start). */
  findPath(from: NavPoint, to: NavPoint): NavPoint[] | null {
    const s = this.nearestWalkable(from.x, from.z);
    if (s < 0) return null;
    const t = this.nearestWalkable(to.x, to.z, this.component[s]);
    if (t < 0) return null;
    const raw = this.astar(s, t);
    if (!raw) return null;
    return this.smooth(from, raw.map((i) => this.centre(i)));
  }

  private astar(start: number, goal: number): number[] | null {
    this.search++;
    const S = this.search;
    const goalC = goal % this.cols;
    const goalR = (goal - goalC) / this.cols;
    const heur = (i: number): number => {
      const c = i % this.cols;
      const r = (i - c) / this.cols;
      const dx = Math.abs(c - goalC);
      const dz = Math.abs(r - goalR);
      return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * this.cell;
    };
    const heap = new MinHeap();
    this.g[start] = 0;
    this.stamp[start] = S;
    this.parent[start] = -1;
    heap.push(start, heur(start));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) {
        const path: number[] = [];
        for (let i = goal; i >= 0; i = this.parent[i]) path.push(i);
        return path.reverse();
      }
      if (this.closed[cur] === S) continue;
      this.closed[cur] = S;
      const gc = this.g[cur];
      this.forEachNeighbour(cur, (nb, cost) => {
        if (this.closed[nb] === S) return;
        const ng = gc + cost;
        if (this.stamp[nb] !== S || ng < this.g[nb] - 1e-9) {
          this.stamp[nb] = S;
          this.g[nb] = ng;
          this.parent[nb] = cur;
          heap.push(nb, ng + heur(nb));
        }
      });
    }
    return null;
  }

  /** Clear line for a walking body between two points (two parallel rays at knee and chest height). */
  clearWalk(a: NavPoint, b: NavPoint): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return true;
    if (Math.abs(b.y - a.y) > 0.05) {
      // height changes: require every cell along the line to be walkable and climbable
      const steps = Math.ceil(len / (this.cell * 0.5));
      let prevH = a.y;
      for (let k = 1; k <= steps; k++) {
        const i = this.index(a.x + (dx * k) / steps, a.z + (dz * k) / steps);
        if (!this.walkable(i)) return false;
        if (Math.abs(this.height[i] - prevH) > MOVEMENT.stepHeight) return false;
        prevH = this.height[i];
      }
    }
    const nx = -dz / len;
    const nz = dx / len;
    const r = MOVEMENT.bodyRadius + 0.05;
    const y = Math.max(a.y, b.y);
    for (const off of [-r, r]) {
      for (const h of [0.5, 1.2]) {
        const ox = a.x + nx * off;
        const oz = a.z + nz * off;
        if (this.bvh.raycast(ox, y + h, oz, dx / len, 0, dz / len, len)) return false;
      }
    }
    // also make sure no gap/drop in between
    const steps = Math.ceil(len / this.cell);
    for (let k = 1; k < steps; k++) {
      if (!this.walkable(this.index(a.x + (dx * k) / steps, a.z + (dz * k) / steps))) return false;
    }
    return true;
  }

  /** String-pulling: keep the furthest directly reachable waypoint. */
  private smooth(from: NavPoint, pts: NavPoint[]): NavPoint[] {
    const out: NavPoint[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearWalk(anchor, pts[j])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}

/** Binary min-heap of (index, priority) with index tie-break for determinism. */
class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(i: number, p: number): void {
    this.idx.push(i);
    this.pri.push(p);
    let k = this.idx.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (this.less(k, parent)) {
        this.swap(k, parent);
        k = parent;
      } else break;
    }
  }

  pop(): number {
    const top = this.idx[0];
    const lastI = this.idx.pop()!;
    const lastP = this.pri.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = lastI;
      this.pri[0] = lastP;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < this.idx.length && this.less(l, m)) m = l;
        if (r < this.idx.length && this.less(r, m)) m = r;
        if (m === k) break;
        this.swap(k, m);
        k = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.pri[a] < this.pri[b] || (this.pri[a] === this.pri[b] && this.idx[a] < this.idx[b]);
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a];
    this.idx[a] = this.idx[b];
    this.idx[b] = ti;
    const tp = this.pri[a];
    this.pri[a] = this.pri[b];
    this.pri[b] = tp;
  }
}
