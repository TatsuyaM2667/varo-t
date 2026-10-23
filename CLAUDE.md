# HALCYON LINE — 学園祭展示用 戦術FPSデモ

承認済み計画: `/home/tatsuya/.claude/plans/quiet-seeking-koala.md`（以下の内容が優先）

## 技術スタック
- TypeScript 7 + Vite 8 + Babylon.js 9（WebGPU 優先、WebGL2 フォールバック）
- 見た目用物理: Havok（`@babylonjs/havok`）。ゲームプレイの衝突は `src/sim/physics/` の自前決定的コライダー
- ナビゲーション: `src/sim/bots/nav.ts` の決定的グリッド A*（Recast から変更。理由は docs/architecture.md）
- テスト: Vitest（ロジック）、Playwright（E2E・描画・性能）
- 配信: Cloudflare Pages（静的）。1ファイル 25 MiB / 20,000 ファイル以下（`npm run check:pages` で検証）

## コマンド
| 用途 | コマンド |
|---|---|
| 開発サーバ | `npm run dev`（http://localhost:5173） |
| 型チェック | `npm run typecheck` |
| ユニットテスト | `npm run test` |
| E2E | `npm run e2e` |
| ビルド | `npm run build`（型チェック→Vite→Pages制限チェック） |
| オフライン配布ZIP | `npm run pack:offline` |
| 自己対戦バランス | `npm run selfplay`（`-- --apply` で難易度を自動調整） |
| 射線チェック | `npm run validate:map` |
| 性能計測 | `npm run perf`（実機GPUは `-- --headed`） |
| デプロイ | `npm run deploy`（wrangler） |
| 中継サーバ | `npm run relay:deploy` / ローカル `npm run relay:dev` |

## アーキテクチャ規約
- `src/sim/` は **Babylon.js・DOM・`window` に依存しない純TS**。import してよいのは `src/sim/` と `src/config/` のみ。
  `tests/unit/boundaries.test.ts` が強制する。
- sim は固定 60Hz の決定的シミュレーション。
  - 乱数は `sim/core/rng.ts` の種付き PRNG のみ。`Math.random` 禁止。
  - 三角関数等は `sim/core/fmath.ts` を使う。`Math.sin/cos/atan2/...` を sim 内で直接呼ばない。
  - 視点角は整数（1回転 = 65536）で入力に載せる。
  - 反復順序は配列順（`Map`/`Set` の挿入順も可）。オブジェクトキー列挙順に依存しない。
- 描画（`render/`）・音（`audio/`）・UI（`ui/`）は sim の状態とイベントを読むだけ。sim への入力は `InputFrame` のみ。
- 描画は前ティックと現ティックの補間で表示する。

## 数値の置き場所
- **撃ち心地・移動・難易度・品質の数値はすべて `src/config/` に置く。ユーザーが自分で調整する。**
  ロジック側にマジックナンバーを書かない。判断できない値（撃ち心地・見た目の好み）は確定せず、
  config に出して「ここを触って」と報告する。

## スコープと進め方
- Tier 0 → Tier 1 → Tier 2 の順。**Tier を飛ばさない。**
- フェーズ P1〜P7（計画参照）。各フェーズ末に「動作確認手順」と「確認すべき点」を出して止まる。
- **大きな機能（Tier 1/2）は `src/config/features.ts` のフラグで隔離**し、OFF で Tier 0 と同一動作。OFF 時は動的 import しない。
- 1機能1コミット、英語のコミットメッセージ。`npm run test` が通ってから完了報告。
- 外部アセットは CC0 のみ。使ったら `CREDITS.md` に出典とライセンスを記録。手続き的生成を優先。
- Valorant の名称・キャラ・ロゴ・アセットは使わない。名前は `src/config/brand.ts`。
- 新しいライブラリは採用理由・バンドルサイズ・代替案を示してから入れる。

## 実装状況（2026-10-22）
- Tier 0 / Tier 1 / Tier 2 すべて実装済み。各機能は `src/config/features.ts` のフラグで隔離。
- ボット難易度は `src/config/tuning.generated.ts`（自己対戦の出力）で BASE_BOT_PROFILES に倍率をかけている。
- 既知の制約: SSAO は WebGL2 のみ（WebGPU では Babylon 9.31 の SSAO2 が描画時に例外）。
- WebGPU 注意: `scene.ambientColor` を設定すると PBR のマップが真っ黒になる。ParticleSystem.dispose() は共有テクスチャを壊すので dispose(false)。
- テスト用フック: `window.__game`（app / gfx / input）。E2E はこれで試合開始・入力有効化を行う。
- ステージ（2026-10-22 追加）: `sim/map/stages.ts`（ASCII）→ `sim/map/spec.ts` が当たり判定・戦術データ・見た目データを生成。
  レジストリ `sim/map/registry.ts`（STAGES: マップ・難易度・敵の数）。`World` は `mapId` で切替（既定 'yard'）。
  見た目は `render/architecture.ts`（テーマ別の装飾）と `config/themes.ts`。
- ボットのスタック検出: `npx tsx tools/stuck-probe.ts <mapId> <rounds> <defenders>`（目安: 動きたい時間の 2% 未満）。
- キャラクターは1体1スキンメッシュ（`render/characters.ts`、ボーン=部位）。描画呼び出しを増やす変更は性能に注意（Medium 60fps 目標）。
- マルチプレイ（2026-10-23 追加）: 遅延ロックステップ。入力は WebRTC P2P（`src/net/peers.ts`、公開 STUN のみ・TURN なし）、
  直接つながらない組だけ中継。`src/net/`（protocol / lockstep / room / relay-client / peers）＋ `server/relay.ts`（Worker + Durable Objects、
  Pages とは別に `npm run relay:deploy`）。管理ページ `/admin`（`server/admin-page.ts`, `stats-core.ts`、パスワードは secret `ADMIN_TOKEN`）。
  **完全無料が絶対条件**: Workers/DO は Free プランのみ、有料サービス（TURN 等）を足さない。中継 URL・遅延・送信間隔は `config/net.ts`。
  **sim を変えたら全クライアントが同じビルドである必要がある**（ルームは `__BUILD_ID__` 一致のみ入室可）。
  試合中に時間の進み方を変える処理（スロー・一時停止）はオンラインでは無効にすること。`MatchMode` は `localId`/`team` を使い、agent 0 決め打ち禁止。
- 自己対戦（`tools/selfplay.ts`）実行中は `src/sim`・`src/config` を編集しない（ワーカーがソースを読み直す）。
