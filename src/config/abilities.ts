/**
 * Abilities. ★ スモークとダッシュの数値はここ。
 * Dash distance/duration live in config/movement.ts (it is a movement primitive).
 */
export const ABILITIES = {
  smoke: {
    charges: 2,
    throwSpeed: 17,
    /** extra upward velocity on throw (m/s) */
    throwLift: 3,
    gravity: 16,
    bounce: 0.35,
    /** seconds before it deploys even if still rolling */
    fuse: 1.6,
    radius: 4.4,
    /** seconds to reach full size */
    expandTime: 0.7,
    duration: 15,
    /** number of puffs forming the density field */
    puffs: 7,
    /** line-of-sight integral (metres of full-density smoke) that blocks vision */
    blockThreshold: 1.1,
    cooldown: 1.0,
  },
  dash: {
    charges: 1,
    /** seconds to regain a charge */
    rechargeTime: 10,
  },
} as const;
