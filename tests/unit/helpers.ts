import type { Difficulty } from '../../src/config/bots';
import { type AgentSpec, type SimFeatures, World } from '../../src/sim/world';

/** World with a human attacker (id 0) and optional bots, already in the live phase. */
export function liveWorld(opts: { seed?: number; bots?: number; difficulty?: Difficulty; features?: Partial<SimFeatures>; humans?: number } = {}): World {
  const roster: AgentSpec[] = [];
  for (let i = 0; i < (opts.humans ?? 1); i++) roster.push({ team: 0, isBot: false, name: `p${i}` });
  for (let i = 0; i < (opts.bots ?? 0); i++) roster.push({ team: 1, isBot: true, name: `b${i}`, difficulty: opts.difficulty ?? 'normal' });
  const w = new World({ seed: opts.seed ?? 1, roster, features: opts.features });
  w.startMatch();
  forceLive(w);
  return w;
}

export function forceLive(w: World): void {
  w.round.phase = 'live';
  w.round.phaseTicks = 0;
}
