# 実装計画書: マーケットプレースの多言語化（英語対応）

- **対象機能**: マーケットプレース（VS Code Marketplace / Open VSX）のページ・検索を英語化し、エディタ内の表示（コマンド名・設定名・説明）を VS Code の表示言語に追従させる
- **作成日**: 2026-08-23
- **ステータス**: 計画（未着手）
- **Notion**: 優先度 高 / 💅 仕上げ / 工数 中
- **後続タスク**: [[runtime-l10n-plan]]「実行時文字列の l10n 化（`vscode.l10n.t`）」— 通知文言・統計 WebView など **ソースコード内の文字列**は本計画の**対象外**（§10）

---

## 1. 概要

現状は README・`package.json` の表示文字列がすべて日本語のため、英語圏ユーザーには**検索で見つかりにくく、見つかっても内容が伝わらない**。DL が 1.9k を超えて伸びている今、英語圏へのリーチは費用対効果が高い。

VS Code 標準の **`package.nls.json` 方式**でマニフェスト文字列を言語別に出し分け、**README を英語主体（＋日本語版を別ファイル）**にする。

| 対象 | 現状 | 目標 |
|---|---|---|
| マーケットプレースのページ・検索（displayName / description / README） | 日本語 | **英語** |
| エディタ内のコマンド名・設定名・設定説明 | 日本語固定 | **表示言語に追従**（英語既定・日本語あり） |
| 通知・統計 WebView などの実行時文字列 | 日本語固定 | **変更なし**（後続タスク） |

---

## 2. 背景と技術的制約（★最重要）

| # | 事実 | 設計への影響 |
|---|------|------|
| N1 | `package.nls.json` が**既定＝英語**、`package.nls.<locale>.json`（例 `package.nls.ja.json`）が各言語。`package.json` 側は `%key%` で参照。 | 英語を既定ファイルに置く。日本語は `ja` ファイルへ |
| N2 | VS Code は表示言語（`vscode.env.language`、日本語は `ja`）に一致する nls を読み、無ければ `package.nls.json` に**フォールバック** | 英語既定なので、未対応言語のユーザーには英語が出る（安全） |
| N3 | **vsce の `patchNLS()` がパッケージ時に `%key%` を `package.nls.json` で解決し `extension.vsixmanifest` に書く** → VS Code Marketplace は英語を表示。置換は VS Code / vsce とも **値全体一致（`^%([\w\d.-]+)%$`）** でのみ行われるため、`サウンド音量（%）` のように**値の途中に `%` を含んでも誤置換されない** | 「`%displayName%` が生で出る」事故は**解決漏れ（キー不一致）**でのみ起こる → §8 でキー整合テストを必須化 |
| N3' | vsce がパッチするのは **`extension.vsixmanifest` のみ**。vsix 内の `extension/package.json` は `%key%` のまま残る。**Open VSX は vsix 内の `package.json` を読み、同梱の `package.nls.json` で `%key%` を自前解決**する | 両マーケットプレースに英語が出る根拠は「**`package.nls.json` が vsix に同梱されること**」。同梱確認を §9 ステップ 7 の**必須条件**とする |
| N4 | 表示言語に追従するのは **マニフェスト由来の文字列のみ**（displayName / description / commands[].title / configuration.title / properties[].description 等）。**`keywords` / `categories` / 設定の `default` 値 は localize 不可** | keywords は英日を併記して両言語の検索に効かせる。`default` 値（§3-1 の `slackStatusText`）は別途判断。実行時文字列は別仕組み（`vscode.l10n`、後続） |
| N5 | マーケットプレースが表示する README は **`README.md` のみ**（`README.ja.md` 等は表示されない）。README 内の相対リンク（`README.ja.md`）は vsce が `repository.url` を元に **GitHub の絶対 URL に書き換える**ため、Marketplace 上でも機能する（本リポジトリは `repository` 設定済み） | 英語をマーケットプレースに出すには **`README.md` を英語にする必要がある**。日本語は `README.ja.md` に分離し相互リンク |

