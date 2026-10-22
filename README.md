# HALCYON LINE（ハルシオン・ライン）

学園祭で展示するための、ブラウザで遊べる戦術FPSのデモです。
プレイヤー1人（攻撃側）がボット3体（防衛側）と戦い、3ラウンド先取で勝敗を決めます。

- 公開URL: https://halcyon-line.pages.dev/
- 対応環境: PC の Google Chrome / Microsoft Edge 最新版（WebGPU 優先、使えない場合は WebGL2）
- 外部アセットは使っていません。マップ・キャラクター・武器・テクスチャ・効果音はすべてプログラムで生成しています。

## ルール
- **勝利条件（攻撃側）**: 防衛側を全滅させる、または Aサイトの中継塔（Relay）を5秒間制圧する
- **勝利条件（防衛側）**: 攻撃側を全滅させる、または制限時間（100秒）を守り切る
- ラウンド開始時の4秒間は準備フェーズで、移動と射撃はできません

## 操作方法（初期設定）
| 操作 | キー |
|---|---|
| 移動 | W / A / S / D |
| 視点 | マウス |
| 歩き（足音が出ない） | Shift |
| ジャンプ | Space |
| しゃがみ | C（全画面時は Ctrl も可） |
| 射撃 | 左クリック |
| 覗き込み（ADS） | 右クリック |
| リロード | R |
| 武器切替 | 1 ライフル（Kestrel） / 2 ピストル（Wren） / 3 スナイパー（Heron） |
| スモーク（Veil） | Q |
| ダッシュ（Slip） | E |
| 操作確認（押している間表示） | Tab / F1 |
| 一時停止 | Esc |

- キーは **「設定 → キー設定」** で変更できます（タイトル画面と一時停止画面から開けます）。設定はブラウザに保存されます。
- **タッチパッドではなくマウスの使用を推奨します。** 多くのノートPCは「キー入力中はタッチパッドを無効にする」設定になっており、移動しながら視点移動や射撃ができなくなります。

## 主な機能
- **決定的シミュレーション**: ゲームロジックは60Hz固定ステップで動き、同じ入力からは必ず同じ結果になります。これを使ってキルカム、ラウンドリプレイ、ヘッドレス自己対戦を実現しています。
- **ボットAI**: 視覚（視野・遮蔽・スモーク）と聴覚（足音・銃声）で敵を知覚し、状況に応じて行動を選びます。クロスファイア、遮蔽物への退避、スモークの使用、ローテーションを行います。難易度は3段階です。
- **武器**: 初弾精度、反動パターン、移動時の弾のばらつき、部位ダメージ（頭・胴・脚）、ヒットスキャン
- **アビリティ**: 視界を遮るスモーク（ボットの視線も遮る）、短距離ダッシュ
- **描画**: PBR、IBL、ブルーム、SSAO、ボリュメトリックライト、GPUパーティクル（WebGPU ではコンピュートシェーダ）、時間帯の変化、手続き的アニメーション（脚と腕の IK、武器の反動と揺れ）
- **サウンド**: Web Audio で全効果音を合成し、立体音響に加えて、マップ形状から残響と壁越しのこもりを計算します
- **展示向け機能**: 自動画質調整、60秒無操作でタイトルへ戻る、タイトル放置でボット同士のデモ試合を再生、ハイスコア、エラー時の自動復帰
- **おまけ**: 破壊できる木箱とガラス、弾痕、ミニマップ、決着時のスローモーション、シードから毎ラウンド変化するマップ（`?f=seededMap`）

## 必要なもの
- Node.js 22 以上（開発環境では 26 で確認）
- npm
- E2E テストを動かす場合は Chromium（システムにあればそれを使います。なければ `npx playwright install chromium`）

## セットアップと開発
```bash
npm install
npm run dev            # 開発サーバ http://localhost:5173
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバを起動 |
| `npm run build` | 型チェック → `dist/` にビルド → Cloudflare Pages の制限チェック |
| `npm run preview` | ビルド結果をローカルで確認 |
| `npm run test` | ユニットテスト（Vitest） |
| `npm run e2e` | E2E テスト（Playwright） |
| `npm run typecheck` | 型チェックのみ |
| `npm run selfplay` | ヘッドレス自己対戦でバランスを測定し `docs/balance.md` を出力（`-- --apply` でボット難易度を自動調整） |
| `npm run validate:map` | マップの射線チェック → `docs/map-validation.md` |
| `npm run perf` | 画質プリセットごとのフレーム時間を計測 → `docs/perf.md`（実際のGPUで測る場合は `-- --headed`） |
| `npm run pack:offline` | オフライン展示用の ZIP を作成 |
| `npm run deploy` | ビルドして Cloudflare Pages にデプロイ（wrangler） |

### URL パラメータ
| パラメータ | 内容 |
|---|---|
| `?engine=webgl` | WebGL2 を強制する（WebGPU が不安定な PC 向け） |
| `?q=low` / `medium` / `high` / `ultra` | 画質を固定する（省略時は自動判定と自動調整） |
| `?f=ssao,-bloom` | 機能を個別に ON/OFF する。`?f=tier0` で追加機能をすべて OFF、`?f=seededMap` で毎ラウンド遮蔽物が変化 |
| `?debug` | fps などを表示する（F3 キーでも切替） |
| `?fs=0` | 開始時に全画面にしない |
| `?idle=秒数&attract=秒数` | 展示用タイマーを短くする（リハーサル用） |
| `?seed=数値` | デモ試合を毎回同じ展開にする（性能計測用） |

## GitHub への手動アップロード
```bash
# GitHub で空のリポジトリを作成しておく（README などは追加しない）
git remote add origin git@github.com:<ユーザー名>/<リポジトリ名>.git
#   HTTPS の場合: https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```
- `node_modules/` や `dist/`、ZIP などのビルド成果物は `.gitignore` で除外されています。
- SSH で push する場合は、公開鍵（例: `~/.ssh/id_ed25519.pub`）を GitHub の Settings → SSH and GPG keys に登録してください。

