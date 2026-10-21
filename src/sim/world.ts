import { ABILITIES } from '../config/abilities';
import { type Difficulty, DEFAULT_DIFFICULTY } from '../config/bots';
import { MOVEMENT } from '../config/movement';
import { RULES } from '../config/rules';
import { WEAPONS } from '../config/weapons';
import { createBrain, type BotBrain } from './bots/brain';
import { NavGrid } from './bots/nav';
import { PI, RAD_PER_UNIT, cos, sin } from './core/fmath';
import { StateHasher } from './core/hash';
import { Rng } from './core/rng';
import { dirFromAngles, v3 } from './core/vec';
import { type Agent, type Team, createAgent, emptyStats, eyeHeight, horizontalSpeed, startDash, stepAgentMovement } from './entities/agent';
import { faceNormal, traceShot } from './entities/combat';
import {
  type Smoke,
  type SmokeProjectile,
  deploySmoke,
  smokeBlocks,
  stepSmoke,
  stepSmokeProjectile,
} from './entities/smoke';
import {
  applyShotRecoil,
  currentSpreadDeg,
  damageAt,
  def,
  resetWeaponState,
  startReload,
  switchWeapon,
  tickWeapon,
} from './entities/weapon';
import type { NoiseSource, RoundEndReason, RoundPhase, SimEvent } from './events';
import { Btn, type InputFrame, emptyInput, has } from './input-frame';
import { generateCoverLayout } from './map/generator';
import { type MapData, buildMeridianYard } from './map/map-def';
import type { MaterialTag } from './physics/aabb';
import { Bvh } from './physics/bvh';

const TICK = MOVEMENT.tickRate;
const DT = 1 / TICK;
const DEG = PI / 180;
const MAX_SHOT_DIST = 250;

/** Sim-affecting feature flags (must be identical when replaying). */
export interface SimFeatures {
  destructibles: boolean;
  seededMap: boolean;
  utilityAi: boolean;
}

export const DEFAULT_SIM_FEATURES: SimFeatures = { destructibles: false, seededMap: false, utilityAi: false };

export interface AgentSpec {
  team: Team;
  isBot: boolean;
  name: string;
  difficulty?: Difficulty;
  hpBonus?: number;
}

export interface WorldOptions {
  seed: number;
  roster: AgentSpec[];
  features?: Partial<SimFeatures>;
  roundsToWin?: number;
}

export interface RoundState {
  index: number;
  phase: RoundPhase;
  /** ticks spent in the current phase */
  phaseTicks: number;
  /** ticks since round start */
  tick: number;
  captureProgress: number;
  winner: 0 | 1 | -1;
  reason: RoundEndReason | null;
  endTick: number;
}

export interface MatchState {
  score: [number, number];
  roundsToWin: number;
  over: boolean;
  winner: 0 | 1 | -1;
  /** per-round winners, for the results screen */
  history: { winner: 0 | 1; reason: RoundEndReason; duration: number }[];
}

/**
 * The deterministic game world. A round is a pure function of
 * (seed, roster, features, round index, human inputs during the round), so
 * killcams and replays just re-simulate it.
 */
