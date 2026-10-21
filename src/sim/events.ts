import type { WeaponId } from '../config/weapons';
import type { MaterialTag } from './physics/aabb';

export type HitZone = 'head' | 'body' | 'legs';
export type RoundPhase = 'prep' | 'live' | 'end' | 'matchOver';
export type RoundEndReason = 'elimination' | 'capture' | 'time';

/** Everything that happened in a tick, for rendering, audio, UI and bots. */
export type SimEvent =
  | {
      type: 'shot';
      agent: number;
      weapon: WeaponId;
      ox: number;
      oy: number;
      oz: number;
      hx: number;
      hy: number;
      hz: number;
      /** surface normal axis of the world hit (for sparks / decals) */
      nx: number;
      ny: number;
      nz: number;
      hitAgent: number;
      zone: HitZone | null;
      surface: MaterialTag | null;
    }
  | { type: 'damage'; attacker: number; victim: number; amount: number; zone: HitZone; killed: boolean }
  | { type: 'kill'; killer: number; victim: number; weapon: WeaponId; headshot: boolean }
  | { type: 'reload'; agent: number; weapon: WeaponId }
  | { type: 'equip'; agent: number; weapon: WeaponId }
  | { type: 'dry'; agent: number }
  | { type: 'footstep'; agent: number; material: MaterialTag; x: number; y: number; z: number; loud: boolean }
  | { type: 'jump'; agent: number }
  | { type: 'land'; agent: number; speed: number }
  | { type: 'smokeThrow'; agent: number; projectile: number }
  | { type: 'smokeDeploy'; smoke: number; x: number; y: number; z: number }
  | { type: 'dash'; agent: number }
  | { type: 'break'; collider: number; material: MaterialTag; x: number; y: number; z: number }
  | { type: 'phase'; phase: RoundPhase; round: number }
  | { type: 'roundEnd'; winner: 0 | 1; reason: RoundEndReason; round: number }
  | { type: 'captureStart' };

export interface NoiseSource {
  x: number;
  y: number;
  z: number;
  radius: number;
  agent: number;
  kind: 'footstep' | 'gunshot' | 'ability';
}
