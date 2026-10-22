# HALCYON LINE

学園祭展示用のブラウザ戦術FPSデモ。1人（攻撃側）vs ボット3体（防衛側）、3ラウンド先取。
TypeScript + Vite + Babylon.js（WebGPU優先・WebGL2フォールバック）。PC の Chrome / Edge 最新版向け。
外部アセットなし：テクスチャ・モデル・効果音はすべてコードで生成しています。

- 勝利条件: 防衛側の全滅、または Aサイトの中継塔（Relay）を5秒制圧。時間切れ（100秒）は防衛側の勝ち
- 操作（初期設定）: WASD / マウス / Shift 歩き / Space ジャンプ / C（全画面時は Ctrl も）しゃがみ / 左クリック 射撃 / 右クリック 覗き込み / R リロード / 1・2・3 武器 / Q スモーク / E ダッシュ / Tab・F1 操作確認 / Esc 一時停止
- キーは「設定 → キー設定」（タイトル・一時停止画面から）で変更でき、ブラウザに保存されます

## 開発
```bash
npm install
npm run dev            # http://localhost:5173
npm run test           # ユニットテスト（Vitest, 70+件）
npm run e2e            # E2E（Playwright。システムの Chromium、なければ `npx playwright install chromium`）
npm run build          # 型チェック → dist/ → Cloudflare Pages 制限チェック（25 MiB/ファイル, 20,000 ファイル）
npm run selfplay       # ヘッドレス自己対戦 → docs/balance.md（`-- --apply` でボット難易度を自動調整）
npm run validate:map   # 射線チェック → docs/map-validation.md
npm run perf           # フレーム時間計測 → docs/perf.md（実機GPUは `-- --headed`）
```

URL パラメータ:

| パラメータ | 意味 |
|---|---|
| `?engine=webgl` | WebGL2 を強制（WebGPU が不安定な PC 向け） |
| `?q=low\|medium\|high\|ultra` | 画質を固定（省略時は自動判定＋自動調整） |
| `?f=ssao,-bloom` | 機能フラグの個別 ON/OFF。`?f=tier0` で全部 OFF、`?f=seededMap` で毎ラウンド遮蔽物が変化 |
| `?debug` | fps 表示（F3 でも切替） |
| `?fs=0` | クリック時に全画面にしない |
| `?idle=N&attract=N` | 展示タイマー（無操作でタイトルへ / デモ開始）を N 秒に短縮（リハーサル用） |

## デプロイ（Cloudflare Pages・無料プラン）
### A. GitHub 連携（push するたび自動デプロイ）
1. このリポジトリを GitHub に push
2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git → リポジトリを選択
3. Framework preset: なし / Build command: `npm run build` / Build output directory: `dist`
4. 環境変数 `NODE_VERSION` = `22`（以上）

### B. 手動（wrangler）
```bash
npm run build
npx wrangler pages deploy dist --project-name halcyon-line
# または npm run deploy
```

## 展示当日（オフライン）
```bash
npm run build && npm run pack:offline   # → halcyon-offline.zip（約1.5 MiB）
```
ZIP を展示PCに展開し、Windows は `start.bat`、macOS/Linux は `sh start.sh`。Node.js（なければ Python 3）でローカルサーバが立ち上がり、ブラウザで http://localhost:8080/ が開きます。インターネット不要です。

展示用の安全装置:
- 60秒無操作 → タイトルへ戻る。タイトルで30秒放置 → ボット同士のデモ試合を全画面再生
- 予期しないエラー → 「タイトルに戻ります」を表示して3秒で復帰。連続した場合は重い効果を切る → Low → WebGL2 の順に安全側へ
- Esc でポインタロックが外れたら一時停止画面

## ドキュメント
- `docs/architecture.md` — 設計（決定的シミュレーション、物理、ボットAI、描画、品質調整）
- `docs/balance.md` — 自己対戦による TTK・攻守バランス・難易度調整の結果
- `docs/map-validation.md` — 射線チェックの結果
- `docs/perf.md` — プリセット別フレーム時間
- `docs/visual-checklist.md` — 人が見て判断する項目と調整箇所
- `CREDITS.md` — ライセンス