### 制約から導く設計方針

- **N1/N2**: `package.nls.json`（en）と `package.nls.ja.json`（ja）の2ファイル。既定を英語にすることで未対応言語にも英語が出る。
- **N3**: `%key%` と nls キーの**1対1整合をユニットテストで機械的に保証**する（両ファイルに全キーがあり、余分もない）。これが本計画で唯一「壊れると目に見えて恥ずかしい」箇所。
- **N4**: `keywords` は現在の英日混在を維持し、英語キーワードを補強。
- **N5**: `README.md` を英語化し、日本語は `README.ja.md` へ移動。**内容は同一構成**を保ち、先頭で相互リンク。

---

## 3. 機能仕様

### 3-1. 英語化する対象（`package.json`）

| 項目 | 件数 | 例 |
|---|---|---|
| `description` | 1 | 「エンジニアの脳疲労を科学するポモドーロタイマー…」→ 英語 |
| `contributes.commands[].title` | 12 | `BrainSync: タイマー開始` → `BrainSync: Start Timer` |
| `contributes.configuration.properties[].description` | 17 | `作業時間（分）` → `Work duration (minutes)` |

**そのまま（localize しない）**:
- `displayName` = `BrainSync Focus Timer`、`configuration.title` = `BrainSync Focus Timer`（ブランド名・既に英語。キー化してもよいが変更点を減らすため文字列のまま）
- `name` / `publisher` / `categories` / `keywords`（仕様上 localize 不可。keywords は英語を追加）
- `soundFile` の `enum` 値（`bell`/`chime`/`silent`、識別子）
- **`brainsync.slackStatusText` の `default` = `"集中中"`（★要判断・据え置き）**
  - 設定の `default` 値は nls で localize **できない**（N4）。さらに `src/slack/slackManager.ts:97` のフォールバック `'集中中'` も同じ値。
  - **判断: (b) 据え置き**。理由: (a) 英語既定に変えると **未カスタマイズの既存日本語ユーザーの Slack 表示が変わる**うえ、`slackManager.ts` のフォールバック変更が「`src/**` 無変更」の原則と衝突する。据え置けば既存ユーザーの挙動は不変で、後続の実行時 l10n タスクで通知文言と一緒に扱うのが自然。
  - 対応: 英語 README の Slack セクションに「ステータス文言は `brainsync.slackStatusText` で変更できる（既定は日本語の「集中中」）」と案内し、後続タスク（§10）の入力に載せる。

### 3-2. README

- **`README.md` → 英語**（マーケットプレース表示・N5）
- **`README.ja.md` → 現在の日本語 README を移動**
- 両ファイル先頭に言語切替リンク：`[English](README.md) | [日本語](README.ja.md)`
- 見出し構成・セクション順は両言語で**同一**にし、今後の更新で片方だけ古くなるのを防ぐ（§7）

### 3-3. keywords の補強（検索露出）

現在: `pomodoro, timer, productivity, focus, brainsync, brain health, cognitive wellness, 時間管理, 脳疲労, 集中力`
追加候補（英語）: `brain fatigue`, `burnout`, `wellness`, `deep work`, `break reminder`
→ 英日併記を維持（日本語検索にも引き続き効く）。追加後は **15 件**で、vsce の上限 **30 件**に対して余裕あり。

---

## 4. 設計

### 4-1. nls キー命名規則

`package.json` の構造に沿った階層名で、対応関係が一目で分かるようにする。

