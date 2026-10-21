import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { Scene } from '@babylonjs/core/scene';
import { PALETTE } from '../config/visuals';
import type { WeaponId } from '../config/weapons';
import type { Bvh } from '../sim/physics/bvh';
import { type V3, solveTwoBone } from './ik';

/** Interpolated pose of one agent for this render frame. */
export interface AgentPose {
  id: number;
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** radians */
  yaw: number;
  pitch: number;
  height: number;
  alive: boolean;
  grounded: boolean;
  weapon: WeaponId;
}

const THIGH = 0.47;
const SHIN = 0.47;
const UPPER_ARM = 0.3;
const FOREARM = 0.3;

interface Segment {
  mesh: Mesh;
}

class AgentVisual {
  readonly parts: Mesh[] = [];
  private readonly armor: StandardMaterial;
  private readonly visor: StandardMaterial;
  private readonly pelvis: Mesh;
  private readonly torso: Mesh;
  private readonly pack: Mesh;
  private readonly head: Mesh;
  private readonly visorMesh: Mesh;
  private readonly gun: Mesh;
  private readonly legs: { thigh: Segment; shin: Segment; foot: Mesh; phaseOffset: number; side: number }[];
  private readonly arms: { upper: Segment; fore: Segment; side: number }[];
  private readonly blob: Mesh;
  private phase = 0;
  private flash = 0;
  private deadT = 0;
  private wasAlive = true;
  /** world-space muzzle point, updated every frame */
  readonly muzzle = new Vector3();

  constructor(
    scene: Scene,
    readonly id: number,
    readonly team: 0 | 1,
    shared: { dark: StandardMaterial; skin: StandardMaterial; blob: StandardMaterial },
  ) {
    const teamHex = team === 0 ? PALETTE.teams.attackers : PALETTE.teams.defenders;
    const teamCol = Color3.FromHexString(teamHex);
    this.armor = new StandardMaterial(`armor-${id}`, scene);
    this.armor.diffuseColor = Color3.Lerp(teamCol, new Color3(0.85, 0.85, 0.88), 0.55);
    this.armor.specularColor = new Color3(0.25, 0.25, 0.25);
    this.armor.emissiveColor = teamCol.scale(0.12);
    this.visor = new StandardMaterial(`visor-${id}`, scene);
    this.visor.diffuseColor = Color3.Black();
    this.visor.emissiveColor = teamCol.scale(1.6);
    this.visor.disableLighting = true;

    const box = (name: string, w: number, h: number, d: number, mat: StandardMaterial): Mesh => {
      const m = CreateBox(`${name}-${id}`, { width: w, height: h, depth: d }, scene);
      m.material = mat;
      m.isPickable = false;
      m.receiveShadows = false;
      this.parts.push(m);
      return m;
    };
    const seg = (name: string, thick: number, mat: StandardMaterial): Segment => {
      // unit-length along Z so scaling.z = bone length
      const m = box(name, thick, thick, 1, mat);
      return { mesh: m };
    };
    this.pelvis = box('pelvis', 0.36, 0.2, 0.22, shared.dark);
    this.torso = box('torso', 0.46, 0.55, 0.28, this.armor);
    this.pack = box('pack', 0.3, 0.3, 0.1, shared.dark);
    this.head = CreateSphere(`head-${id}`, { diameterX: 0.25, diameterY: 0.29, diameterZ: 0.27, segments: 10 }, scene);
    this.head.material = this.armor;
    this.head.isPickable = false;
    this.parts.push(this.head);
    this.visorMesh = box('visor', 0.22, 0.07, 0.04, this.visor);
    this.gun = box('gun', 0.07, 0.11, 0.7, shared.dark);
    this.legs = [-1, 1].map((side, i) => ({
      thigh: seg('thigh', 0.15, shared.dark),
      shin: seg('shin', 0.13, this.armor),
      foot: box('foot', 0.13, 0.08, 0.26, shared.dark),
      phaseOffset: i * Math.PI,
      side,
    }));
    this.arms = [-1, 1].map((side) => ({ upper: seg('uarm', 0.11, this.armor), fore: seg('farm', 0.1, shared.skin), side }));
    this.blob = CreateDisc(`blob-${id}`, { radius: 0.45, tessellation: 16 }, scene);
    this.blob.material = shared.blob;
    this.blob.rotation.x = Math.PI / 2;
    this.blob.isPickable = false;
  }

  hit(): void {
    this.flash = 1;
  }

  setShadowCaster(sg: ShadowGenerator | null, on: boolean): void {
    if (!sg) return;
    for (const p of this.parts) {
      if (on) sg.addShadowCaster(p, false);
      else sg.removeShadowCaster(p, false);
    }
  }

