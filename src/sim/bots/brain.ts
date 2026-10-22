import { ABILITIES } from '../../config/abilities';
import { BOT_PROFILES, type BotProfile, type Difficulty } from '../../config/bots';
import { MOVEMENT } from '../../config/movement';
import { WEAPONS } from '../../config/weapons';
import { HALF_PI, PI, RAD_PER_UNIT, angleDiffRad, atan2, cos, radToUnits, sin, wrapYaw } from '../core/fmath';
import type { Rng } from '../core/rng';
import { type Agent, eyeHeight, horizontalSpeed } from '../entities/agent';
import type { NoiseSource } from '../events';
import { Btn, type InputFrame } from '../input-frame';
import type { World } from '../world';
import type { NavPoint } from './nav';
import { Rng as TeamRng } from '../core/rng';
import { type Post, type Route, type Tactics, nearestEntrance } from './tactics';

const TICK = MOVEMENT.tickRate;
const DT = 1 / TICK;
const DEG = PI / 180;

/** WASD combinations for the 8 headings, clockwise from forward. */
const MOVE_DIRS = [
  Btn.Forward,
  Btn.Forward | Btn.Right,
  Btn.Right,
  Btn.Back | Btn.Right,
  Btn.Back,
  Btn.Back | Btn.Left,
  Btn.Left,
  Btn.Forward | Btn.Left,
];

export interface BotBrain {
  think(world: World, self: Agent, noises: readonly NoiseSource[]): InputFrame;
  /** debug label for the current action */
  readonly action: string;
}

interface Memory {
  x: number;
  y: number;
  z: number;
  tick: number;
  /** true if seen, false if only heard */
  seen: boolean;
}

type Action = 'hold' | 'push' | 'engage' | 'investigate' | 'retake' | 'retreat' | 'capture' | 'rotate' | 'idle';

export function createBrain(self: Agent, difficulty: Difficulty, utility: boolean, rng: Rng, profile?: BotProfile): BotBrain {
  return new Brain(self, profile ?? BOT_PROFILES[difficulty], utility, rng);
}

/**
 * Bot controller. Produces the same InputFrame a human would, so bots obey
 * identical movement/weapon rules and replays only need human inputs.
 *
 * Perception: vision cone + line of sight + smoke optical depth, reaction
 * delay, hearing of footsteps/gunshots/abilities (halved through walls).
 * Decision: utility scores over actions (utility=true) or a fixed priority
 * FSM (Tier 0, utility=false).
 */
class Brain implements BotBrain {
  action: Action = 'idle';
  private aimYaw: number;
  private aimPitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errTimer = 0;
  private targetId = -1;
  private aimHead = false;
  private trackTime = 0;
  private readonly seenTicks = new Map<number, number>();
  private readonly reactionTicks = new Map<number, number>();
  private readonly memory = new Map<number, Memory>();
  private heard: Memory | null = null;

  private path: NavPoint[] = [];
  private pathIdx = 0;
  private pathGoal: NavPoint | null = null;
  private repathTimer = 0;
  private stuckTimer = 0;
  private lastProgressPos = { x: 0, z: 0 };
  private stuckLevel = 0;
  private unstickTicks = 0;
  private unstickDir = { x: 0, z: 0 };
  private ditherAcc = 0;

  private post: Post | null = null;
  private route: Route | null = null;
  private routeIdx = 0;
  private smokeUsedPlan = false;
  private smokeAim: { x: number; z: number } | null = null;
  private retreatTo: NavPoint | null = null;
  private retreatTimer = 0;
  private burstShots = 0;
  private burstPause = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private thinkTimer = 0;
  private wantSlot: 1 | 2 | 3 = 1;
  private crouchEngage = false;
  private stopWhileShooting = true;
  private pendingButtons = 0;
  private lastHitSeen = -1;

  constructor(
    self: Agent,
    private readonly p: BotProfile,
    private readonly utility: boolean,
    private readonly rng: Rng,
  ) {
    this.aimYaw = self.yaw * RAD_PER_UNIT;
    this.strafeDir = rng.float() < 0.5 ? -1 : 1;
  }

