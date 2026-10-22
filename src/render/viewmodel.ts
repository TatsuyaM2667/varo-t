import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import { VIEWMODEL } from '../config/feel';
import { SKINS } from '../config/skins';
import { FX_STYLE, PALETTE } from '../config/visuals';
import { WEAPONS, type WeaponId } from '../config/weapons';

/** Critically-damped-ish spring for one scalar. */
class Spring {
  v = 0;
  x = 0;
  step(dt: number, k: number, c: number): void {
    const a = -k * this.x - c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
}

export interface ViewmodelState {
  weapon: WeaponId;
  /** 0..1 */
  ads: number;
  /** seconds remaining / total */
  reload: number;
  reloadTotal: number;
  equip: number;
  equipTotal: number;
  /** horizontal speed and grounded for bob */
  speed: number;
  grounded: boolean;
  /** look angular velocity (rad/s) for sway */
  lookVelYaw: number;
  lookVelPitch: number;
  visible: boolean;
  procedural: boolean;
}

/**
 * First-person weapon built from primitives, parented to the camera and drawn
 * in rendering group 1 (depth cleared) so it never clips into walls.
 */
export class Viewmodel {
  private readonly root: TransformNode;
  private readonly guns = new Map<WeaponId, TransformNode>();
  private readonly muzzles = new Map<WeaponId, Vector3>();
  private readonly flash: Mesh;
  private readonly flashLight: PointLight;
  private flashT = 0;
  private readonly kickBack = new Spring();
  private readonly kickPitch = new Spring();
  private readonly kickRoll = new Spring();
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private time = 0;

