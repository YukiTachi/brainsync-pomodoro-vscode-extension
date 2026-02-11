# BrainSync Focus Timer

エンジニアの脳疲労を科学するポモドーロタイマー

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/donut-service.brainsync-focus-timer)](https://marketplace.visualstudio.com/items?itemName=donut-service.brainsync-focus-timer)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/donut-service.brainsync-focus-timer)](https://marketplace.visualstudio.com/items?itemName=donut-service.brainsync-focus-timer)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/donut-service.brainsync-focus-timer)](https://marketplace.visualstudio.com/items?itemName=donut-service.brainsync-focus-timer)

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

## プライバシーポリシー

この拡張機能は以下のデータを取り扱います：

**ローカル保存データ:**
- タイマーセッション記録（開始時刻、終了時刻、完了/中断状態）
- 統計データ（日次・週次の集計）
- 設定情報

すべてのデータはVS CodeのGlobal Stateに保存され、お使いのコンピューター内に留まります。

**外部送信データ:**
- 診断ページへのリンクを開く際、UTMパラメータ（利用元の情報）を付与します
- 個人を特定する情報は一切送信しません
- セッションデータや統計データは送信しません

## セキュリティ

- Webview内で実行されるスクリプトはContent Security Policy (CSP)で保護
- 外部スクリプトの読み込みは一切行いません
- すべてのデータはローカルに保存され、外部サーバーへの送信は行いません

## インストール

### VS Code / Cursor共通

#### 方法1: マーケットプレイスから

1. 拡張機能マーケットプレイスで「BrainSync」を検索
2. インストールボタンをクリック
3. VS Code / Cursorを再起動

#### 方法2: コマンドラインから

```bash
# VS Code
code --install-extension donut-service.brainsync-focus-timer

# Cursor
cursor --install-extension donut-service.brainsync-focus-timer
```

## 使い方

### 基本操作

1. **タイマー開始**: ステータスバーの 🧠 アイコンをクリック
2. **集中作業**: 30分間作業に集中
3. **休憩**: 通知が来たら5分休憩
4. **統計確認**: コマンドパレット > 「BrainSync: 統計を表示」

### コマンド一覧

- `BrainSync: タイマー開始` - タイマーを開始
- `BrainSync: タイマー一時停止/再開` - 一時停止または再開
- `BrainSync: タイマーリセット` - タイマーをリセット
- `BrainSync: 休憩をスキップ` - 休憩をスキップして作業開始
- `BrainSync: 統計を表示` - 統計画面を開く
- `BrainSync: 脳疲労診断を受ける` - 診断ページを開く
- `BrainSync: データをエクスポート` - CSV形式でデータを保存
- `BrainSync: 統計をリセット` - 統計データをクリア
- `BrainSync: 設定` - 設定画面を開く

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

### カスタマイズ

設定 > Extensions > BrainSync から以下をカスタマイズ可能:

- 作業時間（15-60分）
- 短い休憩時間（3-10分）
- 長い休憩時間（10-30分）
- 長い休憩までのセット数（2-8セット）
- 通知のオン/オフ
- サウンドのオン/オフと音量
- 脳疲労アラート閾値

## 脳疲労スコアとは

作業時間と休憩パターンから、脳の疲労度を0-45点で推定します。

- 🟢 **0-10点**: 良好
- 🟡 **11-20点**: やや注意
- 🟠 **21-30点**: 警戒（休息を推奨）
- 🔴 **31-45点**: 危険（即座に休息が必要）

詳しい診断は [BrainSync脳疲労診断](https://donut-service.com/brain-fatigue-assessment/) で受けられます。

## トラブルシューティング

### 通知が表示されない

VS Code / Cursorの通知設定を確認してください。拡張機能の設定で `brainsync.notificationEnabled` が有効になっているか確認してください。

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
- Email: info@donut-service.com

## リンク

- [BrainSync公式サイト](https://donut-service.com)
- [脳疲労診断ページ](https://donut-service.com/brain-fatigue-assessment/)
- [GitHub リポジトリ](https://github.com/YukiTachi/brainsync-pomodoro-vscode-extension)
- [変更履歴](CHANGELOG.md)

---

**Enjoy your focused work! 🧠✨**
