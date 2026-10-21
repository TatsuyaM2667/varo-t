import { BOT_NAMES } from '../config/bots';
import { MOVEMENT } from '../config/movement';
import { LIGHTING_MOODS } from '../config/visuals';
import { GameRenderer } from '../render/game-renderer';
import { FixedStep } from '../sim/core/fixed-step';
import type { SimEvent } from '../sim/events';
import { World, type AgentSpec } from '../sim/world';
import type { CameraPose } from '../render/game-renderer';
import { Hud } from '../ui/hud';
import { SmoothCam, shoulderCam } from './cameras';
import type { ModeContext } from './match';
import { WorldView } from './world-view';

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
    this.renderer.setMood(LIGHTING_MOODS[1 % LIGHTING_MOODS.length]);
    this.view = new WorldView(this.renderer, null, this.world);
    this.view.onEvent = (e) => this.onEvent(e);
    this.hud = new Hud(ctx.ui);
    this.hud.setLite(true);
    this.hud.setMinimap(null);
    this.hud.setVisible(false);
  }

  private newWorld(): World {
    const roster: AgentSpec[] = [];
    if (this.bots) {
      for (let i = 0; i < 3; i++) roster.push({ team: 0, isBot: true, name: BOT_NAMES[(i + 3) % BOT_NAMES.length], difficulty: 'hard' });
      for (let i = 0; i < 3; i++) roster.push({ team: 1, isBot: true, name: BOT_NAMES[i], difficulty: 'normal' });
    }
    const w = new World({
      seed: (Date.now() + this.matchCount * 7919) >>> 0,
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
    if (e.type === 'phase' && e.phase === 'prep') this.renderer.setMood(LIGHTING_MOODS[(e.round + 1) % LIGHTING_MOODS.length]);
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
      // cinematic orbit around the site
      const a = this.time * 0.08;
      const r = 26;
      const s = w.map.relay;
      target = { x: s.x + Math.sin(a) * r, y: 9, z: s.z + Math.cos(a) * r, yaw: a + Math.PI, pitch: -0.28 };
      this.cam.follow(target, dt, 2);
    } else {
      target = shoulderCam(this.view.eye(this.focus, this.step.alpha), w.bvh, 3.2, 0.7, 0.6);
      this.cam.follow(target, dt, 4);
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
          total: [3, 3],
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