```
description
command.startTimer          command.pauseTimer        command.resetTimer
command.skipBreak           command.viewStats         command.openDiagnosis
command.exportData          command.resetStats        command.settings
command.disableDnd          command.connectSlack      command.disconnectSlack
config.workDuration         config.shortBreak         config.longBreak
config.longBreakInterval    config.autoStartBreak     config.autoStartWork
config.soundEnabled         config.notificationEnabled config.soundVolume
config.soundFile            config.fatigueAlertEnabled config.fatigueAlertThreshold
config.focusDoNotDisturb    config.slackIntegration   config.slackSetStatus
config.slackStatusText      config.slackStatusEmoji
```

`package.json` 側の書き換え例：

```jsonc
"description": "%description%",
"contributes": {
  "commands": [
    { "command": "brainsync.startTimer", "title": "%command.startTimer%" }
  ],
  "configuration": {
    "properties": {
      "brainsync.workDuration": { "type": "number", "default": 30, "description": "%config.workDuration%" }
    }
  }
}
```

### 4-2. `package.nls.json`（英語・既定）— 抜粋

```json
{
  "description": "A Pomodoro timer for engineers that estimates brain fatigue — 30-minute focus sessions, statistics, and fatigue insights",
  "command.startTimer": "BrainSync: Start Timer",
  "command.pauseTimer": "BrainSync: Pause/Resume Timer",
  "command.resetTimer": "BrainSync: Reset Timer",
  "command.skipBreak": "BrainSync: Skip Break",
  "command.viewStats": "BrainSync: Show Statistics",
  "command.openDiagnosis": "BrainSync: Take Brain Fatigue Assessment",
  "command.exportData": "BrainSync: Export Data",
  "command.resetStats": "BrainSync: Reset Statistics",
  "command.settings": "BrainSync: Settings",
  "command.disableDnd": "BrainSync: Disable Do Not Disturb",
  "command.connectSlack": "BrainSync: Connect Slack",
  "command.disconnectSlack": "BrainSync: Disconnect Slack",
  "config.workDuration": "Work duration (minutes)",
  "config.focusDoNotDisturb": "Automatically suppress VS Code notifications (toasts from other extensions, etc.) during work sessions (Do Not Disturb). Turned off automatically on break or finish.",
  "config.slackIntegration": "Put Slack into focus mode (snooze notifications) during work sessions. Turned off automatically on break or finish. Set your token first with \"BrainSync: Connect Slack\"."
}
```

`package.nls.ja.json` は現在の日本語文字列を**そのまま**同じキーで格納する（翻訳作業は英語側のみ）。

> **注意（設定 description 内の相互参照）**: `config.slackIntegration` の説明は「BrainSync: Slack連携を設定」というコマンド名を本文中で参照している。英語版では英語のコマンド名 `"BrainSync: Connect Slack"` に揃える。**片方だけ直すとズレる**ので、この種の「本文中のコマンド名参照」は §8 のレビュー観点に入れる。

### 4-3. README の構成方針

- `README.md`（英語）は現在の日本語 README（248行・**H2 が 14、見出し総数 28**）を**同一構成で翻訳**する。見出し（H2 → H3）：
  - Supported editors / Features
  - Usage（Basic operation / Timer cycle / Commands / Recommended keybindings）
  - Brain fatigue score / Customization
  - Slack integration（Setup / Behavior / Disconnect & reconnect / Privacy）
  - Installation（From the marketplace / From the command line）
  - Privacy policy / Security
  - Troubleshooting（Notifications not shown / Timer gets reset / Sound not playing / Statistics disappeared）
  - Contributing / License / Author / Links
- コマンド一覧・設定表の**表示名は英語 nls と一致させる**（README に書く名前と、実際にコマンドパレットに出る名前が同じであること）
- 日本語 README は `README.ja.md` へ**そのまま移動**（内容変更なし）＋先頭リンク追加

---

## 5. 既存コードへの統合ポイント