export class World {
  readonly dt = DT;
  readonly seed: number;
  readonly features: SimFeatures;
  readonly roster: AgentSpec[];
  map: MapData;
  bvh: Bvh;
  nav: NavGrid;
  readonly rng: Rng;
  readonly agents: Agent[] = [];
  readonly brains: (BotBrain | null)[] = [];
  smokes: Smoke[] = [];
  projectiles: SmokeProjectile[] = [];
  /** events produced by the most recent tick */
  events: SimEvent[] = [];
  /** noises made during the most recent tick (bots hear them next tick) */
  noises: NoiseSource[] = [];
  readonly round: RoundState;
  readonly match: MatchState;
  /** total ticks since construction */
  tick = 0;
  private nextId = 1;
  private colliderHp = new Map<number, number>();
  private readonly defaultMap: MapData;
  private readonly defaultBvh: Bvh;
  private readonly defaultNav: NavGrid;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed >>> 0;
    this.features = { ...DEFAULT_SIM_FEATURES, ...opts.features };
    this.roster = opts.roster.map((r) => ({ ...r }));
    this.defaultMap = buildMeridianYard();
    this.defaultBvh = new Bvh(this.defaultMap.colliders);
    this.defaultNav = new NavGrid(this.defaultMap, this.defaultBvh);
    this.map = this.defaultMap;
    this.bvh = this.defaultBvh;
    this.nav = this.defaultNav;
    this.rng = new Rng(this.seed);
    for (const spec of this.roster) {
      const a = createAgent(this.agents.length, spec.team, spec.isBot, spec.name);
      a.difficulty = spec.isBot ? (spec.difficulty ?? DEFAULT_DIFFICULTY) : '';
      this.agents.push(a);
    }
    this.round = { index: -1, phase: 'prep', phaseTicks: 0, tick: 0, captureProgress: 0, winner: -1, reason: null, endTick: 0 };
    this.match = { score: [0, 0], roundsToWin: opts.roundsToWin ?? RULES.roundsToWin, over: false, winner: -1, history: [] };
  }

  /** Derived per-round seed so each round is independently reproducible. */
  roundSeed(index: number): number {
    let h = (this.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    return (h ^ (h >>> 13)) >>> 0;
  }

  /** Reset everything round-scoped. Match score and agent stats persist. */
  startRound(index: number): void {
    const rs = this.roundSeed(index);
    this.rng.reseed(rs);
    if (this.features.seededMap) {
      const layoutRng = new Rng(rs ^ 0x5eed);
      this.map = buildMeridianYard(generateCoverLayout(layoutRng));
      this.bvh = new Bvh(this.map.colliders);
      this.nav = new NavGrid(this.map, this.bvh);
    } else {
      this.map = this.defaultMap;
      this.bvh = this.defaultBvh;
      this.bvh.disabled.fill(0);
      this.nav = this.defaultNav;
    }
    this.colliderHp.clear();
    for (const c of this.map.colliders) if (c.breakHp !== undefined) this.colliderHp.set(c.id, c.breakHp);

    this.smokes = [];
    this.projectiles = [];
    this.nextId = 1;
    const r = this.round;
    r.index = index;
    r.phase = 'prep';
    r.phaseTicks = 0;
    r.tick = 0;
    r.captureProgress = 0;
    r.winner = -1;
    r.reason = null;
    r.endTick = 0;

    const counters = [0, 0];
    for (const a of this.agents) {
      const spec = this.roster[a.id];
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
      a.airTicks = 0;
      a.crouch = 0;
      a.height = MOVEMENT.standHeight;
      a.dashTicks = 0;
      a.prevButtons = 0;
      a.maxHp = RULES.maxHp + (spec.hpBonus ?? 0);
      a.hp = a.maxHp;
      resetWeaponState(a.weapon);
      a.smokeCharges = ABILITIES.smoke.charges;
      a.smokeCooldown = 0;
      a.dashCharges = ABILITIES.dash.charges;
      a.dashRecharge = 0;
      a.lastHitTick = -1;
      a.lastAttacker = -1;
      a.stepAccum = 0;
    }
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      this.brains[i] = a.isBot
        ? createBrain(a, (this.roster[i].difficulty ?? DEFAULT_DIFFICULTY) as Difficulty, this.features.utilityAi, new Rng(rs ^ Math.imul(i + 7, 0x2545f491)))
        : null;
    }
    this.events.push({ type: 'phase', phase: 'prep', round: index });
  }

  /** Begin a fresh match (round 0). */
  startMatch(): void {
    this.match.score = [0, 0];
    this.match.over = false;
    this.match.winner = -1;
    this.match.history = [];
    for (const a of this.agents) a.stats = emptyStats();
    this.startRound(0);
  }

  /**
   * Advance one tick. `humanInputs[i]` drives agent i if it is human; bots
   * generate their own input from the world state.
   */
  step(humanInputs: readonly (InputFrame | undefined)[]): void {
    const prevNoises = this.noises;
    this.events = [];
    this.noises = [];
    const r = this.round;
    const frozen = r.phase === 'prep';
    const combat = r.phase === 'live' || r.phase === 'end';

    // 1) gather inputs (bots think using last tick's noises)
    const inputs: InputFrame[] = [];
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const brain = this.brains[i];
      if (brain) inputs.push(a.alive ? brain.think(this, a, prevNoises) : emptyInput(a.yaw, a.pitch));
      else inputs.push(humanInputs[i] ?? emptyInput(a.yaw, a.pitch));
    }

    // 2) agents
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const input = inputs[i];
      const pressed = input.buttons & ~a.prevButtons;
      const wasGrounded = a.grounded;
      const vyBefore = a.vy;
      if (!a.alive) {
        stepAgentMovement(a, input, this.bvh, { speedMul: 1, frozen: true });
        continue;
      }
      const w = a.weapon;
      // weapon switching / reload
      for (const slot of [1, 2, 3] as const) {
        const btn = slot === 1 ? Btn.Weapon1 : slot === 2 ? Btn.Weapon2 : Btn.Weapon3;
        if (pressed & btn && switchWeapon(w, slot)) this.events.push({ type: 'equip', agent: a.id, weapon: w.current });
      }
      if (pressed & Btn.Reload && startReload(w)) this.events.push({ type: 'reload', agent: a.id, weapon: w.current });

      // abilities
      if (!frozen) this.handleAbilities(a, input, pressed);

      const speedMul = 1 + (def(w).ads.moveMul - 1) * w.ads;
      stepAgentMovement(a, input, this.bvh, { speedMul, frozen });
      this.emitMovementEvents(a, input, pressed, wasGrounded, vyBefore);

      // firing
      const reloadingBefore = w.reload > 0;
      const res = tickWeapon(w, has(input, Btn.Fire), (pressed & Btn.Fire) !== 0, has(input, Btn.Ads), combat && !frozen && a.dashTicks === 0);
      if (res.empty) this.events.push({ type: 'dry', agent: a.id });
      if (!reloadingBefore && w.reload > 0 && !(pressed & Btn.Reload)) this.events.push({ type: 'reload', agent: a.id, weapon: w.current });
      if (res.fired) this.fire(a);
    }

    // 3) projectiles and smokes
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (stepSmokeProjectile(p, this.bvh)) {
        const s = deploySmoke(p.id, p.owner, p.x, Math.max(0, p.y - 0.2), p.z, this.rng, this.bvh);
        this.smokes.push(s);
        this.projectiles.splice(i, 1);
        this.events.push({ type: 'smokeDeploy', smoke: s.id, x: s.x, y: s.y, z: s.z });
        this.noises.push({ x: s.x, y: s.y, z: s.z, radius: 25, agent: p.owner, kind: 'ability' });
      }
    }
    this.smokes = this.smokes.filter(stepSmoke);

    // 4) rules
    this.stepRules();
    r.tick++;
    r.phaseTicks++;
    this.tick++;
  }

  private handleAbilities(a: Agent, input: InputFrame, pressed: number): void {
    if (a.smokeCooldown > 0) a.smokeCooldown--;
    if (a.dashCharges < ABILITIES.dash.charges) {
      a.dashRecharge++;
      if (a.dashRecharge >= ABILITIES.dash.rechargeTime * TICK) {
        a.dashCharges++;
        a.dashRecharge = 0;
      }
    }
    if (pressed & Btn.Ability1 && a.smokeCharges > 0 && a.smokeCooldown === 0) {
      a.smokeCharges--;
      a.smokeCooldown = Math.round(ABILITIES.smoke.cooldown * TICK);
      const dir = dirFromAngles(v3(), input.yaw * RAD_PER_UNIT, input.pitch * RAD_PER_UNIT + 0.08);
      const eye = a.y + eyeHeight(a);
      const id = this.nextId++;
      this.projectiles.push({
        id,
        owner: a.id,
        x: a.x + dir.x * 0.4,
        y: eye - 0.1,
        z: a.z + dir.z * 0.4,
        vx: dir.x * ABILITIES.smoke.throwSpeed + a.vx * 0.5,
        vy: dir.y * ABILITIES.smoke.throwSpeed + ABILITIES.smoke.throwLift,
        vz: dir.z * ABILITIES.smoke.throwSpeed + a.vz * 0.5,
        age: 0,
      });
      this.events.push({ type: 'smokeThrow', agent: a.id, projectile: id });
    }
    if (pressed & Btn.Ability2 && a.dashCharges > 0 && a.dashTicks === 0) {
      a.dashCharges--;
      a.dashRecharge = 0;
      startDash(a, input);
      this.events.push({ type: 'dash', agent: a.id });
      this.noises.push({ x: a.x, y: a.y, z: a.z, radius: 20, agent: a.id, kind: 'ability' });
    }
  }

  private emitMovementEvents(a: Agent, input: InputFrame, pressed: number, wasGrounded: boolean, vyBefore: number): void {
    if (pressed & Btn.Jump && wasGrounded && !a.grounded && a.vy > 0) this.events.push({ type: 'jump', agent: a.id });
    if (!wasGrounded && a.grounded) {
      this.events.push({ type: 'land', agent: a.id, speed: -vyBefore });
      if (vyBefore < -4) this.noises.push({ x: a.x, y: a.y, z: a.z, radius: 18, agent: a.id, kind: 'footstep' });
    }
    if (a.grounded) {
      const sp = horizontalSpeed(a);
      a.stepAccum += sp * DT;
      const stride = sp > MOVEMENT.walkSpeed + 0.3 ? 2.1 : 1.6;
      if (a.stepAccum >= stride) {
        a.stepAccum -= stride;
        const loud = a.noisy && !has(input, Btn.Walk);
        this.events.push({ type: 'footstep', agent: a.id, material: this.floorMaterial(a), x: a.x, y: a.y, z: a.z, loud });
        if (loud) this.noises.push({ x: a.x, y: a.y, z: a.z, radius: 22, agent: a.id, kind: 'footstep' });
      }
    }
  }

  private floorMaterial(a: Agent): MaterialTag {
    const hit = this.bvh.raycast(a.x, a.y + 0.1, a.z, 0, -1, 0, 0.4);
    return hit ? hit.collider.material : 'floor';
  }

  private fire(a: Agent): void {
    const w = a.weapon;
    const d = def(w);
    const spreadDeg = currentSpreadDeg(w, {
      speed: horizontalSpeed(a),
      grounded: a.grounded,
      crouched: a.crouch > 0.5,
      walking: has({ buttons: a.prevButtons, yaw: 0, pitch: 0 }, Btn.Walk),
    });
    const recoil = applyShotRecoil(w);
    a.stats.shots++;
    // random point in the spread cone (uniform over the disc)
    const ang = this.rng.float() * 2 * PI;
    const rad = spreadDeg * DEG * Math.sqrt(this.rng.float());
    const yaw = a.yaw * RAD_PER_UNIT + recoil.yaw + sin(ang) * rad;
    const pitch = a.pitch * RAD_PER_UNIT + recoil.pitch + cos(ang) * rad;
    const dir = dirFromAngles(v3(), yaw, pitch);
    const ox = a.x;
    const oy = a.y + eyeHeight(a);
    const oz = a.z;
    this.noises.push({ x: ox, y: oy, z: oz, radius: d.noiseRadius, agent: a.id, kind: 'gunshot' });

    let sx = ox;
    let sy = oy;
    let sz = oz;
    let remaining = MAX_SHOT_DIST;
    // at most one glass pane penetration
    for (let pass = 0; pass < 2; pass++) {
      const hit = traceShot(this.bvh, this.agents, a, sx, sy, sz, dir.x, dir.y, dir.z, remaining);
      const hx = sx + dir.x * hit.t;
      const hy = sy + dir.y * hit.t;
      const hz = sz + dir.z * hit.t;
      let n: [number, number, number] = [0, 0, 0];
      if (hit.collider) n = faceNormal(hit.collider, hx, hy, hz);
      this.events.push({
        type: 'shot',
        agent: a.id,
        weapon: d.id,
        ox: sx,
        oy: sy,
        oz: sz,
        hx,
        hy,
        hz,
        nx: n[0],
        ny: n[1],
        nz: n[2],
        hitAgent: hit.agent ? hit.agent.id : -1,
        zone: hit.zone,
        surface: hit.collider ? hit.collider.material : null,
      });
      if (hit.agent && hit.zone) {
        const dist = Math.sqrt((hx - ox) ** 2 + (hy - oy) ** 2 + (hz - oz) ** 2);
        this.applyDamage(a, hit.agent, damageAt(d, hit.zone, dist), hit.zone);
        break;
      }
      if (hit.collider && this.features.destructibles && this.colliderHp.has(hit.collider.id)) {
        const c = hit.collider;
        const hp = this.colliderHp.get(c.id)! - d.damage.body;
        this.colliderHp.set(c.id, hp);
        if (hp <= 0) {
          this.bvh.disabled[c.id] = 1;
          this.colliderHp.delete(c.id);
          this.events.push({ type: 'break', collider: c.id, material: c.material, x: (c.minX + c.maxX) / 2, y: (c.minY + c.maxY) / 2, z: (c.minZ + c.maxZ) / 2 });
          this.noises.push({ x: hx, y: hy, z: hz, radius: 30, agent: a.id, kind: 'ability' });
          if (c.material === 'glass') {
            remaining -= hit.t;
            sx = hx + dir.x * 0.01;
            sy = hy + dir.y * 0.01;
            sz = hz + dir.z * 0.01;
            continue;
          }
        }
      }
      break;
    }
  }

  private applyDamage(attacker: Agent, victim: Agent, amount: number, zone: 'head' | 'body' | 'legs'): void {
    if (attacker.team === victim.team || !victim.alive) return;
    const dealt = Math.min(victim.hp, amount);
    victim.hp -= dealt;
    victim.lastHitTick = this.round.tick;
    victim.lastAttacker = attacker.id;
    attacker.stats.damage += dealt;
    attacker.stats.hits++;
    const killed = victim.hp <= 0;
    this.events.push({ type: 'damage', attacker: attacker.id, victim: victim.id, amount: dealt, zone, killed });
    if (killed) {
      victim.hp = 0;
      victim.alive = false;
      victim.stats.deaths++;
      attacker.stats.kills++;
      if (zone === 'head') attacker.stats.headshots++;
      this.events.push({ type: 'kill', killer: attacker.id, victim: victim.id, weapon: attacker.weapon.current, headshot: zone === 'head' });
    }
  }

  aliveCount(team: Team): number {
    let n = 0;
    for (const a of this.agents) if (a.team === team && a.alive) n++;
    return n;
  }

  /** Team present in the site zone: bit 0 = attackers, bit 1 = defenders. */
  siteOccupancy(): number {
    const z = this.map.siteZone;
    let mask = 0;
    for (const a of this.agents) {
      if (!a.alive) continue;
      if (a.x >= z.minX && a.x <= z.maxX && a.z >= z.minZ && a.z <= z.maxZ) mask |= 1 << a.team;
    }
    return mask;
  }

  private stepRules(): void {
    const r = this.round;
    switch (r.phase) {
      case 'prep':
        if (r.phaseTicks + 1 >= RULES.prepTime * TICK) this.setPhase('live');
        break;
      case 'live': {
        const capTicks = RULES.captureTime * TICK;
        const occ = this.siteOccupancy();
        if (occ === 1) {
          if (r.captureProgress === 0) this.events.push({ type: 'captureStart' });
          r.captureProgress = Math.min(1, r.captureProgress + 1 / capTicks);
        } else if (occ === 0) {
          r.captureProgress = Math.max(0, r.captureProgress - RULES.captureDecay / capTicks);
        }
        if (this.aliveCount(1) === 0) this.endRound(0, 'elimination');
        else if (this.aliveCount(0) === 0) this.endRound(1, 'elimination');
        else if (r.captureProgress >= 1) this.endRound(0, 'capture');
        else if (r.phaseTicks + 1 >= RULES.roundTime * TICK) this.endRound(1, 'time');
        break;
      }
      case 'end':
        if (r.phaseTicks + 1 >= RULES.roundEndTime * TICK) {
          if (this.match.over) this.setPhase('matchOver');
          else this.startRound(r.index + 1);
        }
        break;
      case 'matchOver':
        break;
    }
  }

  private setPhase(p: RoundPhase): void {
    this.round.phase = p;
    this.round.phaseTicks = -1; // incremented to 0 at the end of this tick
    this.events.push({ type: 'phase', phase: p, round: this.round.index });
  }

  private endRound(winner: 0 | 1, reason: RoundEndReason): void {
    const r = this.round;
    r.winner = winner;
    r.reason = reason;
    r.endTick = r.tick;
    this.match.score[winner]++;
    this.match.history.push({ winner, reason, duration: r.tick / TICK });
    if (this.match.score[winner] >= this.match.roundsToWin) {
      this.match.over = true;
      this.match.winner = winner;
    }
    this.events.push({ type: 'roundEnd', winner, reason, round: r.index });
    this.setPhase('end');
  }

  /** Seconds left in the current phase (for the HUD). */
  phaseTimeLeft(): number {
    const r = this.round;
    const len = r.phase === 'prep' ? RULES.prepTime : r.phase === 'live' ? RULES.roundTime : r.phase === 'end' ? RULES.roundEndTime : 0;
    return Math.max(0, len - r.phaseTicks / TICK);
  }

  /** Line of sight between two points, considering geometry and smoke. */
  canSee(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    if (this.bvh.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, (c) => c.material !== 'glass' || !this.features.destructibles)) return false;
    return !smokeBlocks(this.smokes, ax, ay, az, bx, by, bz);
  }

  isBreakableAlive(id: number): boolean {
    return this.colliderHp.has(id);
  }

  weaponDef(a: Agent) {
    return WEAPONS[a.weapon.current];
  }

  /** Hash of all simulation state, for determinism checks. */
  hash(h = new StateHasher()): number {
    h.reset().int(this.tick).int(this.round.tick).int(this.round.index).num(this.round.captureProgress);
    for (const s of this.rng.getState()) h.int(s);
    for (const a of this.agents) {
      h.num(a.x).num(a.y).num(a.z).num(a.vx).num(a.vy).num(a.vz);
      h.int(a.yaw).int(a.pitch).bool(a.grounded).num(a.crouch).num(a.height).int(a.dashTicks).bool(a.alive);
      h.num(a.hp).num(a.weapon.recoilPitch).num(a.weapon.recoilYaw).num(a.weapon.cooldown).int(a.weapon.ammo[a.weapon.current].mag);
      h.int(a.smokeCharges).int(a.dashCharges);
    }
    for (const s of this.smokes) h.num(s.x).num(s.z).num(s.age);
    for (const p of this.projectiles) h.num(p.x).num(p.y).num(p.z);
    return h.digest();
  }
}