  update(p: AgentPose, dt: number, visible: boolean, bvh: Bvh, blobShadow: boolean): void {
    if (p.alive) {
      this.deadT = 0;
      this.wasAlive = true;
    } else {
      if (this.wasAlive) this.deadT = 0;
      this.wasAlive = false;
      this.deadT = Math.min(3, this.deadT + dt);
    }
    const fade = p.alive ? 1 : Math.max(0, 1 - Math.max(0, this.deadT - 1.6) / 0.8);
    const show = visible && fade > 0.01;
    for (const m of this.parts) {
      m.isVisible = show;
      m.visibility = fade;
    }
    this.blob.isVisible = show && blobShadow;
    if (!show) return;

    this.flash = Math.max(0, this.flash - dt * 8);
    this.armor.emissiveColor.copyFrom(Color3.FromHexString(this.team === 0 ? PALETTE.teams.attackers : PALETTE.teams.defenders).scale(0.12 + this.flash * 1.5));

    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const rx = fz;
    const rz = -fx;
    const speed = Math.hypot(p.vx, p.vz);
    const death = p.alive ? 0 : Math.min(1, this.deadT / 0.45);

    // gait
    const stride = speed > 4 ? 1.5 : 1.0;
    this.phase += (speed * dt * Math.PI) / stride;
    const moveAmt = Math.min(1, speed / 2.5);
    const mdx = speed > 0.1 ? p.vx / speed : fx;
    const mdz = speed > 0.1 ? p.vz / speed : fz;

    const pelvisY = p.y + p.height * 0.53 - death * (p.height * 0.4) + (p.grounded ? Math.abs(Math.sin(this.phase)) * 0.035 * moveAmt : 0);
    const lean = death * 1.35; // fall backwards
    this.pelvis.position.set(p.x, pelvisY, p.z);
    this.pelvis.rotation.set(0, p.yaw, 0);

    // torso: from pelvis up, leaning with pitch a little and backwards on death
    const torsoLen = p.height * 0.31;
    const tilt = -p.pitch * 0.25 + lean + (p.alive ? speed * 0.012 : 0);
    const chest = new Vector3(p.x - fx * Math.sin(tilt) * torsoLen, pelvisY + Math.cos(tilt) * torsoLen, p.z - fz * Math.sin(tilt) * torsoLen);
    this.torso.position.set((p.x + chest.x) / 2, (pelvisY + chest.y) / 2 + 0.1, (p.z + chest.z) / 2);
    this.torso.rotation.set(-tilt, p.yaw, 0);
    this.pack.position.set(this.torso.position.x - fx * 0.18, this.torso.position.y + 0.04, this.torso.position.z - fz * 0.18);
    this.pack.rotation.copyFrom(this.torso.rotation);
    const headY = chest.y + 0.32;
    this.head.position.set(chest.x - fx * Math.sin(tilt) * 0.2, headY, chest.z - fz * Math.sin(tilt) * 0.2);
    this.head.rotation.set(-p.pitch * 0.6 - tilt, p.yaw, 0);
    this.visorMesh.position.set(this.head.position.x + fx * 0.115, this.head.position.y + 0.025, this.head.position.z + fz * 0.115);
    this.visorMesh.rotation.copyFrom(this.head.rotation);
    this.blob.position.set(p.x, groundAt(bvh, p.x, p.y + 0.5, p.z) + 0.02, p.z);

    // gun held in front of the chest along the aim direction
    const cp = Math.cos(p.pitch);
    const ax = fx * cp;
    const ay = Math.sin(p.pitch);
    const az = fz * cp;
    const shoulderY = chest.y + 0.08;
    const gunBase = new Vector3(chest.x + rx * 0.12 + fx * 0.1, shoulderY - 0.12, chest.z + rz * 0.12 + fz * 0.1);
    const gunLen = p.weapon === 'sniper' ? 1.0 : p.weapon === 'sidearm' ? 0.32 : 0.7;
    this.gun.scaling.z = gunLen / 0.7;
    const gunMid = gunBase.add(new Vector3(ax, ay, az).scale(gunLen * 0.45 * (1 - death)));
    this.gun.position.copyFrom(gunMid);
    this.gun.lookAt(gunMid.add(new Vector3(ax, ay - death, az)));
    this.muzzle.copyFrom(gunBase.add(new Vector3(ax, ay, az).scale(gunLen * 0.95)));

    // arms: right hand on the grip, left hand on the foregrip
    for (const arm of this.arms) {
      const sh = { x: chest.x + rx * 0.27 * arm.side, y: shoulderY, z: chest.z + rz * 0.27 * arm.side };
      const reach = arm.side > 0 ? 0.08 : gunLen * 0.55;
      const hand = { x: gunBase.x + ax * reach, y: gunBase.y + ay * reach - 0.03, z: gunBase.z + az * reach };
      const pole = { x: sh.x + rx * arm.side * 0.4 - fx * 0.2, y: sh.y - 0.6, z: sh.z + rz * arm.side * 0.4 - fz * 0.2 };
      const s = solveTwoBone(sh, hand, UPPER_ARM, FOREARM, pole);
      placeSegment(arm.upper.mesh, sh, s.knee);
      placeSegment(arm.fore.mesh, s.knee, s.foot);
    }

    // legs: planted feet with procedural stepping, ground found by raycast
    for (const leg of this.legs) {
      const hip = { x: p.x + rx * 0.11 * leg.side, y: pelvisY - 0.08, z: p.z + rz * 0.11 * leg.side };
      const ph = this.phase + leg.phaseOffset;
      const swing = Math.cos(ph) * 0.38 * moveAmt * (stride / 1.5);
      const lift = Math.max(0, Math.sin(ph)) * 0.2 * moveAmt * (p.grounded ? 1 : 0);
      const fxw = hip.x + mdx * swing;
      const fzw = hip.z + mdz * swing;
      let gy = groundAt(bvh, fxw, p.y + 0.5, fzw);
      if (!p.grounded) gy = p.y + 0.15; // tuck in the air
      const footTarget = { x: fxw, y: gy + 0.06 + lift, z: fzw };
      const pole = { x: hip.x + fx * 1.2, y: hip.y - 0.3, z: hip.z + fz * 1.2 };
      const s = solveTwoBone(hip, footTarget, THIGH, SHIN, pole);
      placeSegment(leg.thigh.mesh, hip, s.knee);
      placeSegment(leg.shin.mesh, s.knee, s.foot);
      leg.foot.position.set(s.foot.x + fx * 0.06, s.foot.y - 0.02, s.foot.z + fz * 0.06);
      leg.foot.rotation.set(0, p.yaw, 0);
    }
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.blob.dispose();
    this.armor.dispose();
    this.visor.dispose();
  }
}

