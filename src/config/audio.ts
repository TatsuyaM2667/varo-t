/** Sound mix. ★ 音量バランスはここ。 */
export const AUDIO = {
  master: 0.8,
  sfx: 1.0,
  ui: 0.6,
  /** metres per second; distant gunshots arrive late */
  speedOfSound: 343,
  /** rolloff for the HRTF panners */
  refDistance: 3,
  maxDistance: 120,
  rolloff: 1.1,
  occludedLowpass: 900,
  occludedGain: 0.55,
  reverb: {
    /** how often the listener's acoustic environment is re-measured (s) */
    probeInterval: 0.5,
    minRt60: 0.3,
    maxRt60: 2.4,
    wetMin: 0.08,
    wetMax: 0.38,
  },
  weapon: {
    rifle: { gain: 0.9, body: 140, crack: 2400, tail: 0.35 },
    sidearm: { gain: 0.75, body: 180, crack: 3200, tail: 0.25 },
    sniper: { gain: 1.0, body: 70, crack: 1800, tail: 0.9 },
  } as Record<string, { gain: number; body: number; crack: number; tail: number }>,
};
