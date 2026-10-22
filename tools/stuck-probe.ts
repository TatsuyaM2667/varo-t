/**
 * Finds bots that want to move but don't: runs headless bot matches and
 * reports every bot that had a path goal > 1.5 m away yet moved < 0.4 m in
 * 3 s, grouped by location. Used to diagnose "bots get stuck" reports.
 *   npx tsx tools/stuck-probe.ts [mapId] [rounds] [defenders]
 */
import type { MapId } from '../src/sim/map/registry';
import { zoneAt } from '../src/sim/map/map-def';
import { type AgentSpec, World } from '../src/sim/world';

const mapId = (process.argv[2] ?? 'yard') as MapId;
const rounds = Number(process.argv[3] ?? 40);
const defenders = Number(process.argv[4] ?? 3);

interface BrainView {
  action: string;
  path: { x: number; z: number }[];
  pathIdx: number;
  pathGoal: { x: number; z: number } | null;
}

const hits = new Map<string, { n: number; actions: Map<string, number>; sample: string }>();
let stuckTicks = 0;
let movingTicks = 0;
for (let r = 0; r < rounds; r++) {
  const roster: AgentSpec[] = [
    ...[0, 1, 2].map((i): AgentSpec => ({ team: 0, isBot: true, name: `a${i}`, difficulty: 'normal' })),
    ...Array.from({ length: defenders }, (_, i): AgentSpec => ({ team: 1, isBot: true, name: `d${i}`, difficulty: 'normal' })),
  ];
  const w = new World({ seed: 1000 + r * 7919, roster, mapId, features: { utilityAi: true } });
  w.startMatch();
  const hist = w.agents.map(() => [] as { x: number; z: number }[]);
  for (let t = 0; t < 60 * 110 && w.round.phase !== 'end'; t++) {
    w.step([]);
    if (w.round.phase !== 'live') continue;
    for (const a of w.agents) {
      const h = hist[a.id];
      h.push({ x: a.x, z: a.z });
      if (h.length > 180) h.shift();
      if (!a.alive || h.length < 180) continue;
      const b = w.brains[a.id] as unknown as BrainView;
      const goal = b.pathGoal;
      if (!goal || b.action === 'engage' || b.action === 'idle') continue;
      const toGoal = Math.hypot(goal.x - a.x, goal.z - a.z);
      if (toGoal < 1.5) continue;
      movingTicks++;
      const moved = Math.hypot(h[0].x - a.x, h[0].z - a.z);
      if (moved < 0.4) {
        stuckTicks++;
        const key = `${Math.round(a.x)},${Math.round(a.z)}`;
        const e = hits.get(key) ?? { n: 0, actions: new Map(), sample: '' };
        e.n++;
        e.actions.set(b.action, (e.actions.get(b.action) ?? 0) + 1);
        const wp = b.path[b.pathIdx];
        e.sample = `zone=${zoneAt(w.map, a.x, a.z) || '-'} goal=(${goal.x.toFixed(1)},${goal.z.toFixed(1)}) wp=${wp ? `(${wp.x.toFixed(1)},${wp.z.toFixed(1)}) d=${Math.hypot(wp.x - a.x, wp.z - a.z).toFixed(2)}` : 'none'} y=${a.y.toFixed(2)} yaw=${a.yaw}`;
        hits.set(key, e);
      }
    }
  }
}
console.log(`map=${mapId} rounds=${rounds} defenders=${defenders}`);
console.log(`stuck share of "wants to move" ticks: ${((stuckTicks / Math.max(1, movingTicks)) * 100).toFixed(2)}% (${stuckTicks}/${movingTicks})`);
const top = [...hits.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
for (const [k, v] of top) console.log(`${String(v.n).padStart(6)}  at ${k.padEnd(9)} ${[...v.actions].map(([a, n]) => `${a}:${n}`).join(' ')}  ${v.sample}`);