  think(world: World, self: Agent, noises: readonly NoiseSource[]): InputFrame {
    if (this.post === null && this.route === null) this.plan(world, self);
    const phase = world.round.phase;
    this.perceive(world, self, noises);

    let buttons = 0;
    let move: { x: number; z: number } | null = null;
    let walk = false;
    let lookAt: { x: number; y: number; z: number } | null = null;

    // weapon choice
    const target = this.targetId >= 0 ? world.agents[this.targetId] : null;
    if (target && this.wantSlot === 3) {
      const d = dist2(self, target);
      if (d < 8) this.setSlot(2);
    }
    const cur = self.weapon.current;
    const curSlot = WEAPONS[cur].slot;
    if (curSlot !== this.wantSlot) buttons |= this.wantSlot === 1 ? Btn.Weapon1 : this.wantSlot === 2 ? Btn.Weapon2 : Btn.Weapon3;

    if (phase === 'prep') {
      this.action = 'idle';
      lookAt = this.defaultLook(world, self);
    } else {
      if (--this.thinkTimer <= 0) {
        this.thinkTimer = 6;
        this.decide(world, self);
      }
      switch (this.action) {
        case 'engage': {
          if (!target) break;
          lookAt = this.aimPoint(target);
          const d = dist2(self, target);
          const dw = WEAPONS[cur];
          // sniper: scope in; rifle at long range: crouch tap
          if (dw.ads.scoped) buttons |= Btn.Ads;
          if (this.crouchEngage && d > 22) buttons |= Btn.Crouch;
          // movement while engaging
          if (!this.stopWhileShooting || this.burstPause > 0) {
            if (--this.strafeTimer <= 0) {
              this.strafeTimer = Math.round(TICK * this.rng.range(0.25, 0.7));
              this.strafeDir = -this.strafeDir;
            }
            const yaw = this.aimYaw;
            move = { x: cos(yaw) * this.strafeDir, z: -sin(yaw) * this.strafeDir };
          } else if (d > dw.idealRange[1] && this.utility) {
            move = this.followTo(world, self, target, 0);
            walk = true;
          }
          if (this.canShoot(self, target, d)) buttons |= Btn.Fire;
          break;
        }
        case 'retreat': {
          if (this.retreatTo) {
            move = this.followTo(world, self, this.retreatTo, 0.6);
            if (this.retreatTimer === 0 && self.dashCharges > 0 && self.hp < 40) {
              buttons |= Btn.Ability2;
              this.retreatTimer = 1;
            }
          }
          lookAt = this.lastThreatPoint(world) ?? this.defaultLook(world, self);
          if (self.weapon.ammo[cur].mag < WEAPONS[cur].magSize * 0.5) buttons |= Btn.Reload;
          break;
        }
        case 'investigate': {
          const m = this.freshestMemory(world);
          if (m) {
            move = this.followTo(world, self, m, 2.5);
            walk = this.utility && this.p.coordination > 0.5 && dist2(self, m) < 18;
            lookAt = { x: m.x, y: m.y + 1.4, z: m.z };
          }
          break;
        }
        case 'hold':
        case 'rotate': {
          const post = this.post!;
          const goal = { x: post.x, y: 0, z: post.z };
          if (dist2(self, goal) > 0.8) {
            move = this.followTo(world, self, goal, 0.5);
            walk = this.action === 'hold' && dist2(self, goal) < 6;
            lookAt = dist2(self, goal) < 8 ? { x: post.lookX, y: 1.5, z: post.lookZ } : null;
          } else {
            lookAt = { x: post.lookX, y: 1.5, z: post.lookZ };
          }
          break;
        }
        case 'push': {
          const route = this.route!;
          const wp = route.waypoints[Math.min(this.routeIdx, route.waypoints.length - 1)];
          const goal = { x: wp.x, y: 0, z: wp.z };
          if (dist2(self, goal) < 2.2 && this.routeIdx < route.waypoints.length - 1) this.routeIdx++;
          move = this.followTo(world, self, goal, 1);
          // smoke on the way in
          if (this.utility && !this.smokeUsedPlan && this.routeIdx >= route.smokeAt && self.smokeCharges > 0 && this.rng.float() < 0.02 + this.p.coordination * 0.05) {
            this.smokeAim = route.smokeTarget;
            this.smokeUsedPlan = true;
          }
          const next = route.waypoints[Math.min(this.routeIdx + 1, route.waypoints.length - 1)];
          lookAt = { x: next.x, y: 1.5, z: next.z };
          break;
        }
        case 'capture':
        case 'retake': {
          const relay = world.map.relay;
          const goal = { x: relay.x + (self.id % 2 === 0 ? -2.5 : 2.5), y: relay.y, z: relay.z - 2.5 };
          move = this.followTo(world, self, goal, 1);
          lookAt = this.lastThreatPoint(world) ?? { x: relay.x, y: 1.5, z: relay.z + 8 };
          break;
        }
        case 'idle':
          lookAt = this.defaultLook(world, self);
          break;
      }

      // pending smoke throw: look at the target arc first, then throw
      if (this.smokeAim && self.smokeCharges > 0 && this.action !== 'engage') {
        const pitch = throwPitch(self, this.smokeAim);
        const yaw = atan2(this.smokeAim.x - self.x, this.smokeAim.z - self.z);
        this.turnTo(yaw, pitch);
        if (Math.abs(angleDiffRad(this.aimYaw, yaw)) < 3 * DEG && Math.abs(this.aimPitch - pitch) < 3 * DEG) {
          buttons |= Btn.Ability1;
          this.smokeAim = null;
        }
        lookAt = null;
      }
      // reload when safe
      const ammo = self.weapon.ammo[cur];
      if (this.action !== 'engage' && ammo.mag < WEAPONS[cur].magSize * 0.4 && ammo.reserve > 0) buttons |= Btn.Reload;
    }

    if (lookAt) {
      const ey = self.y + eyeHeight(self);
      const dx = lookAt.x - self.x;
      const dz = lookAt.z - self.z;
      const yaw = atan2(dx, dz);
      const pitch = atan2(lookAt.y - ey, Math.sqrt(dx * dx + dz * dz));
      let ty = yaw;
      let tp = pitch;
      if (this.action === 'engage') {
        ty += this.errYaw;
        tp += this.errPitch;
        // compensate a fraction of our own recoil
        tp -= self.weapon.recoilPitch * this.p.sprayControl;
        ty -= self.weapon.recoilYaw * this.p.sprayControl;
      }
      this.turnTo(ty, tp);
    }

    if (move) buttons |= this.moveButtons(move.x, move.z);
    if (walk) buttons |= Btn.Walk;
    buttons |= this.pendingButtons;
    this.pendingButtons = 0;
    return {
      buttons,
      yaw: wrapYaw(radToUnits(this.aimYaw)),
      pitch: radToUnits(this.aimPitch),
    };
  }

