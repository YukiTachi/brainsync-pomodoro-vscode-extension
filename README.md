# BrainSync Focus Timer

エンジニアの脳疲労を科学するポモドーロタイマー

[![Open VSX Version](https://img.shields.io/open-vsx/v/donut-service/brainsync-focus-timer)](https://open-vsx.org/extension/donut-service/brainsync-focus-timer)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/donut-service/brainsync-focus-timer)](https://open-vsx.org/extension/donut-service/brainsync-focus-timer)
[![Open VSX Rating](https://img.shields.io/open-vsx/rating/donut-service/brainsync-focus-timer)](https://open-vsx.org/extension/donut-service/brainsync-focus-timer)

## 対応エディタ

✅ **Visual Studio Code** (1.80.0以降)
✅ **Cursor** (VS Codeベース)

BrainSync Focus Timerは、VS Code互換のすべてのエディタで動作します。

## 特徴

- 🧠 **30分集中 + 5分休憩**（カスタマイズ可能：15-60分）
- 📊 **脳疲労スコアの自動推定**（作業量から算出）
- 📈 **詳細な統計とレポート**（日次・週次）
- 🔗 **BrainSync脳疲労診断との連携**
- ⚡ **軽量・高速**（バックグラウンド動作）

<!-- スクリーンショット: 拡張機能の全体像がわかる画像を配置してください -->
<!-- ![BrainSync Focus Timer の概要](images/screenshots/overview.png) -->

## 使い方

### 基本操作

1. **タイマー開始**: ステータスバーの 🧠 アイコンをクリックしてメニューを開き、タイマーを開始
2. **集中作業**: 30分間作業に集中
3. **休憩**: 通知が来たら5分休憩
4. **統計確認**: コマンドパレット > 「BrainSync: 統計を表示」

<!-- スクリーンショット: ステータスバーのタイマー表示 -->
<!-- ![ステータスバー](images/screenshots/statusbar.png) -->

### タイマーサイクル

```
🧠 作業 (30分) → ☕ 短い休憩 (5分) → 🧠 作業 → ☕ 休憩 → 🧠 作業 → ☕ 休憩 → 🧠 作業 → 🌿 長い休憩 (15分)
```

4セッション完了ごとに長い休憩が入ります。

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `BrainSync: タイマー開始` | タイマーを開始 |
| `BrainSync: タイマー一時停止/再開` | 一時停止または再開 |
| `BrainSync: タイマーリセット` | タイマーをリセット |
| `BrainSync: 休憩をスキップ` | 休憩をスキップして作業開始 |
| `BrainSync: 統計を表示` | 統計画面を開く |
| `BrainSync: 脳疲労診断を受ける` | 診断ページを開く |
| `BrainSync: データをエクスポート` | CSV形式でデータを保存 |
| `BrainSync: 統計をリセット` | 統計データをクリア |
| `BrainSync: 通知抑制を解除` | 作業中の通知抑制（Do Not Disturb）を手動で解除 |
| `BrainSync: Slack連携を設定` | Slack トークンを登録して連携を有効化 |
| `BrainSync: Slack連携を解除` | Slack 連携を解除しトークンを削除 |
| `BrainSync: 設定` | 設定画面を開く |

### キーボードショートカット（推奨設定）

デフォルトでは未設定ですが、以下の設定を推奨します：

```json
{
  "command": "brainsync.startTimer",
  "key": "ctrl+alt+s",
  "mac": "cmd+alt+s"
},
{
  "command": "brainsync.pauseTimer",
  "key": "ctrl+alt+p",
  "mac": "cmd+alt+p"
},
{
  "command": "brainsync.viewStats",
  "key": "ctrl+alt+t",
  "mac": "cmd+alt+t"
}
```

## 脳疲労スコアとは

作業時間と休憩パターンから、脳の疲労度を0-45点で推定します。

| スコア | レベル | 目安 |
|--------|--------|------|
| 🟢 0-10点 | 良好 | そのまま作業を続けてOK |
| 🟡 11-20点 | やや注意 | 疲労に気をつけましょう |
| 🟠 21-30点 | 警戒 | 休息を推奨します |
| 🔴 31-45点 | 危険 | すぐに休憩してください |

<!-- スクリーンショット: 統計画面と脳疲労スコア -->
<!-- ![統計画面](images/screenshots/stats.png) -->

詳しい診断は [BrainSync脳疲労診断](https://donut-service.com/brain-fatigue-assessment/) で受けられます。

## カスタマイズ

設定 > Extensions > BrainSync から以下をカスタマイズ可能:

| 設定項目 | デフォルト | 範囲 |
|---------|-----------|------|
| 作業時間 | 30分 | 15-60分 |
| 短い休憩時間 | 5分 | 3-10分 |
| 長い休憩時間 | 15分 | 10-30分 |
| 長い休憩までのセット数 | 4セット | 2-8セット |
| 通知 | ON | ON/OFF |
| サウンド | ON (bell) | bell/chime/silent |
| 音量 | 50% | 0-100% |
| 自動休憩開始 | ON | ON/OFF |
| 自動作業開始 | OFF | ON/OFF |
| 脳疲労アラート | ON | ON/OFF |
| 脳疲労アラート閾値 | 21点 | 15-30点 |
| 作業中の通知抑制 (Do Not Disturb) | OFF | ON/OFF |
| Slack連携 | OFF | ON/OFF |
| Slackステータス自動設定 | ON | ON/OFF |
| Slackステータス文言 | 集中中 | 任意の文字列 |
| Slackステータス絵文字 | :tomato: | 絵文字コード |

> **作業中の通知抑制 (Do Not Disturb)**: ON にすると、作業セッション中だけ VS Code の通知（他拡張のトースト等）を自動で抑制し、休憩・終了時に自動で解除します。OS非依存・セットアップ不要で動作します。
> 通知抑制中はステータスバー右側のベルアイコンが bell-slash 表示になります。何らかの理由で抑制が残った場合は、コマンド `BrainSync: 通知抑制を解除` で手動解除できます。

## Slack連携（任意）

作業セッション中だけ Slack を自動で「集中モード」にします。通知を一時停止（Do Not Disturb）し、任意でステータスを「🍅 集中中」に設定。休憩・終了時に自動解除します。OS非依存で動作します。

### セットアップ

事前に Slack のトークンを取得して設定する必要があります。

1. [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**（対象ワークスペースを選択）
2. **OAuth & Permissions** → **User Token Scopes** に次の2つを追加（Bot ではなく **User** 側）:
   - `dnd:write`（通知の一時停止）
   - `users.profile:write`（ステータス設定）
3. **Install to Workspace** → 発行された **User OAuth Token（`xoxp-...`）** をコピー
4. VS Code / Cursor で コマンド `BrainSync: Slack連携を設定` を実行し、トークンを貼り付け
5. 設定で **Slack連携** を ON にする

### 動作

- 作業開始 → Slack の通知が一時停止（DND）＋ ステータス「🍅 集中中」を自動設定
- 終了時刻（〜HH:MM）は Slack が自動で表示します（ステータス文言に時刻は含まれません）
- 休憩・一時停止・終了 → 自動で解除
- 解除したいときは コマンド `BrainSync: Slack連携を解除`

### 連携の解除と再連携

トークンは一度設定すればキーチェーンに保管され、**再起動しても保持されます**（通常は入れ直し不要）。

ただし **`BrainSync: Slack連携を解除` を実行するとトークンはキーチェーンから削除されます**。そのため、一度解除したあとに再び連携するには、**もう一度 `BrainSync: Slack連携を設定` からトークンを設定し直す必要があります**。

- 再連携には、同じ User OAuth Token（`xoxp-...`）をそのまま使えます（解除は拡張からトークンを消すだけで、Slack 側のアプリは有効なままです）。
- トークンを控えていない場合は、[api.slack.com/apps](https://api.slack.com/apps) → 対象アプリ → **OAuth & Permissions** から再取得できます。
- トークンが無効・失効した場合は、拡張が自動で連携を無効化して通知するので、その後同じ手順で再設定してください。

### プライバシー

- **トークンは VS Code の SecretStorage（OSキーチェーン）に安全に保管**され、設定ファイルには保存されません。他マシンにも同期されません。
- 送信先は Slack API（`https://slack.com`）のみで、送信するのは「通知停止時間・ステータス文言・トークン」だけです。**セッション統計や作業内容は一切送信しません**。
- Slack連携を無効にしている場合は、従来どおり完全にローカルで動作します。

## インストール

### マーケットプレイスから（推奨）

1. VS Code / Cursor の拡張機能マーケットプレイスで「**BrainSync**」を検索
2. インストールボタンをクリック

### コマンドラインから

```bash
# VS Code
code --install-extension donut-service.brainsync-focus-timer

# Cursor
cursor --install-extension donut-service.brainsync-focus-timer
```

## プライバシーポリシー

**ローカル保存データ:**
- タイマーセッション記録（開始時刻、終了時刻、完了/中断状態）
- 統計データ（日次・週次の集計）
- 設定情報
- Slackトークン（Slack連携を使う場合のみ、SecretStorage = OSキーチェーンに保管）

タイマー・統計・設定はVS CodeのGlobal Stateに保存され、お使いのコンピューター内に留まります。Slackトークンは平文の設定ファイルには保存されず、他マシンにも同期されません。

**外部送信データ:**
- 診断ページへのリンクを開く際、UTMパラメータ（利用元の情報）を付与します
- **Slack連携を有効にした場合のみ**、Slack API（`https://slack.com`）へ「通知停止時間・ステータス文言・トークン」を送信します
- 個人を特定する情報は一切送信しません
- セッションデータや統計データは送信しません（Slackにも送りません）

## セキュリティ

- Webview内で実行されるスクリプトはContent Security Policy (CSP)で保護
- 外部スクリプトの読み込みは一切行いません
- すべてのデータはローカルに保存され、外部サーバーへの送信は行いません

## トラブルシューティング

### 通知が表示されない

- 拡張機能の設定で `brainsync.notificationEnabled` が有効になっているか確認してください
- VS Code / Cursorの「応答不可モード」（Do Not Disturb）が有効になっている場合、通知がブロックされることがあります。設定 > 通知 > 「応答不可モードを有効にする」の拡張機能一覧で、**BrainSync Focus Timer にチェックが入っていない**ことを確認してください（チェックが入っていると通知がブロックされます）

### タイマーがリセットされる

ウィンドウを閉じてもタイマーは継続しますが、完全終了すると状態がリセットされる場合があります。VS Code再起動時には自動的に復元されます。

### サウンドが再生されない

- 拡張機能の設定で `brainsync.soundEnabled` が有効か確認
- `brainsync.soundVolume` が0になっていないか確認
- `brainsync.soundFile` が `silent` に設定されていないか確認

### 統計データが消えた

データはGlobal Stateに保存されています。拡張機能を削除すると消えます。定期的なエクスポートをお勧めします。

## 貢献

バグ報告や機能リクエストは [GitHub Issues](https://github.com/YukiTachi/brainsync-pomodoro-vscode-extension/issues) へお願いします。

プルリクエストも歓迎します！

## ライセンス

MIT License - 詳細は [LICENSE](LICENSE) を参照

## 作者

**Donut Service**
- Website: https://donut-service.com
- Email: contact@donut-service.com

## リンク

- [BrainSync公式サイト](https://donut-service.com)
- [脳疲労診断ページ](https://donut-service.com/brain-fatigue-assessment/)
- [GitHub リポジトリ](https://github.com/YukiTachi/brainsync-pomodoro-vscode-extension)
- [変更履歴](CHANGELOG.md)
