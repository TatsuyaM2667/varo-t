import { MOVEMENT } from '../config/movement';
import { Rng } from './core/rng';
import { StateHasher } from './core/hash';
import { type Agent, type Team, createAgent, stepAgentMovement } from './entities/agent';
import type { InputFrame } from './input-frame';
import { type MapData, buildMeridianYard } from './map/map-def';
import { Bvh } from './physics/bvh';

export interface WorldOptions {
  seed: number;
  map?: MapData;
}

export interface AgentSpec {
  team: Team;
  isBot: boolean;
  name: string;
}

/**
 * The deterministic game world. `step()` advances exactly one 1/60 s tick
 * given one InputFrame per agent (indexed by agent id).
 */
export class World {
  readonly dt = 1 / MOVEMENT.tickRate;
  readonly map: MapData;
  readonly bvh: Bvh;
  readonly rng: Rng;
  readonly agents: Agent[] = [];
  tick = 0;

  constructor(opts: WorldOptions) {
    this.map = opts.map ?? buildMeridianYard();
    this.bvh = new Bvh(this.map.colliders);
    this.rng = new Rng(opts.seed);
  }

  addAgent(spec: AgentSpec): Agent {
    const a = createAgent(this.agents.length, spec.team, spec.isBot, spec.name);
    this.agents.push(a);
    return a;
  }

  /** Place every agent on its team's spawn points. */
  spawnAll(): void {
    const counters = [0, 0];
    for (const a of this.agents) {
      const list = a.team === 0 ? this.map.spawns.attackers : this.map.spawns.defenders;
      const sp = list[counters[a.team]++ % list.length];
      a.x = sp.x;
      a.y = sp.y;
      a.z = sp.z;
      a.vx = a.vy = a.vz = 0;
      a.yaw = sp.yaw;
      a.pitch = 0;
      a.alive = true;
      a.grounded = true;
      a.crouch = 0;
      a.height = MOVEMENT.standHeight;
      a.dashTicks = 0;
    }
  }

  step(inputs: readonly InputFrame[]): void {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const input = inputs[i];
      if (!input) continue;
      stepAgentMovement(a, input, this.bvh, { speedMul: 1 });
    }
    this.tick++;
  }

  /** Hash of all simulation state, for determinism checks. */
  hash(h = new StateHasher()): number {
    h.reset().int(this.tick);
    for (const s of this.rng.getState()) h.int(s);
    for (const a of this.agents) {
      h.num(a.x).num(a.y).num(a.z).num(a.vx).num(a.vy).num(a.vz);
      h.int(a.yaw).int(a.pitch).bool(a.grounded).num(a.crouch).num(a.height).int(a.dashTicks).bool(a.alive);
    }
    return h.digest();
  }
}
