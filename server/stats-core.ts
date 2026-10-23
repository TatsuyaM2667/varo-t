/**
 * Usage statistics for the admin page, kept by one "Stats" Durable Object.
 * Rooms report their traffic deltas every minute; this aggregates them per
 * UTC day (the free plan's quota day, resets 09:00 JST) and per hour, and
 * remembers which rooms are live. Pure logic over a tiny storage interface
 * (unit-testable without the Workers runtime).
 */
import type { RoomSnapshot, RoomTraffic } from '../src/net/room';

/** Cloudflare Workers Free plan, per day (https://developers.cloudflare.com/durable-objects/platform/pricing/). */
export const FREE_LIMITS = {
  /** Durable Object requests (incoming WebSocket messages count 1/20 each) */
  doRequests: 100_000,
  /** Worker requests */
  workerRequests: 100_000,
  wsMessagesPerRequest: 20,
};

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string[]): Promise<unknown>;
  list<T>(opts: { prefix: string }): Promise<Map<string, T>>;
}

export interface Usage extends RoomTraffic {
  /** room → stats reports (each is a Durable Object request) */
  reports: number;
  /** admin API calls */
  adminCalls: number;
  peakPlayers: number;
}

export interface RoomReport {
  code: string;
  delta: RoomTraffic;
  snapshot: RoomSnapshot | null;
  closed: boolean;
}

export interface LiveRoom extends RoomSnapshot {
  updatedAt: number;
  since: number;
  traffic: RoomTraffic;
}

const empty = (): Usage => ({ connects: 0, msgsIn: 0, bytesIn: 0, msgsOut: 0, bytesOut: 0, matches: 0, reports: 0, adminCalls: 0, peakPlayers: 0 });
const dayKey = (t: number) => `d:${new Date(t).toISOString().slice(0, 10)}`;
const hourKey = (t: number) => `h:${new Date(t).toISOString().slice(0, 13)}`;
/** rooms that stopped reporting for this long are considered gone */
const STALE_MS = 3 * 60_000;

/** Estimated billable requests for a usage record. */
export function estimate(u: Usage): { doRequests: number; workerRequests: number } {
  return {
    // each WebSocket connection: one Worker request routed to one Durable Object request
    doRequests: u.connects + Math.ceil(u.msgsIn / FREE_LIMITS.wsMessagesPerRequest) + u.reports + u.adminCalls,
    workerRequests: u.connects + u.adminCalls * 2,
  };
}

export class StatsCore {
  private readonly live = new Map<string, LiveRoom>();
  private cache = new Map<string, Usage>();

  constructor(private readonly store: KvStore) {}

  private async usage(key: string): Promise<Usage> {
    let u = this.cache.get(key);
    if (!u) {
      u = { ...empty(), ...((await this.store.get<Usage>(key)) ?? {}) };
      this.cache.set(key, u);
      // keep the cache to the current day/hour (+ a couple)
      if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!);
    }
    return u;
  }

  async report(r: RoomReport, now: number): Promise<void> {
    const keys = [dayKey(now), hourKey(now)];
    for (const k of keys) {
      const u = await this.usage(k);
      for (const f of ['connects', 'msgsIn', 'bytesIn', 'msgsOut', 'bytesOut', 'matches'] as const) u[f] += Math.max(0, r.delta[f] | 0);
      u.reports++;
    }
    const prev = this.live.get(r.code);
    if (r.closed || !r.snapshot || !r.snapshot.players.length) this.live.delete(r.code);
    else {
      const traffic = prev?.traffic ?? { connects: 0, msgsIn: 0, bytesIn: 0, msgsOut: 0, bytesOut: 0, matches: 0 };
      for (const f of Object.keys(traffic) as (keyof RoomTraffic)[]) traffic[f] += Math.max(0, r.delta[f] | 0);
      this.live.set(r.code, { ...r.snapshot, updatedAt: now, since: prev?.since ?? now, traffic });
    }
    const players = this.liveRooms(now).reduce((n, room) => n + room.players.length, 0);
    for (const k of keys) {
      const u = await this.usage(k);
      u.peakPlayers = Math.max(u.peakPlayers, players);
      await this.store.put(k, u);
    }
  }

  liveRooms(now: number): LiveRoom[] {
    for (const [code, room] of this.live) if (now - room.updatedAt > STALE_MS) this.live.delete(code);
    return [...this.live.values()].sort((a, b) => a.since - b.since);
  }

  /** Everything the admin page shows. Counts as one admin call. */
  async stats(now: number) {
    const today = await this.usage(dayKey(now));
    today.adminCalls++;
    await this.store.put(dayKey(now), today);
    const hours: { hour: string; usage: Usage }[] = [];
    for (let i = 23; i >= 0; i--) {
      const t = now - i * 3600_000;
      const k = hourKey(t);
      hours.push({ hour: k.slice(2), usage: this.cache.get(k) ?? { ...empty(), ...((await this.store.get<Usage>(k)) ?? {}) } });
    }
    const days: { day: string; usage: Usage }[] = [];
    for (let i = 0; i < 7; i++) {
      const k = dayKey(now - i * 86_400_000);
      days.push({ day: k.slice(2), usage: this.cache.get(k) ?? { ...empty(), ...((await this.store.get<Usage>(k)) ?? {}) } });
    }
    const nextReset = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
    return { now, today, estimate: estimate(today), limits: FREE_LIMITS, nextReset, hours, days, live: this.liveRooms(now) };
  }

  /** Drop hourly records older than two days and daily ones older than 60 days. */
  async prune(now: number): Promise<void> {
    const old: string[] = [];
    for (const k of (await this.store.list<Usage>({ prefix: 'h:' })).keys()) if (k < hourKey(now - 48 * 3600_000)) old.push(k);
    for (const k of (await this.store.list<Usage>({ prefix: 'd:' })).keys()) if (k < dayKey(now - 60 * 86_400_000)) old.push(k);
    if (old.length) await this.store.delete(old);
  }
}