  // ---------------------------------------------------------------- planning

  private plan(world: World, self: Agent): void {
    const mates = world.agents.filter((a) => a.team === self.team);
    const idx = mates.indexOf(self);
    const t = world.map.tactics;
    if (self.team === 1) {
      // defenders: every bot gets its own post (no two stand on the same spot)
      const order = defenderPosts(t, mates.length, new TeamRng(world.roundSeed(world.round.index) ^ 0xd3f3));
      this.post = order[idx % order.length];
      // one defender takes the long-range rifle
      this.setSlot(idx === 1 && this.rng.float() < 0.7 ? 3 : 1);
    } else {
      // attackers: coordinated teams stack one route, others split
      const shared = this.rngShared(world, self.team);
      const stack = shared < this.p.coordination;
      const n = t.routes.length;
      const r = stack ? Math.floor(shared * 1000) % n : (idx + Math.floor(this.rng.float() * n)) % n;
      this.route = t.routes[r];
      this.routeIdx = 0;
      this.setSlot(1);
    }
    this.crouchEngage = this.rng.float() < this.p.coordination * 0.6;
    this.stopWhileShooting = this.rng.float() < this.p.stopToShoot;
  }

  /** A value every bot of a team agrees on this round (derived from the round seed). */
  private rngShared(world: World, team: number): number {
    const s = world.roundSeed(world.round.index) ^ (team * 0x51ed27);
    return ((Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0) % 10000) / 10000;
  }

