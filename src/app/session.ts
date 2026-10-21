import { MOVEMENT } from '../config/movement';
import type { QualityPreset } from '../config/quality';
import type { InputManager } from '../input/input-manager';
import type { EngineHandle } from '../render/engine';
import { GameRenderer } from '../render/game-renderer';
import { FixedStep } from '../sim/core/fixed-step';
import { RAD_PER_UNIT } from '../sim/core/fmath';
import { type Agent, eyeHeight, horizontalSpeed } from '../sim/entities/agent';
import { zoneAt } from '../sim/map/map-def';
import { World } from '../sim/world';

interface Pose {
  x: number;
  y: number;
  z: number;
  eye: number;
}

function poseOf(a: Agent, out: Pose): Pose {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  out.eye = eyeHeight(a);
  return out;
}

/**
 * One running match: wires input → fixed-step sim → interpolated render.
 * P1 scope: a single player walking the greybox.
 */
export class Session {
  readonly world: World;
  readonly renderer: GameRenderer;
  readonly player: Agent;
  private readonly step = new FixedStep(1 / MOVEMENT.tickRate);
  private prev: Pose = { x: 0, y: 0, z: 0, eye: 0 };
  private cur: Pose = { x: 0, y: 0, z: 0, eye: 0 };
  private lastTime = performance.now();
  /** frame time stats for the debug overlay and the adaptive quality controller */
  frameMs = 16.7;

  constructor(
    readonly gfx: EngineHandle,
    readonly input: InputManager,
    quality: QualityPreset,
    seed: number,
  ) {
    this.world = new World({ seed });
    this.player = this.world.addAgent({ team: 0, isBot: false, name: 'YOU' });
    this.world.spawnAll();
    this.input.setLook(this.player.yaw, 0);
    poseOf(this.player, this.prev);
    poseOf(this.player, this.cur);
    this.renderer = new GameRenderer(gfx.engine, this.world.map, quality);
  }

  frame(): void {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1;

    const steps = this.step.advance(dt);
    for (let i = 0; i < steps; i++) {
      const tmp = this.prev;
      this.prev = this.cur;
      this.cur = tmp;
      this.world.step([this.input.sample()]);
      poseOf(this.player, this.cur);
    }

    const t = this.step.alpha;
    const p = this.prev;
    const c = this.cur;
    this.renderer.setCamera({
      x: p.x + (c.x - p.x) * t,
      y: p.y + (c.y - p.y) * t + (p.eye + (c.eye - p.eye) * t),
      z: p.z + (c.z - p.z) * t,
      // View angles come straight from the mouse for zero added latency.
      yaw: this.input.lookYaw * RAD_PER_UNIT,
      pitch: this.input.lookPitch * RAD_PER_UNIT,
    });
    this.renderer.render();
  }

  debugText(): string {
    const a = this.player;
    return [
      `${this.gfx.kind.toUpperCase()}  ${(1000 / this.frameMs).toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms`,
      `tick ${this.world.tick}`,
      `pos ${a.x.toFixed(2)} ${a.y.toFixed(2)} ${a.z.toFixed(2)}`,
      `speed ${horizontalSpeed(a).toFixed(2)} m/s  ${a.grounded ? 'ground' : 'air'}  crouch ${a.crouch.toFixed(2)}`,
    ].join('\n');
  }

  callout(): string {
    return zoneAt(this.world.map, this.player.x, this.player.z);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
