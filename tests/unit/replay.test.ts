import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { Btn, type InputFrame } from '../../src/sim/input-frame';
import { InputLog, RoundReplay } from '../../src/sim/replay/input-log';
import { World, type WorldOptions } from '../../src/sim/world';

const OPTS: WorldOptions = {
  seed: 77,
  roster: [
    { team: 0, isBot: false, name: 'you' },
    { team: 1, isBot: true, name: 'b0', difficulty: 'normal' },
    { team: 1, isBot: true, name: 'b1', difficulty: 'normal' },
    { team: 1, isBot: true, name: 'b2', difficulty: 'normal' },
  ],
  features: { utilityAi: true, destructibles: true },
};

/** Plays a match with a scripted pseudo-human, recording inputs and per-round hashes. */
function playRecorded(ticks: number) {
  const w = new World(OPTS);
  w.startMatch();
  const log = new InputLog(OPTS, [0]);
  const r = new Rng(4);
  let yaw = 0;
  let held = Btn.Forward;
  const hashes = new Map<string, number>();
  for (let t = 0; t < ticks && !w.match.over; t++) {
    if (r.int(30) === 0) held = (r.nextU32() & (Btn.Forward | Btn.Left | Btn.Right | Btn.Fire | Btn.Walk)) | Btn.Forward;
    if (r.int(200) === 0) held |= Btn.Ability1;
    yaw = (yaw + r.int(300) - 150) & 0xffff;
    const f: InputFrame = { buttons: held, yaw, pitch: r.int(1000) - 500 };
    log.record(w.round.index, [f]);
    const round = w.round.index;
    w.step([f]);
    if (w.round.index === round) hashes.set(`${round}:${w.round.tick}`, w.hash());
    held &= ~Btn.Ability1;
  }
  return { w, log, hashes };
}

describe('replay', () => {
  it('re-simulates every recorded round bit-exactly', () => {
    const { log, hashes } = playRecorded(60 * 60 * 5);
    const rounds = log.roundsRecorded();
    expect(rounds.length).toBeGreaterThan(1);
    for (const round of rounds) {
      const rep = new RoundReplay(log, round);
      let checked = 0;
      while (rep.step()) {
        const h = hashes.get(`${round}:${rep.tick}`);
        if (h !== undefined) {
          expect(rep.world.hash() >>> 0, `round ${round} tick ${rep.tick}`).toBe(h);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(100);
    }
  }, 60_000);

  it('seek lands on the requested tick', () => {
    const { log } = playRecorded(60 * 30);
    const rep = new RoundReplay(log, 0);
    rep.seek(600);
    expect(rep.tick).toBe(600);
  });

  it('packs and unpacks frames losslessly', () => {
    const log = new InputLog(OPTS, [0]);
    const f = { buttons: 0x7fff, yaw: 65535, pitch: -16000 };
    log.record(0, [f]);
    expect(log.frameAt(0, 0, [])[0]).toEqual(f);
  });
});