  private setSlot(slot: 1 | 2 | 3): void {
    this.wantSlot = slot;
  }

  // -------------------------------------------------------------- perception

  private perceive(world: World, self: Agent, noises: readonly NoiseSource[]): void {
    const eyeY = self.y + eyeHeight(self);
    const fovCos = cos((this.p.fovDeg / 2) * DEG);
    const fx = sin(this.aimYaw);
    const fz = cos(this.aimYaw);
    let best = -1;
    let bestScore = -Infinity;
    for (const e of world.agents) {
      if (e.team === self.team || !e.alive) {
        this.seenTicks.delete(e.id);
        continue;
      }
      const dx = e.x - self.x;
      const dz = e.z - self.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      let visible = false;
      if (d < this.p.sightRange) {
        const inFov = d < 2.5 || (dx * fx + dz * fz) / Math.max(1e-6, d) > fovCos;
        if (inFov) {
          const headY = e.y + e.height - 0.15;
          const chestY = e.y + e.height * 0.65;
          visible = world.canSee(self.x, eyeY, self.z, e.x, headY, e.z) || world.canSee(self.x, eyeY, self.z, e.x, chestY, e.z);
        }
      }
      if (visible) {
        const n = (this.seenTicks.get(e.id) ?? 0) + 1;
        this.seenTicks.set(e.id, n);
        if (n === 1) {
          // reaction time, faster if we were expecting them there
          const m = this.memory.get(e.id);
          const expected = m && world.round.tick - m.tick < TICK * 3 && hyp(m.x - e.x, m.z - e.z) < 6;
          const base = (this.p.reactionMs / 1000) * TICK * (expected ? 0.6 : 1);
          this.reactionTicks.set(e.id, Math.max(3, Math.round(base * this.rng.range(0.8, 1.25))));
        }
        this.memory.set(e.id, { x: e.x, y: e.y, z: e.z, tick: world.round.tick, seen: true });
        const acquired = n >= (this.reactionTicks.get(e.id) ?? 0);
        if (acquired) {
          const score = -d + (e.id === this.targetId ? 6 : 0) - e.hp * 0.02;
          if (score > bestScore) {
            bestScore = score;
            best = e.id;
          }
        }
      } else {
        this.seenTicks.delete(e.id);
      }
    }
    if (best !== this.targetId) {
      this.targetId = best;
      this.trackTime = 0;
      if (best >= 0) {
        this.aimHead = this.rng.float() < this.p.headshotBias;
        this.rollError(1);
      }
    }
    if (best >= 0) {
      this.trackTime += DT;
      if (--this.errTimer <= 0) this.rollError(Math.max(0, 1 - this.trackTime / this.p.settleTime));
    }

    // got shot: we know roughly where from
    if (self.lastHitTick >= 0 && self.lastHitTick !== this.lastHitSeen) {
      this.lastHitSeen = self.lastHitTick;
      const att = world.agents[self.lastAttacker];
      if (att) {
        this.memory.set(att.id, { x: att.x, y: att.y, z: att.z, tick: world.round.tick, seen: false });
        this.reactionTicks.set(att.id, Math.round((this.p.reactionMs / 1000) * TICK * 0.5));
      }
    }

    // hearing
    for (const nz of noises) {
      const src = world.agents[nz.agent];
      if (!src || src.team === self.team) continue;
      const dx = nz.x - self.x;
      const dz = nz.z - self.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      let range = Math.min(nz.radius, this.p.hearingRange * (nz.radius / 25));
      if (d > range) continue;
      if (!world.canSee(self.x, eyeY, self.z, nz.x, nz.y + 1, nz.z)) range *= 0.5;
      if (d > range) continue;
      const err = 1 + d * 0.06;
      const m: Memory = {
        x: nz.x + this.rng.range(-err, err),
        y: nz.y,
        z: nz.z + this.rng.range(-err, err),
        tick: world.round.tick,
        seen: false,
      };
      this.heard = m;
      const prev = this.memory.get(nz.agent);
      if (!prev || !prev.seen || world.round.tick - prev.tick > TICK) this.memory.set(nz.agent, m);
    }
  }

