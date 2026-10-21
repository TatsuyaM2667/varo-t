/**
 * Headless self-play: runs thousands of deterministic rounds in worker
 * threads and reports weapon TTK, map side balance and per-difficulty win
 * rates, then auto-tunes bot difficulty toward target win rates.
 *
 *   npm run selfplay                 # measure + suggest, write docs/balance.md
 *   npm run selfplay -- --apply      # also write src/config/tuning.generated.ts
 *   npm run selfplay -- --quick      # fewer rounds (smoke test)
 */
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { BASE_BOT_PROFILES, type BotProfile, type Difficulty, applyTuning } from '../src/config/bots';
import { WEAPONS, type WeaponId } from '../src/config/weapons';
import { atan2, radToUnits } from '../src/sim/core/fmath';
import { eyeHeight } from '../src/sim/entities/agent';
import { Btn, type InputFrame } from '../src/sim/input-frame';
import { zoneAt } from '../src/sim/map/map-def';
import { type AgentSpec, World } from '../src/sim/world';

// ---------------------------------------------------------------- jobs

type Job =
  | { kind: 'duel'; weapon: WeaponId; distance: number; seeds: number[]; control: boolean }
  | { kind: 'rounds'; roster: AgentSpec[]; seeds: number[] };

interface DuelResult {
  ttk: number[]; // seconds, Infinity = no kill within 5 s
  shots: number[];
}

interface RoundsResult {
  rounds: number;
  wins: [number, number];
  reasons: Record<string, number>;
  durations: number[];
  killsByZone: Record<string, number>;
  killsByWeapon: Record<string, number>;
  headshotKills: number;
  kills: number;
}

function runDuel(job: Extract<Job, { kind: 'duel' }>): DuelResult {
  const out: DuelResult = { ttk: [], shots: [] };
  for (const seed of job.seeds) {
    const w = new World({ seed, roster: [{ team: 0, isBot: false, name: 's' }, { team: 1, isBot: false, name: 't' }] });
    w.startMatch();
    w.round.phase = 'live';
    const [s, t] = w.agents;
    // clear lane along the east side of Long (no cover on x = -23)
    s.x = -23;
    s.z = -40;
    t.x = -23;
    t.z = -40 + job.distance;
    const slot = WEAPONS[job.weapon].slot;
    const switchBtn = slot === 1 ? Btn.Weapon1 : slot === 2 ? Btn.Weapon2 : Btn.Weapon3;
    let tick = 0;
    let shots = 0;
    let killed = -1;
    let firstShot = -1;
    const d = WEAPONS[job.weapon];
    for (; tick < 60 * 7 && killed < 0; tick++) {
      const ey = s.y + eyeHeight(s);
      const ty = t.y + t.height * 0.62; // chest
      const dx = t.x - s.x;
      const dz = t.z - s.z;
      let yaw = atan2(dx, dz);
      let pitch = atan2(ty - ey, Math.sqrt(dx * dx + dz * dz));
      if (job.control) {
        pitch -= s.weapon.recoilPitch;
        yaw -= s.weapon.recoilYaw;
      }
      // equip first, then fire (semi-autos alternate press/release)
      const equipping = tick < 2 || s.weapon.equip > 0;
      let buttons = tick === 0 ? switchBtn : 0;
      if (!equipping) {
        if (d.ads.scoped) buttons |= Btn.Ads;
        const scopedReady = !d.ads.scoped || s.weapon.ads > 0.95;
        if (scopedReady) buttons |= d.automatic ? Btn.Fire : tick % 2 === 0 ? Btn.Fire : 0;
      }
      const f: InputFrame = { buttons, yaw: radToUnits(yaw) & 0xffff, pitch: radToUnits(pitch) };
      w.step([f, undefined]);
      const fired = w.events.filter((e) => e.type === 'shot').length;
      if (fired > 0 && firstShot < 0) firstShot = tick;
      shots += fired;
      if (!t.alive) killed = tick;
    }
    // TTK measured from the first shot (a one-shot kill is 0 s)
    out.ttk.push(killed < 0 ? Infinity : (killed - firstShot) / 60);
    out.shots.push(shots);
  }
  return out;
}

function runRounds(job: Extract<Job, { kind: 'rounds' }>): RoundsResult {
  const r: RoundsResult = { rounds: 0, wins: [0, 0], reasons: {}, durations: [], killsByZone: {}, killsByWeapon: {}, headshotKills: 0, kills: 0 };
  for (const seed of job.seeds) {
    const w = new World({ seed, roster: job.roster, features: { utilityAi: true, destructibles: true } });
    w.startMatch();
    let guard = 0;
    while (w.round.phase !== 'end' && guard++ < 60 * 130) {
      w.step([]);
      for (const e of w.events) {
        if (e.type === 'kill') {
          const v = w.agents[e.victim];
          const z = zoneAt(w.map, v.x, v.z) || 'Other';
          r.killsByZone[z] = (r.killsByZone[z] ?? 0) + 1;
          r.killsByWeapon[e.weapon] = (r.killsByWeapon[e.weapon] ?? 0) + 1;
          r.kills++;
          if (e.headshot) r.headshotKills++;
        }
      }
    }
    if (w.round.winner >= 0) {
      r.rounds++;
      r.wins[w.round.winner as 0 | 1]++;
      r.reasons[w.round.reason!] = (r.reasons[w.round.reason!] ?? 0) + 1;
      r.durations.push(w.round.endTick / 60);
    }
  }
  return r;
}