  constructor(
    scene: Scene,
    camera: Camera,
    team: 0 | 1,
  ) {
    this.root = new TransformNode('vm-root', scene);
    this.root.parent = camera;
    this.root.scaling.setAll(VIEWMODEL.scale);
    const metal = new StandardMaterial('vm-metal', scene);
    metal.diffuseColor = new Color3(0.16, 0.17, 0.2);
    metal.specularColor = new Color3(0.5, 0.5, 0.55);
    metal.specularPower = 64;
    const polymer = new StandardMaterial('vm-polymer', scene);
    polymer.diffuseColor = new Color3(0.27, 0.28, 0.3);
    polymer.specularColor = new Color3(0.12, 0.12, 0.12);
    const accent = new StandardMaterial('vm-accent', scene);
    accent.diffuseColor = Color3.FromHexString(team === 0 ? PALETTE.teams.attackers : PALETTE.teams.defenders);
    accent.diffuseColor = accent.diffuseColor.scale(0.55);
    accent.emissiveColor = accent.diffuseColor.scale(0.12);
    const skin = team === 0 ? SKINS.attackers : SKINS.defenders;
    const glove = new StandardMaterial('vm-glove', scene);
    glove.diffuseColor = Color3.FromHexString(skin.dark);
    glove.specularColor = new Color3(0.08, 0.08, 0.08);
    const sleeve = new StandardMaterial('vm-sleeve', scene);
    sleeve.diffuseColor = Color3.FromHexString(skin.suit);
    sleeve.specularColor = new Color3(0.05, 0.05, 0.05);
    const bracer = new StandardMaterial('vm-bracer', scene);
    bracer.diffuseColor = Color3.FromHexString(skin.armor);
    bracer.specularColor = new Color3(0.3, 0.3, 0.3);
    const trim = new StandardMaterial('vm-trim', scene);
    trim.emissiveColor = Color3.FromHexString(skin.glow);
    trim.diffuseColor = Color3.Black();
    trim.disableLighting = true;
    const lens = new StandardMaterial('vm-lens', scene);
    lens.diffuseColor = new Color3(0.1, 0.3, 0.4);
    lens.emissiveColor = new Color3(0.15, 0.6, 0.8);

    const parts: Mesh[] = [];
    const box = (parent: TransformNode, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial): Mesh => {
      const m = CreateBox('vm', { width: w, height: h, depth: d }, scene);
      m.parent = parent;
      m.position.set(x, y, z);
      m.material = mat;
      parts.push(m);
      return m;
    };
    const cyl = (parent: TransformNode, dia: number, len: number, x: number, y: number, z: number, mat: StandardMaterial): Mesh => {
      const m = CreateCylinder('vm', { diameter: dia, height: len, tessellation: 12 }, scene);
      m.parent = parent;
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      m.material = mat;
      parts.push(m);
      return m;
    };
    const hands = (g: TransformNode, foreZ: number): void => {
      box(g, 0.07, 0.11, 0.1, 0, -0.07, -0.02, glove); // right hand on grip
      box(g, 0.075, 0.075, 0.32, 0.03, -0.11, -0.2, sleeve); // right forearm
      box(g, 0.085, 0.085, 0.12, 0.03, -0.11, -0.12, bracer);
      box(g, 0.087, 0.012, 0.03, 0.03, -0.066, -0.12, trim);
      box(g, 0.08, 0.06, 0.1, -0.02, -0.045, foreZ, glove); // left hand
      box(g, 0.075, 0.075, 0.32, -0.09, -0.08, foreZ - 0.19, sleeve); // left forearm
      box(g, 0.085, 0.085, 0.12, -0.09, -0.08, foreZ - 0.11, bracer);
      box(g, 0.087, 0.012, 0.03, -0.09, -0.036, foreZ - 0.11, trim);
    };

    // Kestrel (rifle)
    const rifle = new TransformNode('vm-rifle', scene);
    rifle.parent = this.root;
    box(rifle, 0.06, 0.08, 0.42, 0, 0, 0.1, metal); // receiver
    box(rifle, 0.065, 0.03, 0.3, 0, 0.055, 0.08, accent); // top rail accent
    cyl(rifle, 0.028, 0.3, 0, 0.005, 0.46, metal); // barrel
    box(rifle, 0.07, 0.07, 0.22, 0, -0.005, 0.38, polymer); // handguard
    box(rifle, 0.045, 0.14, 0.07, 0, -0.1, 0.16, polymer); // magazine
    box(rifle, 0.05, 0.1, 0.05, 0, -0.08, -0.02, polymer); // grip
    box(rifle, 0.05, 0.08, 0.22, 0, -0.01, -0.2, polymer); // stock
    box(rifle, 0.035, 0.035, 0.06, 0, 0.09, 0.05, metal); // sight
    hands(rifle, 0.36);
    this.guns.set('rifle', rifle);
    this.muzzles.set('rifle', new Vector3(0, 0.005, 0.62));

    // Wren (sidearm)
    const pistol = new TransformNode('vm-pistol', scene);
    pistol.parent = this.root;
    box(pistol, 0.045, 0.05, 0.2, 0, 0.02, 0.08, metal); // slide
    box(pistol, 0.046, 0.015, 0.12, 0, 0.05, 0.06, accent);
    box(pistol, 0.04, 0.12, 0.06, 0, -0.06, 0.0, polymer); // grip
    hands(pistol, 0.02);
    this.guns.set('sidearm', pistol);
    this.muzzles.set('sidearm', new Vector3(0, 0.02, 0.19));

    // Heron (sniper)
    const sniper = new TransformNode('vm-sniper', scene);
    sniper.parent = this.root;
    box(sniper, 0.06, 0.08, 0.5, 0, 0, 0.1, metal);
    cyl(sniper, 0.03, 0.55, 0, 0.005, 0.6, metal);
    box(sniper, 0.072, 0.075, 0.28, 0, -0.005, 0.42, polymer);
    cyl(sniper, 0.06, 0.3, 0, 0.085, 0.1, metal); // scope
    cyl(sniper, 0.05, 0.005, 0, 0.085, -0.052, lens);
    box(sniper, 0.05, 0.1, 0.05, 0, -0.08, -0.04, polymer);
    box(sniper, 0.05, 0.09, 0.26, 0, -0.02, -0.26, accent);
    box(sniper, 0.045, 0.1, 0.06, 0, -0.1, 0.18, polymer);
    hands(sniper, 0.38);
    this.guns.set('sniper', sniper);
    this.muzzles.set('sniper', new Vector3(0, 0.005, 0.88));

    for (const m of parts) {
      m.renderingGroupId = 1;
      m.isPickable = false;
      m.receiveShadows = false;
      m.alwaysSelectAsActiveMesh = true;
    }

    const flashMat = new StandardMaterial('vm-flash', scene);
    flashMat.emissiveColor = Color3.FromHexString(FX_STYLE.muzzle).scale(1.4);
    flashMat.diffuseColor = Color3.Black();
    flashMat.disableLighting = true;
    flashMat.opacityTexture = flashTexture(scene);
    flashMat.backFaceCulling = false;
    this.flash = CreatePlane('vm-flash', { size: 0.22 }, scene);
    this.flash.material = flashMat;
    this.flash.renderingGroupId = 1;
    this.flash.parent = this.root;
    this.flash.isPickable = false;
    this.flash.isVisible = false;
    this.flashLight = new PointLight('muzzle-light', Vector3.Zero(), scene);
    this.flashLight.diffuse = Color3.FromHexString(FX_STYLE.muzzle);
    this.flashLight.range = 9;
    this.flashLight.intensity = 0;
    this.flashLight.parent = this.root;
  }

