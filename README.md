# edumation

> しゃべって作って、手で動かす。説明のテンポを止めない中学数学アニメ（MVP デモ）

ブラウザだけで動きます。手の検出は MediaPipe がブラウザ内で処理し、映像は外に出ません。

## 起動

```
python -m http.server 5500
```

http://localhost:5500 を Chrome で開く（音声認識は Chrome 推奨）。

1. **カメラ ON** → 親指と人差し指の「つまみ」で、選択中のパラメータが連続的に変わる
2. **音声 ON** →「円の面積の公式を説明して」「並べて」「倍にして」「色を変えて」
3. 右上 **設定** に Gemini API キーを入れると、Gemini Code Execution による数値検証と、ルールで解釈できない命令の構造化出力が有効になる（鍵が無くてもローカル検証とルール命令で全機能デモ可能）

## 操作モデル

| 入力 | 役割 | 例 |
|---|---|---|
| 手（つまみ 0〜1） | 連続・直感 | 分割数、傾き、a、点Pの位置 |
| 音声 / テキスト | 離散・言語 | 止めて / 倍にして / 色を変えて / 一次関数を出して |
| 手を下ろす | 固定 | 値はそのまま保持（ジャンプしない） |

- 手が再び映ったとき、現在値から 350ms かけてつまみ値へブレンド（値が飛ばない）
- 整数パラメータ（分割数）はヒステリシス付きで、震えで数が揺れない
- スライダーはマウス代替（比較デモ用）

## 部品（parts.js）

| template | 手で動かす | 見せたいこと |
|---|---|---|
| `circleArea` | 分割数 n（並べ替え t はアニメ） | 扇形が長方形に近づく → πr² |
| `linear` | 傾き a / 切片 b | 式とグラフが同時に動く |
| `quadratic` | a | 放物線の開き方 |
| `inscribedAngle` | 点Pの位置 / 弧の大きさ | 動かしても ∠APB が一定 |

契約: `setNorm(name, v01)` / `set(name, value)` / `render(ctx, w, h, theme)` / `spec() → {template, params}`

## 生成・検証フロー

```
発話 → ai.js: ルール即時 → (未解釈なら) Gemini 構造化出力 → actions
spec → verify.js: verifyLocal（即時）＋ verifyWithGemini（Code Execution, 2.5s デバウンス）
→ 画面右上に「✓ 面積 = πr² を検証済み」バッジ、右パネルに検査項目
```

## ファイル

```
index.html / style.css
js/app.js     統合・UI
js/hand.js    MediaPipe → pinch 0..1、骨格オーバーレイ
js/parts.js   部品（Canvas）
js/verify.js  ローカル検証 + Gemini Code Execution
js/voice.js   Web Speech 認識 / TTS（TTS 中は認識を止めてループ防止）
js/ai.js      ルール解析 + Gemini 構造化出力
js/filters.js One-Euro フィルタ
```

## 既知の制約

- 音声認識は Chrome の Web Speech API（Google サーバーで認識）。オフラインでは使えない
- Gemini 呼び出しはブラウザから直接。デモ用途のみ（本番はサーバー経由で鍵を隠す）
- 遠距離・暗所は手検出が不安定。黒板前なら腕を上げて胸の高さで