| ファイル | 変更 |
|---|---|
| `package.json` | 上記 30 箇所（description 1 + commands 12 + config 17）を `%key%` に置換。`keywords` に英語を追加 |
| `package.nls.json`（新規） | 英語文字列（既定） |
| `package.nls.ja.json`（新規） | 日本語文字列（現在の値を移植） |
| `README.md` | 英語に全面差し替え |
| `README.ja.md`（新規） | 現在の `README.md` を移動 |
| `.vscodeignore` | **変更不要**（root の `package.nls*.json` を除外するルールは無い＝**nls は必ず同梱される。これが Open VSX で英語が出る前提**、N3'）。`README.ja.md` も同梱されるが数 KB で無害。除外したければ `README.ja.md` を 1 行追加すればよい（任意） |
| `test/unit/nls.test.ts`（新規） | キー整合テスト（§8） |
| `docs/TESTING.md` | 表示言語切替の手動確認手順を追記 |
| `CHANGELOG.md` | `[Unreleased]` に **Added**（英語 README・`package.nls`）と **Changed**（コマンド名・設定説明が表示言語に追従するようになる＝既存ユーザーから見た挙動変更）を併記 |

**ソースコード（`src/**`）は一切変更しない**。実行時文字列は後続タスク。

---

## 6. 検証方法（★N3 の「生表示」事故を確実に潰す）

1. **キー整合（自動）**: §8 のユニットテスト。
2. **vsixmanifest の解決確認（パッケージ後・必須）**: `npx @vscode/vsce package` 後に vsix を展開し、`extension.vsixmanifest` の `DisplayName` / `Description` に **`%` が残っていない**こと、英語が入っていることを確認。
   ```bash
   unzip -p brainsync-focus-timer-*.vsix extension.vsixmanifest | grep -E 'DisplayName|Description'
   ```
   ここが英語なら **VS Code Marketplace** に英語が出る（Marketplace はこの vsixmanifest を読む）。
   **Open VSX は経路が異なる**（N3'）: vsix 内の `extension/package.json` は `%key%` のまま残り、Open VSX が同梱の `package.nls.json` で自前解決する。したがって Open VSX 向けの必須条件は「**`package.nls.json` が vsix に同梱されていること**」。あわせて確認：
   ```bash
   unzip -l brainsync-focus-timer-*.vsix | grep -E 'package\.nls'
   ```
   `extension/package.nls.json` と `extension/package.nls.ja.json` の 2 ファイルが出れば OK。
3. **エディタ内の言語追従（手動）**: ローカル vsix をインストールし、
   - 表示言語 **English**（`Configure Display Language`）→ コマンドパレット・設定画面が英語
   - 表示言語 **日本語** → 従来どおり日本語
   - 設定項目数が **17 のまま**（増減していない）
4. **公開後のスポットチェック**: Open VSX / VS Code Marketplace のページで displayName・description・README が英語で出ていることを目視確認（Open VSX は取り込み経路が別なので念のため）。

---

## 7. エッジケース / リスクと対策

