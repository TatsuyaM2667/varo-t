/** Round / match rules. ★ ラウンド時間や先取数はここ。 */
export const RULES = {
  roundsToWin: 3,
  /** freeze phase at round start: can look and switch, cannot move or fire */
  prepTime: 4,
  roundTime: 100,
  /** seconds an attacker must hold the site uncontested */
  captureTime: 5,
  /** capture progress decay per second while no attacker is on site */
  captureDecay: 0.5,
  /** round-end phase; long enough for the 5 s killcam */
  roundEndTime: 6.5,
  maxHp: 100,

  /** default roster for exhibition play: one human attacker vs three bot defenders */
  playerTeamSize: 1,
  enemyTeamSize: 3,
  /** bonus HP for the human in 1v3, to keep it fun for visitors (0 = off) */
  playerHpBonus: 0,

  score: {
    kill: 100,
    headshotKill: 50,
    damagePoint: 1,
    roundWin: 300,
    matchWin: 1000,
    /** bonus per second left on the clock when the attackers win */
    timeBonusPerSecond: 5,
  },
} as const;
