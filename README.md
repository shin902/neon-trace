# NEON TRACE

カメラ・動画ファイルを入力とするライブ輪郭エフェクト。静的HTML/JSのみで動作し、映像のアップロードは行いません。

## 起動

Node.jsとPython 3が必要です。依存パッケージのインストールは不要です。

```sh
git clone https://github.com/shin902/neon-trace.git
cd neon-trace
npm start
```

http://localhost:3000 を開きます。カメラにはHTTPSまたはlocalhostが必要です。YouTube iframeおよびタブ/画面共有は対象外です。

## 処理

- Web Worker内で縮小映像を約15回/秒解析（描画はrequestAnimationFrame）。最大解析寸法384px。
- Gaussianぼかし → Sobel勾配 → 非最大抑制 → 二段閾値でヒステリシス → 輪郭のトレース。
- 元の線の長さを画面対角線に対する割合で判定し、短い線を除去。
- 輪郭を追跡、向きを合わせて平滑化。安定した線のみフェードインし、失われた線はフェードアウト。
- 輪郭の法線方向へ滑らかなノイズを加え、輪郭に沿って流す。ノイズ/振動モードも選択可能。
- 人物モードはMediaPipe Selfie Segmenterで人物領域を抽出し、内部の模様を除いて外周を解析。

人物モデルの初回ロードにはcdn.jsdelivr.netとstorage.googleapis.comへのアクセスが必要です。モデルが取得できない場合は全体のエッジに戻し、画面に理由を表示します。Google Fontsも外部取得しますが、取得できない場合はシステムフォントに戻ります。デモと全体のエッジモードは外部ライブラリを必要としません。

入力を停止するとMediaStreamの全トラックを終了します。カメラ入力の一時停止はエフェクトの停止で、映像入力は継続します。解析FPSと画面右上の描画FPSは異なります。人物抽出の処理速度・精度は端末と映像に依存します。

## 検証

輪郭処理の単体テストは6件です。実ブラウザでのカメラ・人物モデルの動作確認は未完了です。

```sh
npm test
node --check dist/app.js
node --check dist/worker.js
```
