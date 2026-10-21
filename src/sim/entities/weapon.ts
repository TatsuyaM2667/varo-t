import { MOVEMENT } from '../../config/movement';
import { WEAPONS, WEAPON_BY_SLOT, type WeaponDef, type WeaponId } from '../../config/weapons';
import { PI, approach } from '../core/fmath';

const DT = 1 / MOVEMENT.tickRate;
const DEG = PI / 180;

export interface WeaponAmmo {
  mag: number;
  reserve: number;
}

/** Per-agent weapon state. Plain data, reset each round. */
export interface WeaponState {
  current: WeaponId;
  ammo: Record<WeaponId, WeaponAmmo>;
  /** seconds until the next shot is allowed (may go negative within a tick) */
  cooldown: number;
  /** seconds remaining in reload / equip */
  reload: number;
  equip: number;
  /** consecutive shots in the current spray */
  sprayIndex: number;
  /** seconds since last shot */
  sinceShot: number;
  /** bloom in degrees on top of the base spread */
  bloom: number;
  /** accumulated recoil offset in radians (added to aim) */
  recoilPitch: number;
  recoilYaw: number;
  /** 0..1 ADS blend */
  ads: number;
  /** semi-auto: trigger must be released between shots */
  triggerHeld: boolean;
}

export function createWeaponState(): WeaponState {
  const ammo = {} as Record<WeaponId, WeaponAmmo>;
  for (const id of Object.keys(WEAPONS) as WeaponId[]) ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserve };
  return {
    current: 'rifle',
    ammo,
    cooldown: 0,
    reload: 0,
    equip: 0,
    sprayIndex: 0,
    sinceShot: 10,
    bloom: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    ads: 0,
    triggerHeld: false,
  };
}

export function resetWeaponState(w: WeaponState): void {
  const fresh = createWeaponState();
  Object.assign(w, fresh);
}

export function def(w: WeaponState): WeaponDef {
  return WEAPONS[w.current];
}

export function switchWeapon(w: WeaponState, slot: 1 | 2 | 3): boolean {
  const id = WEAPON_BY_SLOT[slot];
  if (id === w.current) return false;
  w.current = id;
  w.equip = WEAPONS[id].equipTime;
  w.reload = 0;
  w.sprayIndex = 0;
  w.bloom = 0;
  w.ads = 0;
  w.cooldown = Math.max(w.cooldown, 0);
  return true;
}

export function startReload(w: WeaponState): boolean {
  const d = def(w);
  const a = w.ammo[w.current];
  if (w.reload > 0 || a.mag >= d.magSize || a.reserve <= 0) return false;
  w.reload = d.reloadTime;
  w.ads = 0;
  return true;
}

export interface FireContext {
  /** horizontal speed m/s */
  speed: number;
  grounded: boolean;
  crouched: boolean;
  walking: boolean;
}

/** Current spread cone radius in degrees given movement state. */
export function currentSpreadDeg(w: WeaponState, ctx: FireContext): number {
  const d = def(w);
  const s = d.spread;
  let spread = s.base + w.bloom;
  const moveFrac = Math.min(1, ctx.speed / MOVEMENT.runSpeed);
  if (!ctx.grounded) spread += s.air;
  else if (ctx.speed > 0.3) spread += ctx.walking ? s.walking * moveFrac * 2 : s.moving * moveFrac;
  if (ctx.crouched) spread *= s.crouchMul;
  // ADS blends toward the ads multiplier; snipers pay a penalty when unscoped
  spread *= 1 + (s.adsMul - 1) * w.ads;
  if (d.ads.scoped) spread += d.ads.unscopedPenalty * (1 - w.ads);
  return Math.min(spread, s.max + s.base + s.air);
}

export interface TickResult {
  fired: boolean;
  reloaded: boolean;
  /** dry fire (empty mag) */
  empty: boolean;
}

/**
 * Advance weapon timers for one tick and decide whether a shot happens.
 * The caller performs the actual hitscan when `fired` is true (after
 * `applyShotRecoil`).
 */
export function tickWeapon(w: WeaponState, fireHeld: boolean, firePressed: boolean, adsHeld: boolean, canFire: boolean): TickResult {
  const d = def(w);
  const res: TickResult = { fired: false, reloaded: false, empty: false };
  w.sinceShot += DT;
  if (w.cooldown > 0) w.cooldown -= DT;
  if (w.equip > 0) w.equip = Math.max(0, w.equip - DT);

  if (w.reload > 0) {
    w.reload -= DT;
    if (w.reload <= 0) {
      w.reload = 0;
      const a = w.ammo[w.current];
      const need = d.magSize - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take;
      a.reserve -= take;
      res.reloaded = true;
    }
  }

  // ADS (not while reloading / equipping)
  const adsTarget = adsHeld && w.reload === 0 && w.equip === 0 ? 1 : 0;
  w.ads = approach(w.ads, adsTarget, DT / Math.max(0.01, d.ads.time));

  // Bloom and recoil recovery
  if (w.sinceShot > d.recoil.recoveryDelay) {
    w.bloom = approach(w.bloom, 0, d.spread.recovery * DT);
    const rec = d.recoil.recovery * DEG * DT;
    w.recoilPitch = approach(w.recoilPitch, 0, rec);
    w.recoilYaw = approach(w.recoilYaw, 0, rec * 0.6);
    if (w.recoilPitch === 0 && w.bloom === 0) w.sprayIndex = 0;
  }
  if (!fireHeld) w.triggerHeld = false;

  const wantsFire = d.automatic ? fireHeld : firePressed || (fireHeld && !w.triggerHeld);
  if (!wantsFire || !canFire || w.equip > 0 || w.reload > 0 || w.cooldown > 0) return res;

  const a = w.ammo[w.current];
  if (a.mag <= 0) {
    if (firePressed) res.empty = true;
    if (!startReload(w)) w.triggerHeld = true;
    return res;
  }
  a.mag--;
  // keep the long-run fire rate exact even though shots land on tick boundaries
  w.cooldown = Math.max(w.cooldown, -DT) + d.fireInterval;
  w.triggerHeld = true;
  w.sinceShot = 0;
  res.fired = true;
  if (a.mag === 0 && a.reserve > 0) {
    // auto-reload after the last bullet leaves (after the shot is processed)
    w.reload = d.reloadTime + d.fireInterval * 0.5;
    w.ads = 0;
  }
  return res;
}

/**
 * Recoil kick for the shot that was just fired. Returns the aim offset
 * (radians) to use for *this* shot, then accumulates the kick for the next.
 */
export function applyShotRecoil(w: WeaponState): { pitch: number; yaw: number } {
  const d = def(w);
  const used = { pitch: w.recoilPitch, yaw: w.recoilYaw };
  const pat = d.recoil.pattern;
  let i = w.sprayIndex;
  if (i >= pat.length) i = d.recoil.loopFrom + ((i - pat.length) % Math.max(1, pat.length - d.recoil.loopFrom));
  const [kp, ky] = pat[i];
  w.recoilPitch += kp * DEG;
  w.recoilYaw += ky * DEG;
  w.sprayIndex++;
  w.bloom = Math.min(d.spread.max, w.bloom + d.spread.perShot);
  return used;
}

export function damageAt(d: WeaponDef, zone: 'head' | 'body' | 'legs', distance: number): number {
  let dmg = d.damage[zone];
  for (const f of d.falloff) if (distance > f.from) dmg *= f.mul;
  return Math.round(dmg);
}
