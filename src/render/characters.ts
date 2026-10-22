import "@babylonjs/core/Materials/fresnelParameters";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Color3 as C3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Scene } from "@babylonjs/core/scene";
import {
  CHARACTER_LOOK,
  type HelmetStyle,
  SKINS,
  type Skin,
} from "../config/skins";
import type { WeaponId } from "../config/weapons";
import type { Bvh } from "../sim/physics/bvh";
import { type V3, solveTwoBone } from "./ik";
import { type Piece, buildPart, c3, detailTexture } from "./kit";

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
/** torso mesh is authored for this length and scaled to the live torso length */
const TORSO_REF = 0.56;

interface Palette {
  suit: Color3;
  armor: Color3;
  gear: Color3;
  dark: Color3;
  glow: Color3;
}

function palette(skin: Skin, variant: number): Palette {
  // small per-agent variation so the three bots are distinguishable
  const v = (variant % 3) - 1;
  const k = CHARACTER_LOOK.shadeVariation * v;
  const shade = (c: Color3): Color3 => c.scale(1 + k);
  return {
    suit: c3(skin.suit),
    armor: shade(c3(skin.armor)),
    gear: shade(c3(skin.gear)),
    dark: c3(skin.dark),
    glow: c3(skin.glow),
  };
}

// ------------------------------------------------------------- geometry

function pelvisPieces(p: Palette): Piece[] {
  return [
    { shape: "box", size: [0.34, 0.2, 0.22], color: p.suit },
    {
      shape: "box",
      size: [0.37, 0.06, 0.25],
      pos: [0, 0.07, 0],
      color: p.dark,
    }, // belt
    {
      shape: "box",
      size: [0.09, 0.1, 0.08],
      pos: [0.14, 0.02, 0.12],
      color: p.gear,
    }, // pouches
    {
      shape: "box",
      size: [0.09, 0.1, 0.08],
      pos: [-0.14, 0.02, 0.12],
      color: p.gear,
    },
    {
      shape: "box",
      size: [0.08, 0.16, 0.12],
      pos: [0.2, -0.06, 0],
      color: p.gear,
    }, // holster
  ];
}

function torsoPieces(p: Palette): Piece[] {
  return [
    { shape: "box", size: [0.32, 0.22, 0.2], pos: [0, 0.11, 0], color: p.suit }, // abdomen
    { shape: "box", size: [0.44, 0.3, 0.25], pos: [0, 0.37, 0], color: p.suit }, // chest
    {
      shape: "box",
      size: [0.4, 0.27, 0.06],
      pos: [0, 0.37, 0.13],
      color: p.armor,
    }, // chest plate
    {
      shape: "box",
      size: [0.3, 0.12, 0.05],
      pos: [0, 0.18, 0.12],
      color: p.armor,
    }, // ab plate
    {
      shape: "box",
      size: [0.38, 0.26, 0.05],
      pos: [0, 0.37, -0.13],
      color: p.armor,
    }, // back plate
    {
      shape: "box",
      size: [0.08, 0.1, 0.06],
      pos: [0.12, 0.3, 0.17],
      color: p.gear,
    }, // mag pouches
    {
      shape: "box",
      size: [0.08, 0.1, 0.06],
      pos: [0, 0.3, 0.17],
      color: p.gear,
    },
    {
      shape: "box",
      size: [0.08, 0.1, 0.06],
      pos: [-0.12, 0.3, 0.17],
      color: p.gear,
    },
    {
      shape: "cyl",
      size: [0.16, 0.08, 0.2],
      pos: [0, 0.52, 0],
      rot: [Math.PI / 2, 0, 0],
      color: p.armor,
    }, // collar
    {
      shape: "box",
      size: [0.3, 0.32, 0.13],
      pos: [0, 0.35, -0.22],
      color: p.gear,
    }, // backpack
    {
      shape: "box",
      size: [0.32, 0.08, 0.15],
      pos: [0, 0.2, -0.22],
      color: p.dark,
    },
    {
      shape: "cyl",
      size: [0.015, 0.34, 0.02],
      pos: [0.11, 0.62, -0.25],
      rot: [-Math.PI / 2, 0, 0],
      color: p.dark,
    }, // antenna
  ];
}

