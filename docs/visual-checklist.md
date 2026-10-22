# 描画確認チェックリスト（人が見るもの）

自動テストで「動く」ことは確認済み。以下は**好み・見た目**なので実機で見て判断してください。
調整箇所は各行の右に書いてあります。

| # | 見るところ | 確認方法 | 調整先 |
|---|---|---|---|
| 1 | 武器の大きさ・位置（画面右下に収まっているか） | 試合開始直後 | `src/config/feel.ts` `VIEWMODEL.scale / hipOffset` |
| 2 | ADS（右クリック）で照準が画面中央に来るか | 右クリック長押し | `VIEWMODEL.adsOffset` |
| 3 | 反動の跳ね方と戻り | 壁に向かって連射 | `src/config/weapons.ts` `recoil.pattern / recovery / viewFollow` |
| 4 | 撃った感触（マズルフラッシュ・揺れ・音） | 連射 | `feel.ts` `kick`, `config/audio.ts` `weapon.*` |
| 5 | 移動速度・止まる速さ | WASD・Shift・Ctrl | `config/movement.ts` |
| 6 | 感度・キーの初期値（プレイヤーは「設定 → キー設定」で変更可） | 設定画面 | `config/input.ts` |
| 7 | 敵の見やすさ（チーム色・遠距離での視認性） | サイトで撃ち合う | `config/visuals.ts` `PALETTE.teams` |
| 8 | 時間帯ごとの色（昼・夕方・夕暮れ）が暗すぎないか | ラウンドを進める | `visuals.ts` `LIGHTING_MOODS` |
| 9 | スモークの濃さ・色・中に入った時の白さ | Q で投げる・中に入る | `visuals.ts` `FX_STYLE.smoke`, `render/smoke-viz.ts` の alpha |
| 10 | 壁のテクスチャのノイズ感 | 遠くの壁を見る | `visuals.ts` `PALETTE.surfaces.*.grid.noise` |
| 11 | ボットの強さ（来場者が楽しめるか） | 「かんたん」で数人に遊んでもらう | `config/bots.ts` / `tuning.generated.ts` |
| 12 | 1ラウンドの長さ・先取数 | 通しで遊ぶ | `config/rules.ts` |
| 13 | タイトルのデモ画面のカメラワーク | 30秒放置 | `app/attract.ts`（距離 3.2 m 等） |
| 14 | 展示PCでのfps（Low/Medium 60fps が目標） | `?debug` または F3 で左下に表示 | `config/quality.ts` |
| 15 | 音量バランス（銃声・足音・UI） | ヘッドホンで | `config/audio.ts` |
| 16 | キャラの色・装備（攻撃側=暗色+琥珀ライン、防衛側=白アーマー+シアン） | 試合・デモ画面 | `config/skins.ts` `SKINS` |
| 17 | 敵の縁取りの強さ・暗い面の持ち上げ | 撃ち合う | `config/skins.ts` `CHARACTER_LOOK.enemyRim / shadowLift` |
| 18 | ステージの色合い（地区ごとの壁・床の色） | 各ステージを歩く | `sim/map/stages.ts` の zones（wall / floor） |
| 19 | 装飾の量と色（窓・帯・木・屋台・旗・街灯） | 各ステージを歩く | `config/themes.ts` |
| 20 | ステージの時間帯・明るさ（製鉄所は暗めにしてある） | ラウンドを進める | `config/themes.ts` の moods |
| 21 | 敵の数と難易度の組み合わせ | タイトルのステージ選択・設定の敵の数 | `sim/map/registry.ts` の STAGES |

## このマシン（Radeon 680M）で自動確認済み
- タイトル・試合・リザルト・リプレイ・キルカム・デモ画面のスクリーンショットを撮って確認
- Low/Medium は WebGL2・WebGPU とも 60fps（`docs/perf.md`）
- WebGPU 経路で外部通信なし（オフライン展示OK）