| 項目 | 内容 | 対策 |
|---|---|---|
| **nls キー不一致で `%key%` が生表示** | 最も目立つ事故（マーケットプレース・コマンドパレットに `%command.startTimer%` と出る） | §8 のキー整合テストで **CI で機械的に検出**。加えて §6-2 の vsixmanifest 目視 |
| README の二重管理で片方が古くなる | 今後の機能追加で英語だけ／日本語だけ更新される | 両ファイルの**見出し構成を同一**にし、PR テンプレ／CONTRIBUTING に「README は両言語更新」を明記。§8 に見出し一致テストを追加（任意） |
| 両言語 README の**内容差の許容範囲**が曖昧 | §3-1 で英語版にのみ `slackStatusText` の案内を足すため、初回から 1 文分の差が生まれる。「差があるのはバグか」で迷う | **方針を明文化**：「**見出し構成は同一**（機械的に検証）、**本文は言語圏固有の補足を許容**する」。英語版の `slackStatusText` 案内はその許容例（日本語ユーザーには不要な補足）。見出し一致テストは構成のみを見るので本文差は検出対象外＝意図どおり |
| 設定説明内のコマンド名参照のズレ | `config.slackIntegration` 等が本文中でコマンド名を引用 | 英語側は英語コマンド名に揃える。レビュー観点に追加（§4-2 注意） |
| エディタ内が**混在言語**になる中間状態 | コマンド・設定は英語、通知やWebViewは日本語のまま（実行時文字列は後続） | 意図した中間状態として **CHANGELOG / README に明記**。後続タスクで解消。特に目立つ箇所を §10 に列挙して引き継ぐ |
| **`slackStatusText` の既定値「集中中」が英語 UI でも Slack に出る** | `default` は localize 不可（N4）。英語ユーザーが Slack 連携を有効にした瞬間、Slack ステータスに日本語が出る | **(b) 据え置き**（§3-1 の判断）。英語 README で `brainsync.slackStatusText` による変更方法を案内し、後続タスクで通知文言と一緒に扱う |
| 日本語ユーザーがマーケットプレースで英語を見る | Web のマーケットプレースページは英語のみ | README 先頭の `日本語` リンクで `README.ja.md` へ誘導（GitHub 上で読める） |
| keywords の日本語を消して日本語検索が弱くなる | — | **消さない**。英日併記を維持（N4） |
| `displayName` をキー化しなかったことによる将来の翻訳漏れ | ブランド名は翻訳しない前提 | 翻訳不要と明記。必要になればキー化は1行で可能 |

---

## 8. テスト計画

### ユニットテスト（`test/unit/nls.test.ts`、標準の runUnitTest で実行可）

**キー抽出の方法（★正規表現の生テキスト適用は不可）**: `package.json` を **JSON として再帰走査**し、**文字列値が値全体で `^%([\w\d.-]+)%$` に一致するものだけ**をキーとして扱う。VS Code / vsce の置換もこの anchored マッチなので、`サウンド音量（%）` のように値の途中に `%` を含む文字列は**キーではなく普通の値**として正しく無視される（生テキストに非 anchored 正規表現を当てると誤検出・取りこぼしの余地がある）。

検証項目：

- **完全性**: 抽出した全キーが `package.nls.json` と `package.nls.ja.json` の**両方**に存在する
- **余分なし**: 各 nls ファイルに `package.json` から参照されていないキーが無い
- **空値なし**: 両ファイルの全値が空文字でない
- **同一キー集合**: `package.nls.json` と `package.nls.ja.json` のキー集合が一致する
- **英語側に日本語が残っていない**: `package.nls.json` の全値に次の正規表現が**マッチしない**。ja ファイルは現在値のコピーなので、**en へのコピペ漏れ**が最も起きやすい事故であり、これを安価に検出できる
  ```ts
  // 文字リテラルではなく \u エスケープで書く（レビューで範囲が読め、エディタの正規化で壊れない）
  const JA = /[\u3000-\u303F\u3040-\u30FF\u4E00-\u9FAF\uFF00-\uFFEF]/;
  //          ^全角記号「」、。 ^ひらがな・カタカナ ^漢字        ^全角英数・括弧（）：！
  ```
  全角記号 `\u3000-\u303F` と全角英数・括弧 `\uFF00-\uFFEF` も含めることで、`サウンド音量（%）` の**全角括弧だけ残る**ようなコピペ漏れも拾える
- （任意）**README 見出し一致**: `README.md` と `README.ja.md` の `##`/`###` 見出しの**数と階層**が一致する（翻訳で見出しは変わるので個数・階層のみ）

> これは vscode モック不要の純 Node テストで、既存の `test/unit/` 基盤にそのまま乗る。
> **パス注意**: コンパイル後は `out/test/unit/nls.test.js` から実行されるため、`package.json` は `path.resolve(__dirname, '../../../package.json')` で参照する（`__dirname` 基準で 3 階層上がリポジトリ root）。

### 手動テスト（`docs/TESTING.md` 追記）

