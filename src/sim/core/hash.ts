/** Incremental FNV-1a (32-bit) over numbers' exact float64 bit patterns. */
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

export class StateHasher {
  private h = 0x811c9dc5;

  reset(): this {
    this.h = 0x811c9dc5;
    return this;
  }

  num(v: number): this {
    f64[0] = v;
    this.word(u32[0]);
    this.word(u32[1]);
    return this;
  }

  int(v: number): this {
    this.word(v >>> 0);
    return this;
  }

  bool(v: boolean): this {
    return this.int(v ? 1 : 0);
  }

  private word(w: number): void {
    let h = this.h;
    for (let i = 0; i < 4; i++) {
      h ^= (w >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
    this.h = h >>> 0;
  }

  digest(): number {
    return this.h >>> 0;
  }
}
