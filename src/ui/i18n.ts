import type { Lang } from '../app/settings';

const DICT = {
  play: { ja: 'プレイ', en: 'PLAY' },
  howto: { ja: '操作説明', en: 'CONTROLS' },
  settings: { ja: '設定', en: 'SETTINGS' },
  ranking: { ja: 'ランキング', en: 'RANKING' },
  clickToStart: { ja: 'クリックして開始', en: 'CLICK TO START' },
  clickToResume: { ja: 'クリックして再開', en: 'CLICK TO RESUME' },
  backToTitle: { ja: 'タイトルへ', en: 'TITLE' },
  playAgain: { ja: 'もう一度', en: 'PLAY AGAIN' },
  paused: { ja: '一時停止', en: 'PAUSED' },
  victory: { ja: '勝利', en: 'VICTORY' },
  defeat: { ja: '敗北', en: 'DEFEAT' },
  roundWon: { ja: 'ラウンド獲得', en: 'ROUND WON' },
  roundLost: { ja: 'ラウンド喪失', en: 'ROUND LOST' },
  round: { ja: 'ラウンド', en: 'ROUND' },
  prep: { ja: '準備フェーズ', en: 'BUY PHASE' },
  capture: { ja: '中継塔を制圧中', en: 'CAPTURING RELAY' },
  objective: { ja: '敵を全滅させるか、Aサイトの中継塔を5秒間制圧せよ', en: 'Eliminate the defenders or hold the Relay on A for 5 s' },
  elimination: { ja: '全滅', en: 'ELIMINATION' },
  captureReason: { ja: '制圧', en: 'CAPTURE' },
  timeReason: { ja: '時間切れ', en: 'TIME' },
  killcam: { ja: 'キルカム', en: 'KILLCAM' },
  killedBy: { ja: 'に倒された', en: 'killed you' },
  attractBanner: { ja: 'クリックしてプレイ', en: 'CLICK TO PLAY' },
  demo: { ja: 'デモプレイ中', en: 'DEMO' },
  score: { ja: 'スコア', en: 'SCORE' },
  newRecord: { ja: 'ハイスコア更新!', en: 'NEW HIGH SCORE!' },
  enterName: { ja: 'イニシャルを入力 (3文字) → Enter', en: 'Enter initials (3) → Enter' },
  replay: { ja: 'リプレイ', en: 'REPLAY' },
  replayHelp: { ja: 'Space 一時停止 / ← → 5秒移動 / 1-3 速度 / Esc 終了', en: 'Space pause / ← → 5 s / 1-3 speed / Esc exit' },
  sensitivity: { ja: 'マウス感度', en: 'Sensitivity' },
  volume: { ja: '音量', en: 'Volume' },
  quality: { ja: '画質', en: 'Quality' },
  difficulty: { ja: '難易度', en: 'Difficulty' },
  language: { ja: '言語', en: 'Language' },
  close: { ja: '閉じる', en: 'CLOSE' },
  auto: { ja: '自動', en: 'Auto' },
  easy: { ja: 'かんたん', en: 'Easy' },
  normal: { ja: 'ふつう', en: 'Normal' },
  hard: { ja: 'むずかしい', en: 'Hard' },
  errorRecover: { ja: 'エラーが発生しました。タイトルに戻ります…', en: 'Something went wrong. Returning to title…' },
  idleReturn: { ja: '操作がないためタイトルに戻ります', en: 'Returning to title (idle)' },
  kills: { ja: 'キル', en: 'Kills' },
  deaths: { ja: 'デス', en: 'Deaths' },
  headshots: { ja: 'ヘッドショット', en: 'Headshots' },
  accuracy: { ja: '命中率', en: 'Accuracy' },
  damage: { ja: 'ダメージ', en: 'Damage' },
  noScores: { ja: 'まだ記録がありません', en: 'No scores yet' },
  blockedPrep: { ja: '準備フェーズ中は撃てません', en: "Can't fire during the buy phase" },
  blockedReload: { ja: 'リロード中…', en: 'Reloading…' },
  blockedEquip: { ja: '武器を構えています…', en: 'Equipping…' },
  emptyMag: { ja: '弾切れ — R でリロード', en: 'Empty — press R' },
  keyBindings: { ja: 'キー設定', en: 'Key bindings' },
  keyBindHelp: { ja: '枠をクリック → 割り当てたいキー（またはマウスボタン）を押す。Del で削除、Esc で取消。1つのキーは1つの操作にだけ割り当てられます。', en: 'Click a slot, then press a key or mouse button. Del clears, Esc cancels. Each key drives one action.' },
  pressKey: { ja: 'キーを押す…', en: 'Press a key…' },
  resetKeys: { ja: 'キーを初期設定に戻す', en: 'Reset keys' },
  keyReserved: { ja: 'は割り当てられません（予約キー）', en: 'cannot be bound (reserved)' },
  unbound: { ja: '未割り当て', en: 'Unbound' },
  touchpadHint: { ja: 'タッチパッドはキー入力中に無効になる場合があります。マウスの使用を推奨します', en: 'Touchpads may be disabled while typing — use a mouse' },
} as const;

export type I18nKey = keyof typeof DICT;

let lang: Lang = 'ja';

export function setLang(l: Lang): void {
  lang = l;
}

export function t(key: I18nKey): string {
  return DICT[key][lang];
}