function torsoGlow(p: Palette): Piece[] {
  return [
    {
      shape: "box",
      size: [0.2, 0.025, 0.012],
      pos: [0, 0.45, 0.165],
      color: p.glow,
    },
    {
      shape: "box",
      size: [0.025, 0.2, 0.012],
      pos: [0.1, 0.35, -0.29],
      color: p.glow,
    },
    {
      shape: "box",
      size: [0.025, 0.2, 0.012],
      pos: [-0.1, 0.35, -0.29],
      color: p.glow,
    },
  ];
}

function headPieces(p: Palette, style: HelmetStyle): Piece[] {
  const neck: Piece = {
    shape: "cyl",
    size: [0.11, 0.1, 0.12],
    pos: [0, 0.03, 0],
    rot: [Math.PI / 2, 0, 0],
    color: p.suit,
  };
  if (style === "hood") {
    return [
      neck,
      {
        shape: "sphere",
        size: [0.32, 0.33, 0.33],
        pos: [0, 0.16, -0.015],
        color: p.suit,
      }, // hood
      {
        shape: "sphere",
        size: [0.25, 0.27, 0.27],
        pos: [0, 0.15, 0.02],
        color: p.dark,
      }, // face
      {
        shape: "box",
        size: [0.2, 0.09, 0.08],
        pos: [0, 0.09, 0.12],
        color: p.gear,
      }, // mask
      {
        shape: "box",
        size: [0.34, 0.07, 0.3],
        pos: [0, 0.04, -0.02],
        color: p.gear,
      }, // scarf
    ];
  }
  const pieces: Piece[] = [
    neck,
    {
      shape: "sphere",
      size: [0.25, 0.26, 0.26],
      pos: [0, 0.14, 0],
      color: p.dark,
    }, // head
    {
      shape: "sphere",
      size: [0.29, 0.25, 0.3],
      pos: [0, 0.19, -0.01],
      color: p.armor,
    }, // helmet shell
    {
      shape: "box",
      size: [0.05, 0.1, 0.12],
      pos: [0.14, 0.13, 0],
      color: p.gear,
    }, // ear pieces
    {
      shape: "box",
      size: [0.05, 0.1, 0.12],
      pos: [-0.14, 0.13, 0],
      color: p.gear,
    },
  ];
  if (style === "crest") {
    pieces.push({
      shape: "box",
      size: [0.05, 0.06, 0.26],
      pos: [0, 0.32, -0.01],
      color: p.gear,
    });
    pieces.push({
      shape: "cyl",
      size: [0.012, 0.2, 0.016],
      pos: [-0.15, 0.27, -0.06],
      rot: [-Math.PI / 2.4, 0, 0],
      color: p.dark,
    });
  }
  return pieces;
}

function headGlow(p: Palette, style: HelmetStyle): Piece[] {
  if (style === "hood") {
    return [
      {
        shape: "box",
        size: [0.05, 0.018, 0.02],
        pos: [0.045, 0.17, 0.13],
        color: p.glow,
      },
      {
        shape: "box",
        size: [0.05, 0.018, 0.02],
        pos: [-0.045, 0.17, 0.13],
        color: p.glow,
      },
    ];
  }
  return [
    {
      shape: "box",
      size: [0.21, 0.055, 0.04],
      pos: [0, 0.15, 0.125],
      color: p.glow,
    },
  ];
}

