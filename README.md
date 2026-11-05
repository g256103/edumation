# Gesture Street

Webカメラで手の骨格・ジェスチャーを認識し、マウスなしで360度パノラマ空間を探索するブラウザアプリです。

- **人差し指** → 指す方向へ連続的に視点移動（上下左右に量子化しない）
- **握った手（人差し指も曲げる）** → 前進（次のシーンへ）
- **未検出** → 視点をその場で固定

Google Maps API などの有料APIは使用していません。

## 技術スタック

| 用途 | ライブラリ |
|------|------------|
| 360°表示 | [Pannellum](https://pannellum.org/) 2.5.6（CDN） |
| 手認識 | [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) Hand Landmarker（CDN） |
| カメラ | `navigator.mediaDevices.getUserMedia()` |

## 必要環境

- モダンブラウザ（Chrome / Edge / Firefox 推奨）
- Webカメラ
- ローカルHTTPサーバー（ES Modules / カメラ権限のため `file://` では動作しません）
- インターネット接続（初回に CDN と MediaPipe モデルを取得）

## 起動方法

プロジェクト直下でローカルサーバーを起動してください。

### Python

```bash
python -m http.server 8080
```

### Node.js（npx）

```bash
npx serve .
```

### VS Code / Cursor

「Live Server」などで `index.html` をサーブしても構いません。

ブラウザで次を開きます。

```
http://localhost:8080
```

1. パノラマが表示されることを確認
2. 右下の **カメラ ON** を押す
3. カメラ権限を許可する
4. **初期検出**: 手のひらをカメラに向けて安定させる
5. **デモ① 手のひら（約6秒）**: 開いた手のひらをカメラに向ける → 前進判定を学習（**手のひら＝進む**）
6. **デモ② 正面（約10秒）**: 図のとおり真正面を指す → 視点基準を設定（**人差し指の向き＝視点**）
7. 操作開始後も同じ対応：手のひら→進む、人差し指の向き→視点移動

## カメラ権限について

- 初回アクセス時、ブラウザがカメラ利用の許可を求めます
- 拒否した場合は画面右下にエラーが表示されます
- 再許可するときは、アドレスバーのサイト設定からカメラを「許可」に変更し、ページを再読み込みしてください
- HTTPS または `localhost` でのみカメラAPIが使えるブラウザが多いです

## 操作方法

| ジェスチャー | モード | 操作 |
|--------------|--------|------|
| 人差し指を伸ばして指す | 視点操作 | 指す方向へ連続的に視点が移動 |
| 開いた手のひらをカメラに見せる | 前進 | 次のシーンへ進む |
| 手が映らない | 視点固定 | その場の視点を維持（動かない） |

### シーン構成

```
Scene A（スタート） ⇄ Scene B（中間） ⇄ Scene C（先）
```

- A → 前進 → B → 前進 → C
- C → 後退 → B → 後退 → A
- リンクのない方向は移動しません

## パノラマ画像の差し替え方法

1. 正距円筒図法（equirectangular）の360度画像を用意する（推奨解像度: 2048×1024 以上）
2. 次のファイルを上書きする

```
assets/panorama/scene-a.jpg   … Scene A（スタート）
assets/panorama/scene-b.jpg   … Scene B（中間）
assets/panorama/scene-c.jpg   … Scene C（先）
```

3. ページを再読み込みする

別パスや追加シーンを使う場合は `script.js` の `SCENE_GRAPH` を編集します。

```js
const SCENE_GRAPH = {
  sceneA: {
    title: "Scene A · Start",
    panorama: "assets/panorama/scene-a.jpg",
    links: { forward: "sceneB", back: null, left: null, right: null },
  },
  // ...
};
```

### サンプル画像について

同梱の画像は [Pannellum](https://pannellum.org/images/) のデモ用パノラマです。プロトタイプ用途です。本番では独自のストリート／室内パノラマに差し替えてください。

## 感度・誤認識対策の調整

`script.js` 先頭の `CONFIG` で、手認識と視点操作を分けて調整できます。

```js
const CONFIG = {
  recognition: {
    indexExtendThreshold: 1.15,
    indexCurlThreshold: 0.78,
    moveConfirmFrames: 9,
    lostGraceFrames: 10,
  },
  viewpoint: {
    oneEuroMinCutoff: 0.9,
    oneEuroBeta: 0.55,
    deadZone: 0.22,
    responsePower: 1.55,
    yawSensitivity: 110,
    pitchSensitivity: 85,
  },
  movement: {
    moveCooldownMs: 1700,
    confirmFrames: 12,
  },
};
```

## ファイル構成

```
├── index.html
├── style.css
├── script.js
├── README.md
└── assets/
    └── panorama/
        ├── scene-a.jpg
        ├── scene-b.jpg
        └── scene-c.jpg
```

## パフォーマンス（CONFIG.perf）

重い場合は `script.js` の `CONFIG.perf` を調整します。

| 項目 | 既定 | 効果 |
|------|------|------|
| `camWidth` / `camHeight` | 480×360 | MediaPipe入力解像度（最大の負荷源） |
| `detectIntervalMs` | 55 | 手検出の呼び出し頻度 |
| `detectIntervalTutorialMs` | 85 | デモ中の検出頻度（さらに抑制） |
| `overlayIntervalMs` | 120 | 骨格キャンバス再描画頻度 |
| `showDebug` | false | debug パネル表示 |
| `lightOverlay` | true | 簡略骨格で canvas 負荷を削減 |

検出 / overlay / Pannellum / DOM は別レートです。視点は `setYaw(yaw, false)` / `setPitch(pitch, false)` のみ使用します。

### 回帰確認

- [ ] 手検出 → 手のひらデモ → 正面デモ → 操作解禁
- [ ] 人差し指の指す方向で連続視点移動（4方向量子化なし）
- [ ] 開いた手のひらで前進（デモ後は判定が自分の開掌に合う）
- [ ] こぶしでは前進しない
- [ ] 未検出で視点固定（ジャンプしない）
- [ ] debug の fps / detect ms / profile が表示される

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| パノラマが出ない | ローカルサーバー経由で開いているか確認 |
| 骨格が映らない | カメラ権限・照明・手がフレーム内かを確認 |
| 初期検出が進まない | 手を枠の中央で静止させる。暗い場合は明るくする |
| モードが暴れる | `confirmFrames` を上げる / 背景を単純にする |
| まだ重い | `camWidth` を 480、`detectIntervalMs` を 50 に上げる |
| 視点が鈍い | `detectIntervalMs` を 33、`yawSensitivity` を上げる |
| シーンが連続で切り替わる | `moveCooldownMs` を上げる |

## ライセンス・クレジット

- Pannellum — [MIT](https://github.com/mpetroff/pannellum)
- MediaPipe — Google（モデル利用規約に従ってください）
- デモパノラマ — pannellum.org サンプル画像
