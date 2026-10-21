# HALCYON LINE

学園祭展示用のブラウザ戦術FPSデモ（TypeScript + Vite + Babylon.js）。PC の Chrome / Edge 最新版向け。

## 開発
```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # ユニットテスト（Vitest）
npm run e2e        # E2E（Playwright。システムの Chromium か `npx playwright install chromium`）
npm run build      # 型チェック → dist/ → Cloudflare Pages 制限チェック
```

URL パラメータ: `?engine=webgl`（WebGL2 強制）/ `?q=low|medium|high|ultra`（品質）/ `?seed=N` / `?fs=0`（全画面にしない）

## デプロイ（Cloudflare Pages、無料プラン）
### A. GitHub 連携
1. このリポジトリを GitHub に push
2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git
3. Build command: `npm run build` / Build output directory: `dist` / 環境変数 `NODE_VERSION=22` 以上

### B. 手動（wrangler）
```bash
npm run build
npx wrangler pages deploy dist --project-name halcyon-line
```

## 展示当日（オフライン）
P4 で `npm run pack:offline` を追加予定（dist + 依存なしローカルサーバを ZIP 化）。