/** Limbs are authored along +Z from the parent joint with their exact bone length. */
function thighPieces(p: Palette): Piece[] {
  return [
    {
      shape: "capsule",
      size: [0.085, THIGH + 0.1],
      pos: [0, 0, THIGH / 2],
      color: p.suit,
    },
    { shape: "cyl", size: [0.2, 0.16, 0.19], pos: [0, 0, 0.14], color: p.gear }, // thigh rig
    {
      shape: "sphere",
      size: [0.13, 0.13, 0.11],
      pos: [0, 0, THIGH],
      color: p.armor,
    }, // knee pad
  ];
}

function shinPieces(p: Palette): Piece[] {
  return [
    {
      shape: "capsule",
      size: [0.07, SHIN + 0.06],
      pos: [0, 0, SHIN / 2],
      color: p.suit,
    },
    {
      shape: "cyl",
      size: [0.16, 0.18, 0.15],
      pos: [0, 0, 0.15],
      color: p.armor,
    }, // shin guard
    {
      shape: "cyl",
      size: [0.15, 0.17, 0.17],
      pos: [0, 0, SHIN - 0.08],
      color: p.dark,
    }, // boot shaft
  ];
}

function footPieces(p: Palette): Piece[] {
  return [
    {
      shape: "box",
      size: [0.13, 0.09, 0.27],
      pos: [0, -0.01, 0.05],
      color: p.dark,
    },
    {
      shape: "box",
      size: [0.135, 0.03, 0.28],
      pos: [0, -0.05, 0.05],
      color: p.gear,
    }, // sole
  ];
}

function upperArmPieces(p: Palette): Piece[] {
  return [
    {
      shape: "capsule",
      size: [0.065, UPPER_ARM + 0.08],
      pos: [0, 0, UPPER_ARM / 2],
      color: p.suit,
    },
    {
      shape: "sphere",
      size: [0.2, 0.17, 0.2],
      pos: [0, 0, 0.03],
      color: p.armor,
    }, // shoulder pad
  ];
}

function forearmPieces(p: Palette): Piece[] {
  return [
    {
      shape: "capsule",
      size: [0.055, FOREARM + 0.05],
      pos: [0, 0, FOREARM / 2],
      color: p.suit,
    },
    {
      shape: "cyl",
      size: [0.13, 0.14, 0.12],
      pos: [0, 0, 0.15],
      color: p.armor,
    }, // bracer
    {
      shape: "sphere",
      size: [0.1, 0.09, 0.12],
      pos: [0, 0, FOREARM],
      color: p.dark,
    }, // glove
  ];
}

/** Third-person guns, origin at the grip, barrel along +Z. */
function gunPieces(p: Palette, w: WeaponId): Piece[] {
  const metal = c3("#22252b");
  const poly = c3("#3b3f47");
  if (w === "sidearm") {
    return [
      {
        shape: "box",
        size: [0.04, 0.05, 0.2],
        pos: [0, 0.03, 0.08],
        color: metal,
      },
      {
        shape: "box",
        size: [0.035, 0.11, 0.05],
        pos: [0, -0.03, 0],
        color: poly,
      },
    ];
  }
  if (w === "sniper") {
    return [
      {
        shape: "box",
        size: [0.06, 0.08, 0.5],
        pos: [0, 0, 0.12],
        color: metal,
      },
      {
        shape: "cyl",
        size: [0.03, 0.55, 0.03],
        pos: [0, 0.01, 0.62],
        color: metal,
      },
      {
        shape: "cyl",
        size: [0.06, 0.3, 0.06],
        pos: [0, 0.08, 0.12],
        color: metal,
      }, // scope
      {
        shape: "box",
        size: [0.05, 0.09, 0.26],
        pos: [0, -0.02, -0.25],
        color: p.gear,
      }, // stock
      {
        shape: "box",
        size: [0.04, 0.1, 0.05],
        pos: [0, -0.07, 0.02],
        color: poly,
      },
    ];
  }
  return [
    { shape: "box", size: [0.06, 0.09, 0.42], pos: [0, 0, 0.12], color: metal }, // receiver
    {
      shape: "cyl",
      size: [0.028, 0.28, 0.028],
      pos: [0, 0.01, 0.46],
      color: metal,
    },
    { shape: "box", size: [0.07, 0.07, 0.2], pos: [0, 0, 0.36], color: p.gear }, // handguard
    {
      shape: "box",
      size: [0.045, 0.14, 0.07],
      pos: [0, -0.1, 0.16],
      color: poly,
    }, // mag
    {
      shape: "box",
      size: [0.05, 0.08, 0.22],
      pos: [0, -0.01, -0.2],
      color: poly,
    }, // stock
    {
      shape: "box",
      size: [0.035, 0.035, 0.06],
      pos: [0, 0.07, 0.06],
      color: metal,
    }, // sight
  ];
}