  private rollError(scale: number): void {
    const p = this.p;
    const sd = (p.settledErrorDeg + (p.aimErrorDeg - p.settledErrorDeg) * scale) * DEG;
    this.errYaw = this.rng.gaussian() * sd;
    this.errPitch = this.rng.gaussian() * sd * 0.6;
    this.errTimer = Math.round(TICK * this.rng.range(0.25, 0.5));
  }

  // ---------------------------------------------------------------- decision

  private decide(world: World, self: Agent): void {
    const target = this.targetId >= 0 ? world.agents[this.targetId] : null;
    const r = world.round;
    if (!this.utility) {
      // Tier 0 FSM: engage > investigate (recent, close) > objective
      if (target) this.action = 'engage';
      else {
        const m = this.freshestMemory(world);
        if (m && m.seen && world.round.tick - m.tick < TICK * 4) this.action = 'investigate';
        else this.action = self.team === 1 ? (r.captureProgress > 0 ? 'retake' : 'hold') : this.atSite(world, self) ? 'capture' : 'push';
      }
      return;
    }

    const scores: [Action, number][] = [];
    const ammo = self.weapon.ammo[self.weapon.current];
    const lowHp = self.hp / self.maxHp;
    if (target) {
      let s = 0.9;
      if (ammo.mag === 0 || self.weapon.reload > 0) s -= 0.35;
      if (lowHp < 0.35) s -= 0.25;
      scores.push(['engage', s]);
      // retreat to cover when weak or reloading
      let rs = (lowHp < 0.4 ? 0.5 : 0) + (self.weapon.reload > 0 ? 0.35 : 0) + this.p.coordination * 0.15;
      if (this.action === 'retreat') rs += 0.15;
      scores.push(['retreat', rs]);
    } else if (this.action === 'retreat' && this.retreatTo && dist2(self, this.retreatTo) > 1) {
      scores.push(['retreat', 0.55]);
    }

    const m = this.freshestMemory(world);
    if (m) {
      const age = (world.round.tick - m.tick) / TICK;
      const s = (m.seen ? 0.7 : 0.55) * Math.max(0, 1 - age / 8) * (self.team === 1 ? 0.6 + this.p.coordination * 0.3 : 0.9);
      scores.push(['investigate', s]);
    }

    if (self.team === 1) {
      const cap = r.captureProgress;
      const siteThreat = world.siteOccupancy() & 1;
      scores.push(['retake', cap > 0 || siteThreat ? 0.6 + cap * 0.35 : 0.0]);
      scores.push(['hold', 0.42]);
      // rotate toward a contested entrance when a teammate fights there
      const hot = this.hotEntrance(world);
      if (hot && this.post && !this.post.forward && hot.id !== this.post.entrance && this.rng.float() < this.p.coordination) {
        const options = world.map.tactics.posts.filter((p) => p.entrance === hot.id && !p.forward);
        if (options.length) this.post = options[(self.id + world.round.index) % options.length];
        // defensive smoke to stall the push
        if (!this.smokeUsedPlan && self.smokeCharges > 0 && this.rng.float() < this.p.coordination) {
          this.smokeAim = hot.smoke;
          this.smokeUsedPlan = true;
        }
      }
    } else {
      const left = world.phaseTimeLeft();
      if (this.atSite(world, self)) scores.push(['capture', 0.7 + (left < 30 ? 0.2 : 0)]);
      scores.push(['push', 0.45 + (left < 40 ? 0.25 : 0)]);
    }

    scores.sort((a, b) => b[1] - a[1]);
    const next = scores[0][0];
    if (next === 'retreat' && this.action !== 'retreat') {
      this.retreatTo = this.findCover(world, self, target);
      this.retreatTimer = 0;
      if (!this.retreatTo) {
        this.action = scores[1]?.[0] ?? 'engage';
        return;
      }
    }
    this.action = next;
  }