if (!isMainThread) {
  const job = workerData as Job;
  parentPort!.postMessage(job.kind === 'duel' ? runDuel(job) : runRounds(job));
}

// ----------------------------------------------------------------- pool

async function runPool<T>(jobs: Job[]): Promise<T[]> {
  const n = Math.max(1, Math.min(cpus().length - 1, 12));
  const results: T[] = new Array(jobs.length);
  let next = 0;
  async function lane(): Promise<void> {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await new Promise<T>((resolve, reject) => {
        const wk = new Worker(new URL(import.meta.url), { workerData: jobs[i], execArgv: ['--import', 'tsx'] });
        wk.once('message', (m) => {
          resolve(m as T);
          void wk.terminate();
        });
        wk.once('error', reject);
      });
    }
  }
  await Promise.all(Array.from({ length: n }, lane));
  return results;
}

function seeds(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (start + i * 7919) >>> 0);
}

function chunked(start: number, total: number, per: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < total; i += per) out.push(seeds(start + i * 104729, Math.min(per, total - i)));
  return out;
}

function mergeRounds(rs: RoundsResult[]): RoundsResult {
  const m: RoundsResult = { rounds: 0, wins: [0, 0], reasons: {}, durations: [], killsByZone: {}, killsByWeapon: {}, headshotKills: 0, kills: 0 };
  for (const r of rs) {
    m.rounds += r.rounds;
    m.wins[0] += r.wins[0];
    m.wins[1] += r.wins[1];
    m.durations.push(...r.durations);
    m.headshotKills += r.headshotKills;
    m.kills += r.kills;
    for (const [k, v] of Object.entries(r.reasons)) m.reasons[k] = (m.reasons[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.killsByZone)) m.killsByZone[k] = (m.killsByZone[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.killsByWeapon)) m.killsByWeapon[k] = (m.killsByWeapon[k] ?? 0) + v;
  }
  return m;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** A stand-in for a typical festival visitor: slower and less accurate than a normal bot, plays solo. */
const VISITOR: BotProfile = {
  ...BASE_BOT_PROFILES.normal,
  reactionMs: 430,
  aimErrorDeg: 4,
  settledErrorDeg: 1.3,
  coordination: 0.1,
  sprayControl: 0.35,
  stopToShoot: 0.4,
};

/** Target probability that the visitor wins a round against three bots. */
const TARGETS: Record<Difficulty, number> = { easy: 0.5, normal: 0.3, hard: 0.15 };

function exhibitRoster(diff: Difficulty, mul: number): AgentSpec[] {
  const prof = applyTuning(BASE_BOT_PROFILES[diff], { reactionMul: mul, aimErrorMul: mul });
  return [
    { team: 0, isBot: true, name: 'visitor', difficulty: 'normal', profile: VISITOR },
    ...[0, 1, 2].map((i): AgentSpec => ({ team: 1, isBot: true, name: `bot${i}`, difficulty: diff, profile: prof })),
  ];
}

async function visitorWinRate(diff: Difficulty, mul: number, rounds: number, seedBase: number): Promise<{ rate: number; res: RoundsResult }> {
  const res = mergeRounds(await runPool<RoundsResult>(chunked(seedBase, rounds, 25).map((s) => ({ kind: 'rounds', roster: exhibitRoster(diff, mul), seeds: s }))));
  return { rate: res.wins[0] / Math.max(1, res.rounds), res };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const quick = args.has('--quick');
  const apply = args.has('--apply');
  const t0 = Date.now();
  const lines: string[] = [];
  const log = (s = ''): void => {
    console.log(s);
    lines.push(s);
  };

  log('# Balance report (headless self-play)');
  log();
  log(`Generated by \`tools/selfplay.ts\` on ${new Date().toISOString()}. All numbers come from the deterministic simulation (same code as the game).`);
  log();

  // 1) weapon TTK
  log('## 1. Weapon time-to-kill (stationary target, chest aim)');
  log();
  log('| weapon | distance | median TTK (no recoil control) | kill rate ≤5s | median TTK (perfect control) |');
  log('|---|---|---|---|---|');
  const duelSeeds = quick ? 20 : 120;
  for (const weapon of ['sidearm', 'rifle', 'sniper'] as WeaponId[]) {
    for (const distance of [5, 15, 30, 50]) {
      const [raw, ctl] = await runPool<DuelResult>([
        { kind: 'duel', weapon, distance, seeds: seeds(1, duelSeeds), control: false },
        { kind: 'duel', weapon, distance, seeds: seeds(1, duelSeeds), control: true },
      ]);
      const killed = raw.ttk.filter((x) => Number.isFinite(x));
      log(`| ${weapon} | ${distance} m | ${fmt(median(raw.ttk))} | ${((killed.length / raw.ttk.length) * 100).toFixed(0)}% | ${fmt(median(ctl.ttk))} |`);
    }
  }
  log();

  // 2) map side balance with equal bots
  const sideRounds = quick ? 60 : 600;
  log(`## 2. Map side balance (3v3, normal vs normal, ${sideRounds} rounds)`);
  log();
  const side = mergeRounds(
    await runPool<RoundsResult>(
      chunked(1000, sideRounds, 25).map((s) => ({
        kind: 'rounds',
        roster: [0, 1].flatMap((team) => [0, 1, 2].map((i): AgentSpec => ({ team: team as 0 | 1, isBot: true, name: `t${team}${i}`, difficulty: 'normal' }))),
        seeds: s,
      })),
    ),
  );
  log(`- Attacker round win rate: **${pct(side.wins[0] / side.rounds)}** (${side.wins[0]}/${side.rounds})`);
  log(`- Win reasons: ${Object.entries(side.reasons).map(([k, v]) => `${k} ${pct(v / side.rounds)}`).join(', ')}`);
  log(`- Median round length: ${median(side.durations).toFixed(1)} s`);
  log(`- Headshot share of kills: ${pct(side.headshotKills / Math.max(1, side.kills))}`);
  log(`- Kills by weapon: ${Object.entries(side.killsByWeapon).map(([k, v]) => `${k} ${pct(v / side.kills)}`).join(', ')}`);
  log();
  log('| zone | share of kills |');
  log('|---|---|');
  for (const [z, v] of Object.entries(side.killsByZone).sort((a, b) => b[1] - a[1])) log(`| ${z} | ${pct(v / side.kills)} |`);
  log();
  const sideNote =
    Math.abs(side.wins[0] / side.rounds - 0.5) < 0.08
      ? 'Within ±8% of 50% — the layout is balanced for equal teams.'
      : side.wins[0] / side.rounds > 0.5
        ? 'Attackers are favoured; consider more defender cover near the chokes or a shorter capture window.'
        : 'Defenders are favoured; consider a longer round or more attacker cover on the approaches.';
  log(`> ${sideNote}`);
  log();

  // 3) exhibition difficulty: visitor proxy vs 3 bots, auto-tuned
  const perEval = quick ? 50 : 200;
  log(`## 3. Exhibition difficulty (visitor proxy vs 3 bots)`);
  log();
  log('The "visitor" is a bot profile modelling a first-time player (reaction 430 ms, aim error 4°, solo).');
  log('Each difficulty is tuned by bisection on a multiplier applied to reaction time and aim error, toward a target round-win rate for the visitor.');
  log();
  log('| difficulty | target | before (×1.00) | tuned multiplier | after |');
  log('|---|---|---|---|---|');
  const tuning: Record<Difficulty, { reactionMul: number; aimErrorMul: number }> = {
    easy: { reactionMul: 1, aimErrorMul: 1 },
    normal: { reactionMul: 1, aimErrorMul: 1 },
    hard: { reactionMul: 1, aimErrorMul: 1 },
  };
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const target = TARGETS[diff];
    const before = await visitorWinRate(diff, 1, perEval, 5000);
    // larger multiplier = slower, sloppier bots = higher visitor win rate
    let lo = 0.5;
    let hi = 2.5;
    let best = { mul: 1, rate: before.rate };
    for (let it = 0; it < (quick ? 3 : 6); it++) {
      const mid = Math.sqrt(lo * hi);
      const { rate } = await visitorWinRate(diff, mid, perEval, 6000 + it * 1000);
      if (Math.abs(rate - target) < Math.abs(best.rate - target)) best = { mul: mid, rate };
      if (rate < target) lo = mid;
      else hi = mid;
    }
    const verify = await visitorWinRate(diff, best.mul, perEval * 2, 9000);
    tuning[diff] = { reactionMul: +best.mul.toFixed(3), aimErrorMul: +best.mul.toFixed(3) };
    log(`| ${diff} | ${pct(target)} | ${pct(before.rate)} | ×${best.mul.toFixed(2)} | ${pct(verify.rate)} |`);
  }
  log();
  log('Caveat: the visitor proxy is a model. Watch real visitors on the day and adjust `src/config/bots.ts` or `tuning.generated.ts` by hand.');
  log();
  log(`_Runtime: ${((Date.now() - t0) / 1000).toFixed(0)} s on ${cpus().length} threads._`);

  writeFileSync('docs/balance.md', `${lines.join('\n')}\n`);
  if (apply) {
    writeFileSync(
      'src/config/tuning.generated.ts',
      `// Generated by tools/selfplay.ts on ${new Date().toISOString()} — multipliers on BASE_BOT_PROFILES.
// Safe to edit by hand; set both to 1 to return to the hand-authored profiles.
export const BOT_TUNING: Record<'easy' | 'normal' | 'hard', { reactionMul: number; aimErrorMul: number }> = ${JSON.stringify(tuning, null, 2).replace(/"(\w+)":/g, '$1:')};
`,
    );
    console.log('wrote src/config/tuning.generated.ts');
  }
}

function fmt(s: number): string {
  return Number.isFinite(s) ? `${s.toFixed(2)} s` : '—';
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}


