import { BOT_NAMES } from '../config/bots';
import { MOVEMENT } from '../config/movement';
import { GameRenderer } from '../render/game-renderer';
import { FixedStep } from '../sim/core/fixed-step';
import type { SimEvent } from '../sim/events';
import { World, type AgentSpec } from '../sim/world';
import type { CameraPose } from '../render/game-renderer';
import { Hud } from '../ui/hud';
import { SmoothCam, shoulderCam } from './cameras';
import type { ModeContext } from './match';
import { WorldView } from './world-view';
import { STAGES } from '../sim/map/registry';

/** bots per side in the title-screen demo */
const ATTRACT_TEAM = 4;

const TICK = MOVEMENT.tickRate;

/**
 * Title-screen background. With `attractMode` on, bots play a full match
 * against each other and a director camera follows the action (cuts to the
 * killer on kills, to the site during captures). With it off, a slow
 * cinematic orbit of the empty map.
 */
export class AttractMode {
  private world: World;
  readonly renderer: GameRenderer;
  private view: WorldView;
  private readonly step = new FixedStep(1 / TICK);
  private readonly cam = new SmoothCam();
  private focus = 0;
  private lastFocus = -1;
  private focusTimer = 0;
  private time = 0;
  private readonly hud: Hud;
  private matchCount = 0;
  /** true once the title UI has been hidden for the full-screen demo */
  showcase = false;

  constructor(
    private readonly ctx: ModeContext,
    private readonly bots: boolean,
  ) {
    this.world = this.newWorld();
    this.renderer = new GameRenderer(ctx.gfx.engine, this.world.map, this.world.agents, ctx.quality, ctx.features);
    this.renderer.setMood(this.renderer.moods[1 % this.renderer.moods.length]);
    this.view = new WorldView(this.renderer, null, this.world);
    this.view.onEvent = (e) => this.onEvent(e);
    this.hud = new Hud(ctx.ui, ctx.input.bindings);
    this.hud.setLite(true);
    this.hud.setMinimap(null);
    this.hud.setVisible(false);
  }

  private newWorld(): World {
    const roster: AgentSpec[] = [];
    if (this.bots) {
      for (let i = 0; i < ATTRACT_TEAM; i++) roster.push({ team: 0, isBot: true, name: BOT_NAMES[(i + 3) % BOT_NAMES.length], difficulty: 'hard' });
      for (let i = 0; i < ATTRACT_TEAM; i++) roster.push({ team: 1, isBot: true, name: BOT_NAMES[i % BOT_NAMES.length], difficulty: 'normal' });
    }
    // cycle through the stage maps so visitors see all of them
    const mapId = STAGES[this.matchCount % STAGES.length].map;
    const w = new World({
      mapId,
      // ?seed=N makes the demo reproducible (performance profiling)
      seed: ((Number(new URLSearchParams(location.search).get('seed')) || Date.now()) + this.matchCount * 7919) >>> 0,
      roster,
      roundsToWin: 2,
      features: { utilityAi: true, destructibles: this.ctx.features.destructibles, seededMap: false },
    });
    w.startMatch();
    this.matchCount++;
    return w;
  }

  setShowcase(on: boolean): void {
    this.showcase = on;
    this.hud.setVisible(on && this.bots);
  }

  private onEvent(e: SimEvent): void {
    if (e.type === 'kill' && this.showcase) {
      const k = this.world.agents[e.killer];
      const v = this.world.agents[e.victim];
      this.hud.kill(k.name, v.name, k.team, v.team, e.weapon, e.headshot, false);
    }
    if (e.type === 'kill') {
      this.focus = e.killer;
      this.focusTimer = 4;
    }
    if (e.type === 'phase' && e.phase === 'prep') this.renderer.setMood(this.renderer.moods[(e.round + 1) % this.renderer.moods.length]);
  }

  frame(realDt: number): void {
    const dt = Math.min(0.1, realDt);
    this.time += dt;
    const w = this.world;
    if (this.bots) {
      const steps = this.step.advance(dt);
      for (let i = 0; i < steps; i++) {
        w.step([]);
        this.view.afterTick();
      }
      if (w.round.phase === 'matchOver') {
        // loop forever with a fresh match
        this.world = this.newWorld();
        this.view.attach(this.world);
        this.renderer.setMood(this.renderer.moods[0]);
      }
    }

    let target: CameraPose;
    const alive = w.agents.filter((a) => a.alive);
    this.focusTimer -= dt;
    if (!w.agents[this.focus]?.alive || this.focusTimer <= 0) {
      if (alive.length) {
        // prefer whoever is closest to an enemy (where the action is)
        let best = alive[0];
        let bestD = Infinity;
        for (const a of alive) {
          for (const b of alive) {
            if (a.team === b.team) continue;
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            if (d < bestD) {
              bestD = d;
              best = a;
            }
          }
        }
        this.focus = best.id;
      }
      this.focusTimer = 8;
    }
    if (!this.bots || alive.length === 0 || w.round.phase === 'prep') {
      // cinematic orbit around the site, pulled in front of any wall in the way
      const a = this.time * 0.08;
      const s = w.map.relay;
      const cy = s.y + 7;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const dy = (cy - (s.y + 2)) / 18;
      const len = Math.hypot(dx, dy, dz);
      const hit = w.bvh.raycast(s.x, s.y + 2, s.z, dx / len, dy / len, dz / len, 18 * len);
      const r = hit ? Math.max(4, (hit.t / len) - 1.2) : 18;
      const camY = s.y + 2 + dy * r;
      target = { x: s.x + dx * r, y: camY, z: s.z + dz * r, yaw: a + Math.PI, pitch: -Math.atan2(camY - s.y - 1, r) };
      if (this.lastFocus !== -2) this.cam.snap(target);
      else this.cam.follow(target, dt, 2);
      this.lastFocus = -2;
    } else {
      const eye = this.view.eye(this.focus, this.step.alpha);
      target = shoulderCam(eye, w.bvh, 3.2, 0.7, 0.6);
      // hard cut when the subject changes or the smoothed camera lost sight of it
      const p = this.cam.pose;
      let cut = this.focus !== this.lastFocus || !p;
      if (p && !cut) {
        const dx = eye.x - p.x;
        const dy = eye.y - p.y;
        const dz = eye.z - p.z;
        const d = Math.hypot(dx, dy, dz);
        cut = d > 8 || !!w.bvh.raycast(p.x, p.y, p.z, dx / d, dy / d, dz / d, d);
      }
      if (cut) this.cam.snap(target);
      else this.cam.follow(target, dt, 7);
      this.lastFocus = this.focus;
    }
    this.view.render(this.step.alpha, this.cam.pose!, -1, dt);
    if (this.showcase && this.bots) {
      this.hud.update(
        {
          hp: 0,
          maxHp: 100,
          weapon: 'rifle',
          mag: 0,
          reserve: 0,
          reloading: 0,
          smokeCharges: 0,
          smokeMax: 0,
          dashCharges: 0,
          dashRecharge: 0,
          score: w.match.score,
          timeLeft: w.phaseTimeLeft(),
          phase: w.round.phase,
          round: w.round.index,
          capture: w.round.captureProgress,
          alive: [w.aliveCount(0), w.aliveCount(1)],
          total: [ATTRACT_TEAM, ATTRACT_TEAM],
          callout: w.agents[this.focus]?.name ?? '',
          spreadPx: 0,
          scoped: false,
          smokeFog: 0,
          hurt: 0,
          dead: true,
        },
        dt,
      );
    }
  }

  dispose(): void {
    this.hud.dispose();
    this.renderer.dispose();
  }
}