1. `npx @vscode/vsce package` → `extension.vsixmanifest` に `%` が残らず英語が入っている（§6-2）
2. vsix をインストール → 表示言語 English でコマンドパレット・設定が英語、日本語で日本語
3. 設定項目数が 17 のまま
4. `Cmd+Shift+P` で `BrainSync: Start Timer` が検索できる（英語コマンド名で到達可能）
5. 公開後、Marketplace / Open VSX のページが英語（§6-4）

---

## 9. 実装ステップ

1. `package.nls.json` / `package.nls.ja.json` を作成（§4-1 のキー、ja は現在値を移植、en は翻訳）
2. `package.json` の 30 箇所を `%key%` に置換、`keywords` に英語を追加
3. `test/unit/nls.test.ts` を追加 → `npm run test:unit` でキー整合を確認
4. `README.md` → `README.ja.md` に移動、先頭に言語リンク追加
5. 新しい `README.md`（英語）を作成（構成同一・コマンド名は nls と一致）
6. `docs/TESTING.md` / `CHANGELOG.md` 更新
7. `npx @vscode/vsce package` → **vsixmanifest の `%` 残り確認**（VS Code Marketplace 向け、§6-2）＋ **nls 2 ファイルの同梱確認（Open VSX 向けの必須条件**、N3'）。どちらか一方でも欠けたら公開しない
8. ローカル vsix で表示言語切替の手動確認（§6-3）
9. PR → マージ → バージョンバンプ（`0.1.6`）→ 公開 → §6-4 スポットチェック

---

## 10. スコープ外（後続・別タスク）

- **実行時文字列の l10n 化**（通知メッセージ・統計 WebView・クイックピック等 `src/**` の文字列を `vscode.l10n.t` + `l10n/bundle.l10n.*.json` へ）— Notion の後続タスク。本計画完了後に着手。**本計画から引き継ぐ入力**（英語 UI で特に目立つ箇所）：
  - `src/slack/slackManager.ts:146` — 恒久エラー通知のアクションボタン `'Slack連携を設定'`。英語 UI ではコマンド名 `Connect Slack` と並んで**日本語ボタン**が出る（コマンド名を本文中で引用している src 側文字列の代表例）
  - `src/slack/slackManager.ts:97` — `slackStatusText` のフォールバック `'集中中'`（§3-1 の据え置き判断とセットで扱う）
  - `brainsync.slackStatusText` の `default = "集中中"`（`package.json`。`default` は nls 不可なので後続で英語既定化を再検討）
  - `src/extension.ts` のクイックピック項目（`タイマー開始` / `一時停止` 等）と各種 `showInformationMessage` の文言
  - **★地雷: `src/extension.ts:313–323` — クイックピックの分岐が日本語ラベルの部分一致（`label.includes('タイマー開始')` 等 6 箇所）で行われている**。後続でラベルを翻訳した瞬間に**分岐が全滅する**ため、**ラベル翻訳の前に、選択結果を `id` 等のメタデータ（`QuickPickItem` を拡張して `command` を持たせる等）で判定する形へリファクタが必要**。本計画のスコープには影響しないが、後続タスクの見積もりに必ず織り込むこと
- **CHANGELOG の英語化**（マーケットプレースの Changelog タブは日本語のまま。必要なら後続）
- 英語以外の言語（中国語等）の追加 — `package.nls.<locale>.json` を足すだけで拡張可能な構造にはなる

---

## 11. 見積もり

| 区分 | 工数感 |
|---|---|
| nls ファイル作成＋`package.json` 置換＋整合テスト | 小 |
| README 英訳（248行・H2 14 / 見出し総数 28、品質が成否を左右） | **中**（ここが本体） |
| 検証（vsixmanifest・表示言語切替・公開後確認） | 小 |

コード変更ゼロ・仕組みは VS Code 標準で低リスク。**実質的な工数は README の英訳品質**に集中する。