  private atSite(world: World, self: Agent): boolean {
    const z = world.map.siteZone;
    return self.x >= z.minX - 4 && self.x <= z.maxX + 4 && self.z >= z.minZ - 4 && self.z <= z.maxZ + 4 && (this.route ? this.routeIdx >= this.route.waypoints.length - 2 : true);
  }

  /** Entrance where a teammate recently saw/heard enemies. */
  private hotEntrance(world: World) {
    let latest: Memory | null = null;
    for (const m of this.memory.values()) if (!latest || m.tick > latest.tick) latest = m;
    if (this.heard && (!latest || this.heard.tick > latest.tick)) latest = this.heard;
    if (!latest || world.round.tick - latest.tick > TICK * 2) return null;
    // only react to enemies already close to one of the site entrances
    const e = nearestEntrance(world.map.tactics, latest.x, latest.z);
    if (!e || Math.sqrt((e.x - latest.x) ** 2 + (e.z - latest.z) ** 2) > 22) return null;
    return e;
  }

  private freshestMemory(world: World): Memory | null {
    let best: Memory | null = null;
    for (const [id, m] of this.memory) {
      if (!world.agents[id].alive) continue;
      if (!best || m.tick > best.tick) best = m;
    }
    if (this.heard && (!best || this.heard.tick > best.tick)) best = this.heard;
    if (best && world.round.tick - best.tick > TICK * 8) return null;
    return best;
  }

  private lastThreatPoint(world: World): { x: number; y: number; z: number } | null {
    const m = this.freshestMemory(world);
    return m ? { x: m.x, y: m.y + 1.4, z: m.z } : null;
  }

  /** Nearby walkable cell hidden from the threat. */
  private findCover(world: World, self: Agent, threat: Agent | null): NavPoint | null {
    const t = threat ?? null;
    if (!t) return null;
    const nav = world.nav;
    const ty = t.y + eyeHeight(t);
    let best: NavPoint | null = null;
    let bestD = Infinity;
    for (let dz = -9; dz <= 9; dz += 1.5) {
      for (let dx = -9; dx <= 9; dx += 1.5) {
        const d2 = dx * dx + dz * dz;
        if (d2 > 81 || d2 >= bestD) continue;
        const i = nav.index(self.x + dx, self.z + dz);
        if (!nav.walkable(i) || nav.component[i] !== nav.component[nav.index(self.x, self.z)]) continue;
        const c = nav.centre(i);
        if (world.canSee(t.x, ty, t.z, c.x, c.y + 1.0, c.z)) continue;
        bestD = d2;
        best = c;
      }
    }
    return best;
  }

  private defaultLook(_world: World, self: Agent): { x: number; y: number; z: number } {
    if (this.post) return { x: this.post.lookX, y: 1.5, z: this.post.lookZ };
    if (this.route) {
      const wp = this.route.waypoints[Math.min(this.routeIdx, this.route.waypoints.length - 1)];
      return { x: wp.x, y: 1.5, z: wp.z };
    }
    return { x: self.x, y: 1.5, z: self.z + 10 * (self.team === 0 ? 1 : -1) };
  }

  // ------------------------------------------------------------------ aiming

  private aimPoint(t: Agent): { x: number; y: number; z: number } {
    const y = this.aimHead ? t.y + t.height - 0.15 : t.y + t.height * 0.62;
    // light lead on moving targets
    return { x: t.x + t.vx * 0.04, y, z: t.z + t.vz * 0.04 };
  }

  private turnTo(yaw: number, pitch: number): void {
    const maxStep = this.p.turnSpeedDeg * DEG * DT;
    const dy = angleDiffRad(this.aimYaw, yaw);
    const dp = pitch - this.aimPitch;
    // proportional approach with a speed cap: fast flicks that ease in
    const sy = Math.max(-maxStep, Math.min(maxStep, dy * 0.35));
    const sp = Math.max(-maxStep, Math.min(maxStep, dp * 0.35));
    this.aimYaw += Math.abs(dy) < 0.002 ? dy : sy;
    this.aimPitch += Math.abs(dp) < 0.002 ? dp : sp;
    if (this.aimYaw > PI) this.aimYaw -= 2 * PI;
    if (this.aimYaw < -PI) this.aimYaw += 2 * PI;
    this.aimPitch = Math.max(-HALF_PI * 0.95, Math.min(HALF_PI * 0.95, this.aimPitch));
  }