  /** Called when the local player fires. */
  shoot(weapon: WeaponId): void {
    const [back, climb] = VIEWMODEL.kick[weapon] ?? [1, 8];
    this.kickBack.v -= back;
    this.kickPitch.v -= climb;
    this.kickRoll.v += (Math.random() - 0.5) * climb * 0.4;
    this.flashT = 0.05;
    const m = this.muzzles.get(weapon)!;
    this.flash.position.copyFrom(m);
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  /** World-space muzzle position for tracers. */
  muzzleWorld(weapon: WeaponId): Vector3 {
    const g = this.guns.get(weapon)!;
    g.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(this.muzzles.get(weapon)!, g.getWorldMatrix());
  }

  update(s: ViewmodelState, dt: number): void {
    this.time += dt;
    for (const [id, g] of this.guns) g.setEnabled(s.visible && id === s.weapon && !(WEAPONS[id].ads.scoped && s.ads > 0.6));
    this.flash.isVisible = s.visible && this.flashT > 0 && !(WEAPONS[s.weapon].ads.scoped && s.ads > 0.6);
    this.flashLight.intensity = this.flashT > 0 ? 2.2 : 0;
    this.flashT -= dt;
    if (!s.visible) return;

    const { stiffness: k, damping: c } = VIEWMODEL.spring;
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    for (let i = 0; i < sub; i++) {
      this.kickBack.step(dt / sub, k, c);
      this.kickPitch.step(dt / sub, k * 0.8, c);
      this.kickRoll.step(dt / sub, k * 0.6, c * 0.8);
    }

    const proc = s.procedural ? 1 : 0.25;
    // sway: lag behind mouse motion
    const tx = Math.max(-VIEWMODEL.swayMax, Math.min(VIEWMODEL.swayMax, -s.lookVelYaw * VIEWMODEL.sway));
    const ty = Math.max(-VIEWMODEL.swayMax, Math.min(VIEWMODEL.swayMax, s.lookVelPitch * VIEWMODEL.sway));
    const sl = 1 - Math.exp(-dt * 10);
    this.swayX += (tx * proc - this.swayX) * sl;
    this.swayY += (ty * proc - this.swayY) * sl;

    // bob
    const moving = s.grounded ? Math.min(1, s.speed / 6) : 0;
    this.bobPhase += dt * (4 + s.speed * 1.3) * VIEWMODEL.bob.frequency;
    const adsDamp = 1 - s.ads * 0.85;
    const bobX = Math.sin(this.bobPhase) * VIEWMODEL.bob.amplitude * moving * adsDamp * proc;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * VIEWMODEL.bob.amplitude * moving * adsDamp * proc;
    const idle = Math.sin(this.time * 1.3) * 0.002 * adsDamp;

    // reload / equip dips
    const rl = s.reloadTotal > 0 && s.reload > 0 ? Math.sin((1 - s.reload / s.reloadTotal) * Math.PI) : 0;
    const eq = s.equipTotal > 0 && s.equip > 0 ? s.equip / s.equipTotal : 0;

    const hip = VIEWMODEL.hipOffset;
    const ads = VIEWMODEL.adsOffset;
    const a = s.ads * s.ads * (3 - 2 * s.ads);
    this.root.position.set(
      hip[0] + (ads[0] - hip[0]) * a + bobX + this.swayX * 0.6,
      hip[1] + (ads[1] - hip[1]) * a + bobY + idle - rl * 0.12 - eq * 0.3 + this.swayY * 0.5,
      hip[2] + (ads[2] - hip[2]) * a + this.kickBack.x * 0.05,
    );
    this.root.rotation.set(this.kickPitch.x * 0.012 + rl * 0.6 + eq * 0.8 + this.swayY, this.swayX, this.kickRoll.x * 0.01 + rl * 0.5 + this.swayX * 0.5);
  }

  dispose(): void {
    this.root.dispose(false, true);
    this.flash.dispose();
    this.flashLight.dispose();
  }
}

/** Star-burst muzzle flash sprite (alpha only). */
function flashTexture(scene: Scene): DynamicTexture {
  const n = 128;
  const t = new DynamicTexture('flash-tex', { width: n, height: n }, scene, false);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, n, n);
  const c = n / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.45);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const len = c * (i % 2 ? 0.95 : 0.65);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a + 0.18) * 6, c + Math.sin(a + 0.18) * 6);
    ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
    ctx.lineTo(c + Math.cos(a - 0.18) * 6, c + Math.sin(a - 0.18) * 6);
    ctx.fill();
  }
  t.update();
  t.hasAlpha = true;
  return t;
}
