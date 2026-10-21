/** localStorage wrapper that never throws (private mode, quota, disabled storage). */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const memoryKV = (): KV => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

export function browserKV(): KV {
  try {
    const ls = window.localStorage;
    const probe = '__halcyon_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          /* quota or disabled */
        }
      },
    };
  } catch {
    return memoryKV();
  }
}

export function readJson<T>(kv: KV, key: string, fallback: T): T {
  const raw = kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
