/**
 * HALCYON LINE multiplayer relay: a Cloudflare Worker with one Durable
 * Object per room code. Clients connect to wss://<worker>/room/<CODE>.
 *   deploy: npm run relay:deploy   ·   local: npm run relay:dev (ws://localhost:8787)
 */
import { ROOM_CODE_RE } from '../src/net/protocol';
import { type Conn, RoomCore } from '../src/net/room';

/** Rooms are created near this region (players are expected in Japan). */
const LOCATION_HINT = 'apac';

interface Env {
  ROOMS: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
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
    const gone = () => then(() => core.close(conn));
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
