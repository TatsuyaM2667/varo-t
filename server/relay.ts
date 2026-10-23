/**
 * HALCYON LINE multiplayer relay: a Cloudflare Worker with one Durable
 * Object per room code. Clients connect to wss://<worker>/room/<CODE>.
 * Rooms report their traffic to one Stats object; /admin shows it.
 *   deploy: npm run relay:deploy   ·   local: npm run relay:dev (ws://localhost:8787)
 *   admin password: npx wrangler secret put ADMIN_TOKEN -c server/wrangler.toml
 */
import { ROOM_CODE_RE } from '../src/net/protocol';
import { type Conn, RoomCore, type RoomTraffic } from '../src/net/room';
import { ADMIN_HTML } from './admin-page';
import { type KvStore, type RoomReport, StatsCore } from './stats-core';

/** Rooms are created near this region (players are expected in Japan). */
const LOCATION_HINT = 'apac';
/** a live room reports its traffic this often (each report is one Durable Object request) */
const REPORT_EVERY_MS = 60_000;

interface Env {
  ROOMS: DurableObjectNamespace;
  STATS: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
}

const statsStub = (env: Env) => env.STATS.get(env.STATS.idFromName('global'), { locationHint: LOCATION_HINT });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/admin') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    if (url.pathname === '/admin/api') {
      if (!env.ADMIN_TOKEN) return new Response('ADMIN_TOKEN is not set (npx wrangler secret put ADMIN_TOKEN)', { status: 503 });
      if (req.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return new Response('unauthorized', { status: 401 });
      return statsStub(env).fetch(new Request('https://stats/stats'));
    }
    // /where/<CODE>: which Cloudflare location runs that room (diagnostics)
    const m = /^\/(room|where)\/([^/]+)$/.exec(url.pathname);
    if (!m) return new Response('HALCYON LINE relay', { status: url.pathname === '/' ? 200 : 404 });
    const code = m[2].toUpperCase();
    if (!ROOM_CODE_RE.test(code)) return new Response('bad room code', { status: 400 });
    const room = env.ROOMS.get(env.ROOMS.idFromName(code), { locationHint: LOCATION_HINT });
    if (m[1] === 'where') return room.fetch(req);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    return room.fetch(req);
  },
};

/** One room. Plain (non-hibernating) WebSockets: rooms are short-lived and few. */
export class Room implements DurableObject {
  private core: RoomCore | null = null;
  private reported: RoomTraffic = { connects: 0, msgsIn: 0, bytesIn: 0, msgsOut: 0, bytesOut: 0, matches: 0 };
  private reportedSnap = '';
  private timer = 0;
  private soon = false;

  constructor(
    _ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  /** Send the traffic since the last report (and the room's current state) to the Stats object. */
  private async report(closed = false): Promise<void> {
    const core = this.core;
    if (!core) return;
    const snap = core.snapshot();
    const snapKey = JSON.stringify(snap);
    const t = core.traffic;
    const delta = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v - this.reported[k as keyof RoomTraffic]])) as unknown as RoomTraffic;
    if (!closed && snapKey === this.reportedSnap && Object.values(delta).every((v) => v === 0)) return;
    this.reported = { ...t };
    this.reportedSnap = snapKey;
    const body: RoomReport = { code: core.code, delta, snapshot: snap, closed };
    try {
      await statsStub(this.env).fetch(new Request('https://stats/report', { method: 'POST', body: JSON.stringify(body) }));
    } catch (e) {
      console.error('[room] stats report failed', e);
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname.startsWith('/where/')) {
      const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
      return new Response(trace.split('\n').filter((l) => /^(colo|loc)=/.test(l)).join(' '));
    }
    const code = new URL(req.url).pathname.split('/').pop()!.toUpperCase();
    this.core ??= new RoomCore(code, Math.random);
    const core = this.core;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const conn: Conn = {
      send: (d) => {
        try {
          server.send(d);
        } catch {
          /* socket already closing */
        }
      },
      close: (c, r) => {
        try {
          server.close(c, r);
        } catch {
          /* ignore */
        }
      },
    };
    core.open(conn);
    // Newer runtimes deliver binary frames as Blob unless asked for ArrayBuffer.
    // Blobs are converted on a per-socket chain so inputs keep their order.
    (server as unknown as { binaryType: string }).binaryType = 'arraybuffer';
    let chain: Promise<void> = Promise.resolve();
    const then = (f: () => void | Promise<void>) => {
      chain = chain.then(f).catch((e) => console.error('[room]', e));
    };
    server.addEventListener('message', (ev) => {
      const d = ev.data as string | ArrayBuffer | Blob;
      if (typeof d === 'string' || d instanceof ArrayBuffer) then(() => core.message(conn, d));
      else {
        const buf = d.arrayBuffer();
        then(async () => core.message(conn, await buf));
      }
    });
    const gone = () =>
      then(() => {
        core.close(conn);
        if (!core.playerCount) {
          clearInterval(this.timer);
          this.timer = 0;
          void this.report(true);
        }
      });
    if (!this.timer) this.timer = setInterval(() => void this.report(), REPORT_EVERY_MS) as unknown as number;
    // show new rooms / joins on the admin page soon, without waiting for the minute
    if (!this.soon) {
      this.soon = true;
      setTimeout(() => {
        this.soon = false;
        void this.report();
      }, 3000);
    }
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}

/** Usage statistics for /admin (one instance). */
export class Stats implements DurableObject {
  private readonly core: StatsCore;
  private reports = 0;

  constructor(ctx: DurableObjectState) {
    this.core = new StatsCore(ctx.storage as unknown as KvStore);
  }

  async fetch(req: Request): Promise<Response> {
    const now = Date.now();
    const path = new URL(req.url).pathname;
    if (path === '/report' && req.method === 'POST') {
      await this.core.report((await req.json()) as RoomReport, now);
      if (++this.reports % 200 === 0) await this.core.prune(now);
      return new Response('ok');
    }
    if (path === '/stats') return Response.json(await this.core.stats(now));
    return new Response('not found', { status: 404 });
  }
}