  private canShoot(self: Agent, target: Agent, d: number): boolean {
    const w = self.weapon;
    const dw = WEAPONS[w.current];
    if (w.reload > 0 || w.equip > 0) return false;
    if (this.burstPause > 0) {
      this.burstPause--;
      return false;
    }
    const ap = this.aimPoint(target);
    const ey = self.y + eyeHeight(self);
    const dx = ap.x - self.x;
    const dz = ap.z - self.z;
    const yaw = atan2(dx, dz) + this.errYaw;
    const pitch = atan2(ap.y - ey, Math.sqrt(dx * dx + dz * dz)) + this.errPitch;
    const off = Math.abs(angleDiffRad(this.aimYaw, yaw)) + Math.abs(this.aimPitch - pitch);
    const tol = Math.max(1.2 * DEG, atan2(0.4, d));
    if (off > tol) return false;
    if (dw.ads.scoped && (w.ads < 0.95 || horizontalSpeed(self) > 1)) return false;
    if (this.stopWhileShooting && horizontalSpeed(self) > MOVEMENT.walkSpeed && !dw.ads.scoped) return false;
    if (dw.automatic) {
      this.burstShots++;
      const burst = d > 25 ? 3 : d > 12 ? 6 : 12;
      if (this.burstShots >= burst * 6) {
        this.burstShots = 0;
        this.burstPause = Math.round(TICK * (d > 25 ? 0.3 : 0.2));
      }
      return true;
    }
    // semi-auto: tap; the weapon handles the fire interval
    return w.cooldown <= 0 && !w.triggerHeld;
  }

  // ---------------------------------------------------------------- movement

  private followTo(world: World, self: Agent, goal: { x: number; y: number; z: number }, arrive: number): { x: number; z: number } | null {
    const gx = goal.x;
    const gz = goal.z;
    const dGoal = hyp(gx - self.x, gz - self.z);
    if (dGoal < arrive) return null;
    const goalMoved = !this.pathGoal || hyp(this.pathGoal.x - gx, this.pathGoal.z - gz) > 2;
    if (goalMoved || this.path.length === 0 || --this.repathTimer <= 0) {
      const p = world.nav.findPath({ x: self.x, y: self.y, z: self.z }, { x: gx, y: goal.y, z: gz });
      this.path = p ?? [];
      this.pathIdx = 0;
      this.pathGoal = { x: gx, y: goal.y, z: gz };
      this.repathTimer = TICK * 2;
    }
    while (this.pathIdx < this.path.length - 1 && hyp(this.path[this.pathIdx].x - self.x, this.path[this.pathIdx].z - self.z) < 0.7) this.pathIdx++;
    const wp = this.path[this.pathIdx] ?? { x: gx, z: gz };
    const dx = wp.x - self.x;
    const dz = wp.z - self.z;
    const l = hyp(dx, dz);
    if (l < 1e-3) return null;
    const ux = dx / l;
    const uz = dz / l;

    // stuck detection: wanting to move but not getting anywhere
    const prog = hyp(self.x - this.lastProgressPos.x, self.z - this.lastProgressPos.z);
    if (prog > 0.5) {
      this.lastProgressPos = { x: self.x, z: self.z };
      this.stuckTimer = 0;
      this.stuckLevel = 0;
    } else this.stuckTimer++;
    if (this.unstickTicks > 0) {
      this.unstickTicks--;
      return this.unstickDir;
    }
    if (this.stuckTimer > TICK * 0.6) {
      // sidestep toward the more open side (slightly backing off), then re-route
      this.stuckTimer = 0;
      this.stuckLevel++;
      const px = -uz;
      const pz = ux;
      const open = (sx: number, sz: number): number => world.bvh.raycast(self.x, self.y + 0.6, self.z, sx, 0, sz, 2.5)?.t ?? 2.5;
      const side = open(px, pz) >= open(-px, -pz) ? 1 : -1;
      const ox = px * side - ux * 0.45;
      const oz = pz * side - uz * 0.45;
      const ol = hyp(ox, oz);
      this.unstickDir = { x: ox / ol, z: oz / ol };
      this.unstickTicks = Math.round(TICK * 0.35);
      if (this.stuckLevel >= 2) this.pendingButtons |= Btn.Jump;
      this.path = [];
      return this.unstickDir;
    }
    return { x: ux, z: uz };
  }

