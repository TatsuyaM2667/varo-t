import { describe, expect, it } from 'vitest';
import { type KvStore, StatsCore, estimate } from '../../server/stats-core';
import type { RoomSnapshot } from '../../src/net/room';

function memStore(): KvStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (ks) => ks.forEach((k) => data.delete(k)),
    list: async <T>({ prefix }: { prefix: string }) => new Map([...data].filter(([k]) => k.startsWith(prefix)) as [string, T][]),
  };
}

const snap = (code: string, n: number): RoomSnapshot => ({
  code,
  state: 'game',
  config: { mode: 'coop', stage: 0, enemies: 0, teamSize: 3 },
  players: Array.from({ length: n }, (_, i) => ({ slot: i, name: `P${i}`, team: 0 as const, rtt: 40, p2p: [] })),
});
const delta = (msgsIn: number) => ({ connects: 2, msgsIn, bytesIn: msgsIn * 20, msgsOut: msgsIn, bytesOut: msgsIn * 20, matches: 1 });

describe('admin stats', () => {
  it('aggregates room reports per day, tracks live rooms and peak players', async () => {
    const store = memStore();
    const core = new StatsCore(store);
    const t0 = Date.UTC(2026, 9, 23, 3, 0, 0);
    await core.report({ code: 'ABCD', delta: delta(400), snapshot: snap('ABCD', 2), closed: false }, t0);
    await core.report({ code: 'WXYZ', delta: delta(200), snapshot: snap('WXYZ', 3), closed: false }, t0 + 1000);
    await core.report({ code: 'ABCD', delta: delta(0), snapshot: null, closed: true }, t0 + 2000);
    const s = await core.stats(t0 + 3000);
    expect(s.today.msgsIn).toBe(600);
    expect(s.today.connects).toBe(6);
    expect(s.today.peakPlayers).toBe(5);
    expect(s.live.map((r) => r.code)).toEqual(['WXYZ']);
    // 6 connects + 600/20 messages + 3 reports + 1 admin call
    expect(s.estimate.doRequests).toBe(6 + 30 + 3 + 1);
    expect(s.hours.at(-1)!.usage.msgsIn).toBe(600);
    // persisted: a fresh instance (object evicted) reads the same day and live rooms
    const again = await new StatsCore(store).stats(t0 + 4000);
    expect(again.today.msgsIn).toBe(600);
    expect(again.live.map((r) => r.code)).toEqual(['WXYZ']);
    // rooms that stop reporting disappear
    expect((await core.stats(t0 + 10 * 60_000)).live).toEqual([]);
  });

  it('estimates billable requests like the free plan counts them', () => {
    expect(estimate({ connects: 4, msgsIn: 2000, bytesIn: 0, msgsOut: 0, bytesOut: 0, matches: 0, reports: 10, adminCalls: 5, peakPlayers: 0 })).toEqual({
      doRequests: 4 + 100 + 10 + 5,
      workerRequests: 4 + 10,
    });
  });
});
