/**
 * Bot difficulty. ★ ボットの強さはここ（反応時間・照準誤差・連携度が主な3軸）。
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** ms between first seeing an enemy and starting to aim/shoot */
  reactionMs: number;
  /** standard deviation of aim error in degrees right after acquiring a target */
  aimErrorDeg: number;
  /** aim error shrinks toward this while tracking */
  settledErrorDeg: number;
  /** seconds to settle */
  settleTime: number;
  /** max view turn speed, degrees per second */
  turnSpeedDeg: number;
  /** 0..1, chance to aim at the head instead of the chest */
  headshotBias: number;
  /** 0..1, fraction of own recoil compensated */
  sprayControl: number;
  /** 0..1, crossfires, trading, rotations, utility usage */
  coordination: number;
  /** stops before shooting (counter-strafe) with this probability */
  stopToShoot: number;
  fovDeg: number;
  sightRange: number;
  hearingRange: number;
}

export const BOT_PROFILES: Record<Difficulty, BotProfile> = {
  easy: {
    reactionMs: 520,
    aimErrorDeg: 5,
    settledErrorDeg: 1.6,
    settleTime: 1.2,
    turnSpeedDeg: 200,
    headshotBias: 0.12,
    sprayControl: 0.25,
    coordination: 0.25,
    stopToShoot: 0.3,
    fovDeg: 100,
    sightRange: 60,
    hearingRange: 26,
  },
  normal: {
    reactionMs: 340,
    aimErrorDeg: 3.2,
    settledErrorDeg: 0.9,
    settleTime: 0.8,
    turnSpeedDeg: 320,
    headshotBias: 0.3,
    sprayControl: 0.55,
    coordination: 0.6,
    stopToShoot: 0.65,
    fovDeg: 110,
    sightRange: 80,
    hearingRange: 34,
  },
  hard: {
    reactionMs: 230,
    aimErrorDeg: 2,
    settledErrorDeg: 0.45,
    settleTime: 0.5,
    turnSpeedDeg: 480,
    headshotBias: 0.5,
    sprayControl: 0.85,
    coordination: 0.9,
    stopToShoot: 0.9,
    fovDeg: 120,
    sightRange: 100,
    hearingRange: 40,
  },
};

/** Exhibition default. */
export const DEFAULT_DIFFICULTY: Difficulty = 'easy';

export const BOT_NAMES = ['Vesper', 'Quill', 'Marrow', 'Sable', 'Juniper', 'Rook'];