function gunGlow(p: Palette, w: WeaponId): Piece[] {
  const len = w === "sniper" ? 0.4 : w === "sidearm" ? 0.12 : 0.3;
  return [
    {
      shape: "box",
      size: [0.062, 0.012, len],
      pos: [0, 0.045, 0.12],
      color: p.glow,
    },
  ];
}

// --------------------------------------------------------------- visual

/** Bone order of the skinned body (one bone per rigid part). */
const BONE = {
  pelvis: 0,
  torso: 1,
  head: 2,
  thigh: [3, 6],
  shin: [4, 7],
  foot: [5, 8],
  upperArm: [9, 11],
  forearm: [10, 12],
} as const;
const BONE_COUNT = 13;

const tmpPos = new Vector3();
const tmpDir = new Vector3();
const tmpX = new Vector3();
const tmpY = new Vector3();
const tmpScale = new Vector3(1, 1, 1);
const tmpQuat = new Quaternion();
const UP = Vector3.Up();
const FWD = Vector3.Forward();

/**
 * One combatant. The whole body is a single skinned mesh (plus one for its
 * light strips): every rigid part is skinned 100 % to its own bone and the
 * procedural animation/IK writes the bone transforms each frame. That keeps
 * a character at ~5 draw calls instead of ~20 (8 bots used to cost ~150).
 */