## デプロイ（Cloudflare Pages・無料プラン）
### A. GitHub 連携（push すると自動でデプロイ）
1. 上の手順で GitHub に push する
2. Cloudflare ダッシュボード → Workers & Pages → 作成 → Pages → Git に接続 → リポジトリを選択
3. ビルド設定
   - フレームワーク: なし
   - ビルドコマンド: `npm run build`
   - 出力ディレクトリ: `dist`
   - 環境変数: `NODE_VERSION` = `22`

※ すでに wrangler で作成した `halcyon-line` プロジェクトは「直接アップロード」型のため、Git 連携にする場合は Cloudflare 上で新しいプロジェクトとして作成してください。

### B. 手動デプロイ（wrangler）
```bash
npx wrangler login     # 初回のみ
npm run build
npx wrangler pages deploy dist --project-name halcyon-line
```

Cloudflare Pages の制限（1ファイル 25 MiB、無料プランは 20,000 ファイルまで）は `npm run build` の最後に自動でチェックしています。

## 展示当日（オフラインでの動かし方）
ネットワークが使えない場合に備えて、ローカルだけで動く ZIP を用意できます。
```bash
npm run build
npm run pack:offline   # → halcyon-offline.zip（約1.5 MiB）
```
1. ZIP を展示PCにコピーして展開する
2. Windows は `start.bat`、macOS / Linux は `sh start.sh` を実行する
3. ブラウザで http://localhost:8080/ が開く（Node.js がなければ Python 3 で起動します）。F11 で全画面にする

### 展示用の安全装置
- 60秒間操作がないと、自動でタイトル画面に戻る
- タイトル画面で30秒放置すると、ボット同士のデモ試合を全画面で再生する（マウスかキーを触ると戻る）
- 予期しないエラーが起きると「タイトルに戻ります」と表示し、3秒後に復帰する。何度も起きる場合は、重い効果を切る → 画質を Low にする → WebGL2 にする、の順で安全側に切り替える
- Esc でマウスロックが外れると一時停止画面になる（クリックで再開）

## 数値の調整
撃ち心地や見た目の数値は、すべて `src/config/` にまとめてあります。

| ファイル | 内容 |
|---|---|
| `weapons.ts` | ダメージ、連射速度、反動パターン、弾のばらつき、リロード時間 |
| `movement.ts` | 移動速度、加速、ジャンプの高さ、ダッシュ |
| `input.ts` | 感度と視野角の初期値、キーの初期設定 |
| `bots.ts` / `tuning.generated.ts` | ボットの反応時間、照準誤差、連携度（後者は自己対戦の出力） |
| `rules.ts` | ラウンド時間、先取数、制圧時間、スコア |
| `quality.ts` | 画質プリセット、自動調整のしきい値 |
| `visuals.ts` / `skins.ts` | マップとキャラクターの色、時間帯 |
| `feel.ts` / `audio.ts` | 武器の揺れ方、音量バランス |

見た目や操作感で確認してほしい項目は `docs/visual-checklist.md` にまとめてあります。

## ディレクトリ構成
```
src/
  config/   調整用の数値（ここだけ触れば遊び心地を変えられる）
  sim/      決定的シミュレーション（Babylon.js にも DOM にも依存しない純粋な TypeScript）
    core/     乱数、決定的な三角関数、固定ステップ
    physics/  当たり判定（BVH、箱のスイープ）
    entities/ プレイヤー、武器、スモーク、ヒット判定
    bots/     ボットAI、経路探索、戦術データ
    map/      マップ定義、遮蔽物の自動生成、射線チェック
    replay/   入力ログとリプレイ
  render/   Babylon.js による描画（キャラクター、武器、エフェクト、ポストエフェクト、画質の自動調整）
  audio/    Web Audio による効果音の合成と立体音響
  input/    キーボード・マウス入力、キーバインド
  ui/       HUD、メニュー画面
  app/      画面遷移、試合、キルカム、デモ試合、リプレイ、展示用の安全装置
tools/      自己対戦、射線チェック、性能計測、オフライン ZIP、Pages 制限チェック
tests/      unit（Vitest）、e2e（Playwright）
docs/       設計・バランス・性能・確認項目のレポート
```

## ドキュメント
- `docs/architecture.md` — 設計の説明（決定性、物理、ボットAI、描画、画質調整）
- `docs/balance.md` — 自己対戦の結果（武器の TTK、攻守のバランス、難易度の調整）
- `docs/map-validation.md` — マップの射線チェックの結果
- `docs/perf.md` — 画質プリセットごとのフレーム時間（Radeon 680M で Low / Medium が 60fps）
- `docs/visual-checklist.md` — 人の目で確認してほしい項目と調整場所
- `CREDITS.md` — 使用ライブラリとライセンス

## 既知の制約
- SSAO は WebGL2 でのみ有効です（WebGPU では Babylon.js 9.31 の不具合で無効にしています）。
- しゃがみの Ctrl キーは、全画面でキーボードロックが有効なときだけ使えます（Ctrl+W でタブが閉じるのを防ぐため）。

## 技術スタック
TypeScript / Vite / Babylon.js（WebGPU・WebGL2） / Havok（破片の見た目の物理のみ） / Vitest / Playwright / Cloudflare Pages

ゲーム名、世界観、キャラクター、武器、アビリティはすべてオリジナルです。
