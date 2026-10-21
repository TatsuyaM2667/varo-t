import { describe, expect, it } from 'vitest';
import { RULES } from '../../src/config/rules';
import { World } from '../../src/sim/world';
import { forceLive } from './helpers';

function world() {
  const w = new World({ seed: 3, roster: [{ team: 0, isBot: false, name: 'a' }, { team: 1, isBot: false, name: 'd' }] });
  w.startMatch();
  forceLive(w);
  return w;
}

describe('round rules', () => {
  it('elimination ends the round for the other team', () => {
    const w = world();
    w.agents[1].alive = false;
    w.step([undefined, undefined]);
    expect(w.round.phase).toBe('end');
    expect(w.match.score).toEqual([1, 0]);
  });

  it('capturing the site wins for attackers', () => {
    const w = world();
    const a = w.agents[0];
    const s = w.map.siteZone;
    a.x = (s.minX + s.maxX) / 2 + 3; a.z = s.minZ + 1; a.y = 0;
    for (let i = 0; i < RULES.captureTime * 60 + 2; i++) w.step([undefined, undefined]);
    expect(w.round.reason).toBe('capture');
    expect(w.match.score[0]).toBe(1);
  });

  it('contested capture does not progress', () => {
    const w = world();
    const s = w.map.siteZone;
    for (const a of w.agents) { a.x = s.minX + 1 + a.id * 2; a.z = s.minZ + 1; a.y = 0; }
    for (let i = 0; i < 120; i++) w.step([undefined, undefined]);
    expect(w.round.captureProgress).toBe(0);
  });

  it('time out goes to defenders', () => {
    const w = world();
    for (let i = 0; i < RULES.roundTime * 60 + 2; i++) w.step([undefined, undefined]);
    expect(w.round.reason).toBe('time');
    expect(w.match.score[1]).toBe(1);
  });

  it('match ends after roundsToWin, next rounds start automatically', () => {
    const w = world();
    for (let r = 0; r < RULES.roundsToWin; r++) {
      forceLive(w);
      w.agents[1].alive = false;
      for (let i = 0; i < (RULES.roundEndTime + 1) * 60; i++) w.step([undefined, undefined]);
    }
    expect(w.match.over).toBe(true);
    expect(w.match.winner).toBe(0);
    expect(w.round.phase).toBe('matchOver');
  });
});