class AgentVisual {
  /** every mesh (for visibility, fading and shadow casting) */
  readonly parts: Mesh[] = [];
  private readonly body: StandardMaterial;
  private readonly baseEmissive: Color3;
  private readonly skeleton: Skeleton;
  private readonly bones: Bone[];
  private readonly guns: Map<WeaponId, Mesh>;
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
    rim: number,
    shared: { glow: Map<string, StandardMaterial>; blob: StandardMaterial },
  ) {
    const skin = team === 0 ? SKINS.attackers : SKINS.defenders;
    const pal = palette(skin, id);
    const style = skin.helmets[id % skin.helmets.length];

    this.body = new StandardMaterial(`body-${id}`, scene);
    this.body.diffuseTexture = detailTexture(scene);
    this.body.specularColor = new C3(0.22, 0.22, 0.24);
    this.body.specularPower = 40;
    // NB: scene.ambientColor breaks PBR map materials under WebGPU (Babylon 9.31),
    // so faces turned away from the sun are lifted with a small base emissive instead.
    this.baseEmissive = c3(skin.suit).scale(CHARACTER_LOOK.shadowLift);
    if (rim > 0) {
      const f = new FresnelParameters();
      f.leftColor = c3(skin.rim).scale(rim);
      f.rightColor = C3.Black();
      f.power = 2.6;
      f.bias = 0.05;
      this.body.emissiveFresnelParameters = f;
    }
    let glow = shared.glow.get(skin.glow);
    if (!glow) {
      glow = new StandardMaterial(`glow-${skin.glow}`, scene);
      glow.emissiveColor = c3(skin.glow).scale(CHARACTER_LOOK.glow);
      glow.diffuseColor = C3.Black();
      glow.disableLighting = true;
      shared.glow.set(skin.glow, glow);
    }

    this.skeleton = new Skeleton(`skel-${id}`, `skel-${id}`, scene);
    this.bones = Array.from({ length: BONE_COUNT }, (_, i) => new Bone(`b${i}`, this.skeleton, null, Matrix.Identity()));

    const skinned = (name: string, groups: { bone: number; pieces: Piece[] }[], material: StandardMaterial): Mesh => {
      let acc: VertexData | null = null;
      for (const g of groups) {
        const tmp = buildPart(scene, `${name}-tmp`, g.pieces, material);
        const vd = VertexData.ExtractFromMesh(tmp, true, true);
        tmp.dispose();
        const n = vd.positions!.length / 3;
        const idx = new Array<number>(n * 4).fill(0);
        const wts = new Array<number>(n * 4).fill(0);
        for (let i = 0; i < n; i++) {
          idx[i * 4] = g.bone;
          wts[i * 4] = 1;
        }
        vd.matricesIndices = idx;
        vd.matricesWeights = wts;
        if (acc) acc.merge(vd);
        else acc = vd;
      }
      const m = new Mesh(`${name}-${id}`, scene);
      acc!.applyToMesh(m, false);
      m.material = material;
      m.skeleton = this.skeleton;
      m.numBoneInfluencers = 1;
      m.isPickable = false;
      m.receiveShadows = false;
      // bounds of a skinned mesh don't follow the bones: always draw (there are few)
      m.alwaysSelectAsActiveMesh = true;
      m.doNotSyncBoundingInfo = true;
      this.parts.push(m);
      return m;
    };

    skinned(
      'body',
      [
        { bone: BONE.pelvis, pieces: pelvisPieces(pal) },
        { bone: BONE.torso, pieces: torsoPieces(pal) },
        { bone: BONE.head, pieces: headPieces(pal, style) },
        ...[0, 1].flatMap((i) => [
          { bone: BONE.thigh[i], pieces: thighPieces(pal) },
          { bone: BONE.shin[i], pieces: shinPieces(pal) },
          { bone: BONE.foot[i], pieces: footPieces(pal) },
          { bone: BONE.upperArm[i], pieces: upperArmPieces(pal) },
          { bone: BONE.forearm[i], pieces: forearmPieces(pal) },
        ]),
      ],
      this.body,
    );
    skinned(
      'trim',
      [
        { bone: BONE.torso, pieces: torsoGlow(pal) },
        { bone: BONE.head, pieces: headGlow(pal, style) },
      ],
      glow,
    );

    this.guns = new Map(
      (['rifle', 'sidearm', 'sniper'] as WeaponId[]).map((w) => {
        const g = buildPart(scene, `gun-${w}-${id}`, gunPieces(pal, w), this.body);
        const t = buildPart(scene, `gun-${w}-glow-${id}`, gunGlow(pal, w), glow!);
        t.parent = g;
        for (const m of [g, t]) {
          m.alwaysSelectAsActiveMesh = true;
          m.doNotSyncBoundingInfo = true;
          m.receiveShadows = false;
          this.parts.push(m);
        }
        return [w, g] as [WeaponId, Mesh];
      }),
    );

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

  /** Place a bone: translation + rotation (+ optional Y scale). */
  private pose(bone: number, x: number, y: number, z: number, q: Quaternion, scaleY = 1): void {
    const b = this.bones[bone];
    tmpScale.set(1, scaleY, 1);
    b.setScale(tmpScale);
    b.setRotationQuaternion(q);
    b.setPosition(tmpPos.set(x, y, z));
  }

  /** Place a limb bone at joint `a`, pointing its +Z axis at joint `c`. */
  private limb(bone: number, a: V3, c: V3): void {
    tmpDir.set(c.x - a.x, c.y - a.y, c.z - a.z);
    if (tmpDir.lengthSquared() < 1e-10) tmpDir.copyFrom(FWD);
    tmpDir.normalize();
    // avoid a degenerate basis when the limb points straight up/down
    const up = Math.abs(tmpDir.y) > 0.98 ? FWD : UP;
    // NB: FromLookDirectionLH assumes `up` ⟂ direction and twists limbs otherwise,
    // so build the orthonormal basis (+Z along the limb) explicitly.
    Vector3.CrossToRef(up, tmpDir, tmpX);
    tmpX.normalize();
    Vector3.CrossToRef(tmpDir, tmpX, tmpY);
    Quaternion.RotationQuaternionFromAxisToRef(tmpX, tmpY, tmpDir, tmpQuat);
    this.pose(bone, a.x, a.y, a.z, tmpQuat);
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
    for (const [w, g] of this.guns) {
      const on = show && w === p.weapon;
      g.isVisible = on;
      for (const c of g.getChildMeshes()) c.isVisible = on;
    }
    this.blob.isVisible = show && blobShadow;
    if (!show) return;

    this.flash = Math.max(0, this.flash - dt * 8);
    const b = this.baseEmissive;
    this.body.emissiveColor.set(b.r + this.flash * 0.9, b.g + this.flash * 0.9, b.b + this.flash * 0.9);

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
    this.pose(BONE.pelvis, p.x, pelvisY, p.z, Quaternion.RotationYawPitchRollToRef(p.yaw, 0, 0, tmpQuat));

    // torso pivots at the waist
    const torsoLen = p.height * 0.31;
    const tilt = -p.pitch * 0.25 + lean + (p.alive ? speed * 0.012 : 0);
    const waistY = pelvisY + 0.08;
    this.pose(BONE.torso, p.x, waistY, p.z, Quaternion.RotationYawPitchRollToRef(p.yaw, -tilt, 0, tmpQuat), torsoLen / TORSO_REF);
    const up = torsoLen * (0.54 / TORSO_REF);
    this.pose(
      BONE.head,
      p.x - fx * Math.sin(tilt) * up,
      waistY + Math.cos(tilt) * up,
      p.z - fz * Math.sin(tilt) * up,
      Quaternion.RotationYawPitchRollToRef(p.yaw, -p.pitch * 0.6 - tilt, 0, tmpQuat),
    );
    this.blob.position.set(p.x, groundAt(bvh, p.x, p.y + 0.5, p.z) + 0.02, p.z);

    // gun held in front of the chest along the aim direction
    const cp = Math.cos(p.pitch);
    const ax = fx * cp;
    const ay = Math.sin(p.pitch);
    const az = fz * cp;
    const shoulderY = waistY + Math.cos(tilt) * up * 0.86;
    const chestX = p.x - fx * Math.sin(tilt) * up * 0.86;
    const chestZ = p.z - fz * Math.sin(tilt) * up * 0.86;
    const gbx = chestX + rx * 0.12 + fx * 0.12;
    const gby = shoulderY - 0.14;
    const gbz = chestZ + rz * 0.12 + fz * 0.12;
    const gunLen = p.weapon === 'sniper' ? 1.0 : p.weapon === 'sidearm' ? 0.28 : 0.7;
    const gun = this.guns.get(p.weapon)!;
    gun.position.set(gbx, gby, gbz);
    gun.lookAt(segTarget.set(gbx + ax, gby + ay - death, gbz + az));
    this.muzzle.set(gbx + ax * gunLen * 0.95, gby + ay * gunLen * 0.95, gbz + az * gunLen * 0.95);

    // arms: right hand on the grip, left hand on the foregrip
    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      const sh = { x: chestX + rx * 0.26 * side, y: shoulderY, z: chestZ + rz * 0.26 * side };
      const reach = side > 0 ? 0.0 : gunLen * 0.5;
      const hand = { x: gbx + ax * reach, y: gby + ay * reach - 0.02, z: gbz + az * reach };
      const pole = { x: sh.x + rx * side * 0.4 - fx * 0.2, y: sh.y - 0.6, z: sh.z + rz * side * 0.4 - fz * 0.2 };
      const s = solveTwoBone(sh, hand, UPPER_ARM, FOREARM, pole);
      this.limb(BONE.upperArm[i], sh, s.knee);
      this.limb(BONE.forearm[i], s.knee, s.foot);
    }

    // legs: planted feet with procedural stepping, ground found by raycast
    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      const hip = { x: p.x + rx * 0.11 * side, y: pelvisY - 0.08, z: p.z + rz * 0.11 * side };
      const ph = this.phase + i * Math.PI;
      const swing = Math.cos(ph) * 0.38 * moveAmt * (stride / 1.5);
      const lift = Math.max(0, Math.sin(ph)) * 0.2 * moveAmt * (p.grounded ? 1 : 0);
      const fxw = hip.x + mdx * swing;
      const fzw = hip.z + mdz * swing;
      let gy = groundAt(bvh, fxw, p.y + 0.5, fzw);
      if (!p.grounded) gy = p.y + 0.15; // tuck in the air
      const footTarget = { x: fxw, y: gy + 0.08 + lift, z: fzw };
      const pole = { x: hip.x + fx * 1.2, y: hip.y - 0.3, z: hip.z + fz * 1.2 };
      const s = solveTwoBone(hip, footTarget, THIGH, SHIN, pole);
      this.limb(BONE.thigh[i], hip, s.knee);
      this.limb(BONE.shin[i], s.knee, s.foot);
      this.pose(BONE.foot[i], s.foot.x, s.foot.y, s.foot.z, Quaternion.RotationYawPitchRollToRef(p.yaw, 0, 0, tmpQuat));
    }
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.skeleton.dispose();
    this.blob.dispose();
    this.body.dispose();
  }
}

