# BrainSync Focus Timer - テストガイド

本ドキュメントでは、BrainSync Focus Timer 拡張機能をローカル環境の VSCode でテストする手順を説明します。

---

## 目次

1. [前提条件](#前提条件)
2. [環境セットアップ](#環境セットアップ)
3. [自動テストの実行](#自動テストの実行)
   - [コマンドラインから実行](#コマンドラインから実行)
   - [VSCode デバッガーから実行](#vscode-デバッガーから実行)
4. [拡張機能の手動テスト（デバッグ実行）](#拡張機能の手動テストデバッグ実行)
5. [テストスイートの構成](#テストスイートの構成)
6. [手動テストチェックリスト](#手動テストチェックリスト)
7. [トラブルシューティング](#トラブルシューティング)

---

## 前提条件

| ツール | バージョン |
|--------|-----------|
| [Visual Studio Code](https://code.visualstudio.com/) | 1.80.0 以上 |
| [Node.js](https://nodejs.org/) | 20.x 以上 |
| npm | Node.js に付属 |

バージョンの確認:

```bash
code --version
node --version
npm --version
```

---

## 環境セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/YukiTachi/brainsync-pomodoro-vscode-extension.git
cd brainsync-pomodoro-vscode-extension
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. TypeScript のコンパイル

```bash
npm run compile
```

コンパイルが成功すると `out/` ディレクトリに JavaScript ファイルが生成されます。

### 4. リントの実行（任意）

```bash
npm run lint
```

---

## 自動テストの実行

本プロジェクトでは **Mocha** + **@vscode/test-electron** を使用した自動テストが用意されています。テストは実際の VSCode インスタンス（Extension Host）内で実行されるため、VSCode API の動作も含めて検証できます。

### コマンドラインから実行

```bash
npm test
```

このコマンドは内部で以下を順番に実行します:

1. `npm run compile` — TypeScript をコンパイル
2. `npm run lint` — ESLint によるコード検証
3. `node ./out/test/runTest.js` — テストランナーの起動

テストランナーは `@vscode/test-electron` を使って VSCode のインスタンスをダウンロード・起動し、その中でテストを実行します。初回実行時は VSCode のダウンロードが発生するため、通常より時間がかかります。

**実行結果の例:**

```
Extension Test Suite
  ✓ 拡張機能がアクティベートされる
  ✓ brainsync.startTimerコマンドが存在する
  ✓ brainsync.viewStatsコマンドが存在する
  ✓ brainsync.openDiagnosisコマンドが存在する

Timer Utility Test Suite
  formatTime
    ✓ 0秒を0:00にフォーマット
    ✓ 60秒を1:00にフォーマット
    ...

Statistics Test Suite
  estimateFatigueScore
    ✓ デフォルト統計ではスコアが0
    ✓ セッション数6でスコアが3
    ...
```

### VSCode デバッガーから実行

テストをデバッグ実行することで、ブレークポイントを使った詳細な調査が可能です。

1. VSCode でプロジェクトフォルダを開く
2. サイドバーの **実行とデバッグ** (Ctrl+Shift+D / Cmd+Shift+D) を開く
3. ドロップダウンから **「Extension Tests」** を選択
4. **F5** キーまたは再生ボタンをクリック

この構成は `.vscode/launch.json` に定義されており、テスト実行前に自動的に TypeScript のコンパイル（`npm run compile`）が行われます。

---

## 拡張機能の手動テスト（デバッグ実行）

開発中の拡張機能を実際の VSCode 上で動かして手動テストする方法です。

### 方法 1: デバッグ起動（推奨）

1. VSCode でプロジェクトフォルダを開く
2. サイドバーの **実行とデバッグ** (Ctrl+Shift+D / Cmd+Shift+D) を開く
3. ドロップダウンから **「Run Extension」** を選択
4. **F5** キーまたは再生ボタンをクリック

新しい VSCode ウィンドウ（Extension Development Host）が起動し、開発中の拡張機能がロードされた状態になります。

> **ヒント:** `npm run watch` を事前に実行しておくと、ソースコードの変更が自動的にコンパイルされます。Extension Development Host ウィンドウで Ctrl+R (Cmd+R) を押すと、再コンパイル後の変更がリロードされます。

### 方法 2: ウォッチモードとの併用

ターミナルでウォッチモードを起動:

```bash
npm run watch
```

その後、VSCode から F5 で **「Run Extension」** を実行します。ソースコードを変更すると自動的に再コンパイルされるため、Extension Development Host を Ctrl+R (Cmd+R) でリロードするだけで変更を確認できます。

---

## テストスイートの構成

テストファイルは `test/suite/` ディレクトリに配置されています。

```
test/
├── runTest.ts              # テストランナーのエントリポイント
└── suite/
    ├── index.ts            # Mocha の設定（UI: tdd, タイムアウト: 10秒）
    ├── extension.test.ts   # 拡張機能のアクティベーションテスト
    ├── timer.test.ts       # タイマーユーティリティのテスト
    └── statistics.test.ts  # 統計・脳疲労スコアのテスト
```

### extension.test.ts

拡張機能が正しくアクティベートされ、コマンドが登録されていることを検証します。

| テスト | 検証内容 |
|--------|---------|
| 拡張機能がアクティベートされる | `brainsync.*` コマンドが1つ以上登録されている |
| brainsync.startTimer コマンドが存在する | タイマー開始コマンドの登録確認 |
| brainsync.viewStats コマンドが存在する | 統計表示コマンドの登録確認 |
| brainsync.openDiagnosis コマンドが存在する | 脳疲労診断コマンドの登録確認 |

### timer.test.ts

タイマーのユーティリティ関数を検証します。

| テストスイート | テスト数 | 検証内容 |
|---------------|---------|---------|
| formatTime | 6 | 秒数から `MM:SS` 形式への変換 |
| createDefaultTimerData | 1 | デフォルトのタイマー状態の初期値 |
| getWeekStart | 4 | 任意の日付から週の開始日（月曜）を算出 |
| getWeekEnd | 2 | 任意の日付から週の終了日（日曜）を算出 |

### statistics.test.ts

統計計算と脳疲労スコアのロジックを検証します。

| テストスイート | テスト数 | 検証内容 |
|---------------|---------|---------|
| estimateFatigueScore | 8 | 脳疲労スコア（0-45点）の算出ロジック |
| calculateInterruptionRate | 3 | セッション中断率の計算 |
| calculateBreakSkipRate | 2 | 休憩スキップ率の計算 |
| updateTodayStats | 3 | 本日の統計データの更新処理 |
| exportToCSV | 2 | CSV エクスポート形式の正当性 |
| updateWeeklyStats | 1 | 週次統計の集計処理 |

---

## 手動テストチェックリスト

Extension Development Host で拡張機能を起動した後、以下の項目を確認してください。コマンドは **コマンドパレット** (Ctrl+Shift+P / Cmd+Shift+P) から実行できます。

### タイマー基本操作

- [ ] `BrainSync: タイマー開始` でタイマーが開始される
- [ ] ステータスバーに残り時間が `MM:SS` 形式で表示される
- [ ] `BrainSync: タイマー一時停止/再開` で一時停止・再開が切り替わる
- [ ] `BrainSync: タイマーリセット` でタイマーがリセットされる
- [ ] 作業時間終了後に通知が表示される
- [ ] 作業終了後に自動で休憩が開始される（`brainsync.autoStartBreak` が `true` の場合）
- [ ] `BrainSync: 休憩をスキップ` で休憩をスキップして作業を開始できる

### 統計・脳疲労

- [ ] `BrainSync: 統計を表示` で統計パネルが開く
- [ ] 統計パネルに本日のセッション数・集中時間が表示される
- [ ] 脳疲労スコアが 0-45 の範囲で表示される
- [ ] `BrainSync: データをエクスポート` で CSV ファイルが保存される
- [ ] `BrainSync: 統計をリセット` で統計データがクリアされる

### 設定

- [ ] `BrainSync: 設定` で VSCode の設定画面（BrainSync セクション）が開く
- [ ] 作業時間の変更（15-60分）がタイマーに反映される
- [ ] サウンドの有効/無効が切り替わる

### その他

- [ ] `BrainSync: 脳疲労診断を受ける` で外部ブラウザが開く
- [ ] VSCode を再起動してもタイマー状態が復元される

---

## トラブルシューティング

### `npm test` でエラーが発生する

**「Cannot find module」エラー:**

```bash
npm run compile
```

を実行してコンパイルが成功しているか確認してください。`out/` ディレクトリが生成されていない場合はコンパイルエラーです。

**ESLint エラー:**

```bash
npm run lint
```

を個別に実行してリントエラーの詳細を確認してください。

### Extension Development Host が起動しない

- `npm run compile` が正常に完了していることを確認
- VSCode のバージョンが 1.80.0 以上であることを確認
- `node_modules` を削除して `npm install` を再実行

```bash
rm -rf node_modules out
npm install
npm run compile
```

### テスト実行時に VSCode のダウンロードが失敗する

`@vscode/test-electron` はテスト実行時に VSCode のバイナリを `.vscode-test/` にダウンロードします。ネットワーク環境を確認してください。プロキシ環境では以下の設定が必要な場合があります:

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
npm test
```

### Linux: 共有ライブラリ不足エラー（`libasound.so.2` など）

`npm test` 実行時に以下のようなエラーが発生する場合があります:

```
error while loading shared libraries: libasound.so.2: cannot open shared object file: No such file or directory
Exit code: 127
```

`@vscode/test-electron` がダウンロードする VSCode は Electron ベースのデスクトップアプリケーションであるため、Linux 環境では GUI 関連のシステムライブラリが必要です。最小構成の Linux や WSL 環境ではこれらが不足していることがあります。

**Ubuntu / Debian 系の場合:**

```bash
sudo apt-get update
sudo apt-get install -y \
  libasound2 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxshmfence1 \
  xdg-utils
```

**Fedora / RHEL 系の場合:**

```bash
sudo dnf install -y \
  alsa-lib \
  atk \
  at-spi2-atk \
  cups-libs \
  libdrm \
  mesa-libgbm \
  gtk3 \
  nspr \
  nss \
  libX11-xcb \
  libXcomposite \
  libXdamage \
  libXfixes \
  libXrandr \
  libxshmfence \
  xdg-utils
```

**不足ライブラリの特定方法:**

どのライブラリが不足しているかを調べるには `ldd` コマンドが便利です:

```bash
ldd .vscode-test/vscode-linux-x64-*/code | grep "not found"
```

出力された `not found` のライブラリを個別にインストールしてください。

**ディスプレイ環境がない場合（ヘッドレス Linux / CI 環境）:**

VSCode (Electron) は描画先のディスプレイが必要です。ディスプレイのないサーバー環境や CI では、仮想フレームバッファ `xvfb` を使用してください:

```bash
sudo apt-get install -y xvfb    # Ubuntu/Debian
# または
sudo dnf install -y xorg-x11-server-Xvfb  # Fedora/RHEL

xvfb-run npm test
```

### デバッグ時にブレークポイントが効かない

`tsconfig.json` の `sourceMap` が `true` になっていることを確認してください（デフォルトで有効です）。また、`out/` 内のファイルが最新であることを確認するため、`npm run compile` を再実行してください。
