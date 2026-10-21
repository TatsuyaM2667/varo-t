import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AudioEngine } from '../audio/audio-engine';
import { WEAPONS } from '../config/weapons';
import type { AgentPose } from '../render/characters';
import type { CameraPose, GameRenderer } from '../render/game-renderer';
import type { Viewmodel } from '../render/viewmodel';
import { RAD_PER_UNIT } from '../sim/core/fmath';
import { eyeHeight } from '../sim/entities/agent';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';

interface Snap {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  height: number;
  eye: number;
}

function snapOf(w: World, out: Snap[]): void {
  out.length = w.agents.length;
  for (let i = 0; i < w.agents.length; i++) {
    const a = w.agents[i];
    const s = out[i] ?? (out[i] = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, height: 0, eye: 0 });
    s.x = a.x;
    s.y = a.y;
    s.z = a.z;
    s.yaw = a.yaw * RAD_PER_UNIT;
    s.pitch = a.pitch * RAD_PER_UNIT;
    s.height = a.height;
    s.eye = eyeHeight(a);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Presents one World through a GameRenderer: snapshots for interpolation,
 * and turns sim events into effects and sounds. The local agent id decides
 * what is first-person (viewmodel, non-positional sounds).
 */
export class WorldView {
  private prev: Snap[] = [];
  private cur: Snap[] = [];
  world: World;
  localId = -1;
  viewmodel: Viewmodel | null = null;
  /** extra listener for HUD-level reactions */
  onEvent: ((e: SimEvent, w: World) => void) | null = null;

  constructor(
    readonly renderer: GameRenderer,
    readonly audio: AudioEngine | null,
    world: World,
  ) {
    this.world = world;
    this.attach(world);
  }

  /** Switch the presented world (live ↔ killcam/replay). */
  attach(world: World): void {
    this.world = world;
    snapOf(world, this.prev);
    snapOf(world, this.cur);
    this.renderer.syncMap(world.map);
    this.renderer.smoke.sync(world.smokes);
  }

  /** Call after every sim tick of the presented world. */
  afterTick(): void {
    const tmp = this.prev;
    this.prev = this.cur;
    this.cur = tmp;
    snapOf(this.world, this.cur);
    for (const e of this.world.events) this.handle(e);
  }

  /** Interpolated eye pose of an agent. */
  eye(id: number, alpha: number): { x: number; y: number; z: number; yaw: number; pitch: number } {
    const p = this.prev[id];
    const c = this.cur[id];
    if (!p || !c) return { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
    return {
      x: p.x + (c.x - p.x) * alpha,
      y: p.y + (c.y - p.y) * alpha + p.eye + (c.eye - p.eye) * alpha,
      z: p.z + (c.z - p.z) * alpha,
      yaw: lerpAngle(p.yaw, c.yaw, alpha),
      pitch: p.pitch + (c.pitch - p.pitch) * alpha,
    };
  }

  private poses(alpha: number): AgentPose[] {
    const out: AgentPose[] = [];
    const w = this.world;
    for (let i = 0; i < w.agents.length; i++) {
      const a = w.agents[i];
      const p = this.prev[i];
      const c = this.cur[i];
      out.push({
        id: a.id,
        team: a.team,
        x: p.x + (c.x - p.x) * alpha,
        y: p.y + (c.y - p.y) * alpha,
        z: p.z + (c.z - p.z) * alpha,
        vx: a.vx,
        vz: a.vz,
        yaw: lerpAngle(p.yaw, c.yaw, alpha),
        pitch: p.pitch + (c.pitch - p.pitch) * alpha,
        height: p.height + (c.height - p.height) * alpha,
        alive: a.alive,
        grounded: a.grounded,
        weapon: a.weapon.current,
      });
    }
    return out;
  }

  render(alpha: number, cam: CameraPose, hideId: number, dt: number): void {
    const r = this.renderer;
    r.syncMap(this.world.map);
    r.syncBreakables(this.world.bvh);
    r.smoke.sync(this.world.smokes);
    r.updateAgents(this.poses(alpha), dt, hideId, this.world.bvh);
    r.setCamera(cam);
    if (this.audio) {
      this.audio.setListener({ x: cam.x, y: cam.y, z: cam.z }, cam.yaw, cam.pitch);
      this.audio.updateEnvironment(dt, this.world.bvh);
    }
    r.render(dt);
  }

  private handle(e: SimEvent): void {
    const w = this.world;
    const r = this.renderer;
    const au = this.audio;
    const local = (id: number): boolean => id === this.localId;
    switch (e.type) {
      case 'shot': {
        const shooter = w.agents[e.agent];
        const hit = new Vector3(e.hx, e.hy, e.hz);
        let from: Vector3;
        if (local(e.agent) && this.viewmodel) {
          this.viewmodel.shoot(e.weapon);
          from = this.viewmodel.muzzleWorld(e.weapon);
        } else {
          from = r.characters.muzzle(e.agent)?.clone() ?? new Vector3(e.ox, e.oy - 0.15, e.oz);
        }
        // tracers on every other rifle shot to keep it readable
        if (e.weapon !== 'rifle' || shooter.weapon.sprayIndex % 2 === 1) r.fx.tracer(from, hit);
        if (e.hitAgent >= 0) {
          r.characters.hit(e.hitAgent);
          r.fx.impact(hit, from.subtract(hit).normalize(), 'agent', w.agents[e.hitAgent].team, null);
        } else if (e.surface) {
          const n = new Vector3(e.nx, e.ny, e.nz);
          r.fx.impact(hit, n, 'world', 0, e.surface);
          if (e.surface !== 'glass') r.fx.decal(hit, n);
        }
        au?.gunshot(e.weapon, { x: e.ox, y: e.oy, z: e.oz }, w.bvh, local(e.agent));
        break;
      }
      case 'reload':
        if (local(e.agent)) au?.reload(e.weapon, WEAPONS[e.weapon].reloadTime, undefined, null);
        else {
          const a = w.agents[e.agent];
          au?.reload(e.weapon, WEAPONS[e.weapon].reloadTime, { x: a.x, y: a.y + 1.2, z: a.z }, w.bvh);
        }
        break;
      case 'equip':
        if (local(e.agent)) au?.equip();
        break;
      case 'dry':
        if (local(e.agent)) au?.dry();
        break;
      case 'footstep':
        au?.footstep(e.material, { x: e.x, y: e.y + 0.1, z: e.z }, w.bvh, e.loud, local(e.agent));
        break;
      case 'land': {
        const a = w.agents[e.agent];
        if (e.speed > 3) au?.land({ x: a.x, y: a.y, z: a.z }, w.bvh, local(e.agent));
        break;
      }
      case 'smokeThrow': {
        const a = w.agents[e.agent];
        au?.whoosh(local(e.agent) ? undefined : { x: a.x, y: a.y + 1.5, z: a.z }, w.bvh, false);
        break;
      }
      case 'smokeDeploy':
        au?.smokeDeploy({ x: e.x, y: e.y + 1, z: e.z }, w.bvh);
        break;
      case 'dash': {
        const a = w.agents[e.agent];
        au?.whoosh(local(e.agent) ? undefined : { x: a.x, y: a.y + 1, z: a.z }, w.bvh, true);
        break;
      }
      case 'break': {
        const c = w.map.colliders[e.collider];
        r.fx.debris(new Vector3(e.x, e.y, e.z), new Vector3(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ), e.material);
        au?.shatter(e.material, { x: e.x, y: e.y, z: e.z }, w.bvh);
        break;
      }
      case 'phase':
        if (e.phase === 'prep') r.fx.clearDecals();
        break;
      default:
        break;
    }
    this.onEvent?.(e, w);
  }
}