/** Limb meshes start at their parent joint and point along +Z. */
const segTarget = new Vector3();


function groundAt(bvh: Bvh, x: number, fromY: number, z: number): number {
  const hit = bvh.raycast(x, fromY, z, 0, -1, 0, 1.6);
  return hit ? fromY - hit.t : fromY - 1.6;
}

/** All agent visuals for a world. */
export class CharacterSet {
  private readonly visuals = new Map<number, AgentVisual>();
  private readonly shared: {
    glow: Map<string, StandardMaterial>;
    blob: StandardMaterial;
  };
  private castShadows = false;

  /**
   * @param viewerTeam team of the local player (enemies get a strong rim
   *   highlight); -1 for spectator views where both teams are highlighted.
   */
  constructor(
    scene: Scene,
    roster: readonly { id: number; team: 0 | 1 }[],
    viewerTeam: 0 | 1 | -1 = -1,
  ) {
    const blob = new StandardMaterial("char-blob", scene);
    blob.diffuseColor = C3.Black();
    blob.specularColor = C3.Black();
    blob.alpha = 0.35;
    blob.disableLighting = true;
    this.shared = { glow: new Map(), blob };
    for (const a of roster) {
      const rim =
        viewerTeam === -1
          ? (CHARACTER_LOOK.enemyRim + CHARACTER_LOOK.allyRim) / 2
          : a.team === viewerTeam
            ? CHARACTER_LOOK.allyRim
            : CHARACTER_LOOK.enemyRim;
      this.visuals.set(
        a.id,
        new AgentVisual(scene, a.id, a.team, rim, this.shared),
      );
    }
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

  update(
    poses: readonly AgentPose[],
    dt: number,
    hideId: number,
    bvh: Bvh,
  ): void {
    for (const p of poses)
      this.visuals
        .get(p.id)
        ?.update(p, dt, p.id !== hideId, bvh, !this.castShadows);
  }

  dispose(): void {
    for (const v of this.visuals.values()) v.dispose();
    for (const g of this.shared.glow.values()) g.dispose();
    this.shared.blob.dispose();
  }
}