function placeSegment(m: Mesh, a: V3, b: V3): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.scaling.z = len;
  m.lookAt(new Vector3(b.x, b.y, b.z));
}

function groundAt(bvh: Bvh, x: number, fromY: number, z: number): number {
  const hit = bvh.raycast(x, fromY, z, 0, -1, 0, 1.6);
  return hit ? fromY - hit.t : fromY - 1.6;
}

/** All agent visuals for a world. */
export class CharacterSet {
  private readonly visuals = new Map<number, AgentVisual>();
  private readonly shared: { dark: StandardMaterial; skin: StandardMaterial; blob: StandardMaterial };
  private castShadows = false;

  constructor(
    private readonly scene: Scene,
    roster: readonly { id: number; team: 0 | 1 }[],
  ) {
    const dark = new StandardMaterial('char-dark', scene);
    dark.diffuseColor = new Color3(0.13, 0.14, 0.17);
    dark.specularColor = new Color3(0.2, 0.2, 0.2);
    const skin = new StandardMaterial('char-glove', scene);
    skin.diffuseColor = new Color3(0.22, 0.2, 0.19);
    skin.specularColor = new Color3(0.05, 0.05, 0.05);
    const blob = new StandardMaterial('char-blob', scene);
    blob.diffuseColor = Color3.Black();
    blob.specularColor = Color3.Black();
    blob.alpha = 0.35;
    blob.disableLighting = true;
    this.shared = { dark, skin, blob };
    for (const a of roster) this.visuals.set(a.id, new AgentVisual(scene, a.id, a.team, this.shared));
  }

  setShadows(sg: ShadowGenerator | null, dynamic: boolean): void {
    if (this.castShadows === dynamic) return;
    for (const v of this.visuals.values()) v.setShadowCaster(sg, dynamic);
    this.castShadows = dynamic;
  }

  get dynamicShadows(): boolean {
    return this.castShadows;
  }

  hit(id: number): void {
    this.visuals.get(id)?.hit();
  }

  muzzle(id: number): Vector3 | null {
    return this.visuals.get(id)?.muzzle ?? null;
  }

  update(poses: readonly AgentPose[], dt: number, hideId: number, bvh: Bvh): void {
    for (const p of poses) this.visuals.get(p.id)?.update(p, dt, p.id !== hideId, bvh, !this.castShadows);
  }

  dispose(): void {
    for (const v of this.visuals.values()) v.dispose();
    this.shared.dark.dispose();
    this.shared.skin.dispose();
    this.shared.blob.dispose();
    void this.scene;
  }
}