  /** Convert a world-space move direction into WASD relative to the current view. */
  /**
   * World-space move direction → WASD relative to the view. Only 8 directions
   * exist, so we alternate between the two nearest ones (sigma-delta
   * dithering): the average heading then matches the path exactly instead of
   * snapping to 45° steps, which used to wedge bots on doorway corners.
   */
  private moveButtons(mx: number, mz: number): number {
    const c = cos(this.aimYaw);
    const s = sin(this.aimYaw);
    const right = mx * c - mz * s;
    const fwd = mx * s + mz * c;
    const q = atan2(right, fwd) / (PI / 4); // 0 = forward, +2 = right
    const lo = Math.floor(q);
    this.ditherAcc += q - lo;
    let k = lo;
    if (this.ditherAcc >= 1) {
      this.ditherAcc -= 1;
      k = lo + 1;
    }
    return MOVE_DIRS[((k % 8) + 8) % 8];
  }
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return hyp(a.x - b.x, a.z - b.z);
}

/** Math.hypot is not required to be correctly rounded; sqrt is. */
function hyp(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/** Pitch that lands a thrown smoke near the target on flat ground (numeric search). */
export function throwPitch(self: Agent, target: { x: number; z: number }): number {
  const S = ABILITIES.smoke;
  const want = hyp(target.x - self.x, target.z - self.z);
  const h0 = self.y + eyeHeight(self) - 0.1;
  let best = 0;
  let bestErr = Infinity;
  for (let deg = -10; deg <= 50; deg += 2) {
    const p = (deg + 4.6) * DEG; // the sim adds 0.08 rad when throwing
    const vh = cos(p) * S.throwSpeed;
    const vy = sin(p) * S.throwSpeed + S.throwLift;
    // time to hit the ground: h0 + vy t - g t²/2 = 0 (capped by the fuse)
    const t = Math.min(S.fuse, (vy + Math.sqrt(vy * vy + 2 * S.gravity * h0)) / S.gravity);
    const err = Math.abs(vh * t - want);
    if (err < bestErr) {
      bestErr = err;
      best = deg * DEG;
    }
  }
  return best;
}

/**
 * Post assignment for a defending team: about 40 % of defenders hold forward
 * posts (meeting attackers on the way in), the rest are spread round-robin
 * over the site entrances so every entrance is covered before any doubles up.
 * The order is shuffled per round with a team-shared RNG.
 */
export function defenderPosts(t: Tactics, defenders: number, rng: TeamRng): Post[] {
  const shuffle = <T>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const site = t.posts.filter((p) => !p.forward);
  const fwd = shuffle(t.posts.filter((p) => p.forward));
  const entrances = shuffle([...new Set(site.map((p) => p.entrance))]);
  const perEntrance = entrances.map((e) => shuffle(site.filter((p) => p.entrance === e)));
  const siteOrder: Post[] = [];
  for (let k = 0; siteOrder.length < site.length; k++) {
    for (const list of perEntrance) if (k < list.length) siteOrder.push(list[k]);
  }
  const nFwd = fwd.length ? Math.min(fwd.length, Math.floor(defenders * 0.4)) : 0;
  const out: Post[] = [];
  for (let i = 0; i < defenders; i++) {
    if (i < nFwd) out.push(fwd[i]);
    else out.push(siteOrder[(i - nFwd) % siteOrder.length] ?? fwd[i % Math.max(1, fwd.length)]);
  }
  return out;
}
