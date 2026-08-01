# 実装計画書: Slack 連携（作業中の通知抑制 + ステータス自動設定）

- **対象機能**: ポモドーロの作業中だけ Slack を「集中モード」にする。通知を Snooze（DND）し、任意でステータスを「🍅 集中中」に自動設定。休憩・一時停止・終了時に解除。
- **作成日**: 2026-07-08
- **ステータス**: 計画（未着手）
- **前提**: [[focus-dnd-plan]]（VS Code 内通知抑制, 0.1.4 実装済み）の後継。OS非依存で全プラットフォームに効く。
- **スコープ外**: macOS 集中モード連携（Mac限定・別機能）

---

## 1. 概要

作業セッション中だけ、ユーザー自身の Slack を自動で静かにする：

- **DND Snooze**: 作業中は通知を停止（`dnd.setSnooze`）、休憩・終了で解除（`dnd.endSnooze`）。← 中核機能
- **ステータス自動設定**（任意）: 作業中は「🍅 集中中」を設定、終了でクリア（`users.profile.set`）。終了時刻（〜HH:MM）は `status_expiration` から **Slack クライアントが表示**（§6 参照。文言には時刻を埋めない）。

**オプトイン**（デフォルト OFF）。VS Code 内抑制と違い、ユーザーが **Slack トークンを一度設定する必要がある**ため万人向けではないが、ハマる人には刺さる。VS Code 内抑制（0.1.4）と**併用可能・独立**。

---

## 2. 背景と技術的制約（★最重要）

Focus DND（ローカル・同期・無料・状態はトグルのみ）と違い、Slack は **外部ネットワーク API** であり制約が根本的に異なる。

| # | 制約 | 出典 / 詳細 |
|---|------|------|
| S1 | **User Token（`xoxp-`）が必須**。Bot Token 不可。書き込みはユーザー本人として実行される。 | `dnd.setSnooze` / `users.profile.set` はいずれも user token 必須 |
| S2 | **必要スコープ**: `dnd:write`（Snooze 操作）+ `users.profile:write`（ステータス設定）。 | Slack scopes |
| S3 | **ネットワーク非同期・失敗し得る**。HTTP 200 でも `{ok:false, error:"..."}` を返す。恒久エラー（`invalid_auth`/`token_revoked`/`token_expired`/`account_inactive`/`missing_scope`）と一時エラー（`ratelimited`/`network_error`）を分けて処理する必要。 | Slack Web API 共通仕様 |
| S4 | **レート制限**: `users.profile.set` は**同一ユーザー 10回/分**（特別制限）。`dnd.setSnooze` は Tier2（20+/分）。 | Slack rate limits |
| S5 | **トークンは機密**。settings.json に置くと平文保存＋Settings Sync で他マシンに同期されてしまう → **VS Code SecretStorage（OSキーチェーン）に保管必須**。 | VS Code `context.secrets` |
| S6 | **Snooze は num_minutes 後に自動解除**、ステータスは `status_expiration`（Unix秒）で自動クリアできる。 | `dnd.setSnooze(num_minutes)` / profile `status_expiration` |

### 制約から導く設計方針

- **S1/S2/S5（認証）**: トークン取得はユーザーが自作 Slack App から手動コピー（§3 手順）。取得済みトークンは **SecretStorage に保存**し、設定値には**絶対に置かない**。ログにもトークンを出さない。
- **S3（失敗）**: 全 API 呼び出しで `ok` を検査。恒久エラー（`invalid_auth`/`token_revoked`/`token_expired`/`account_inactive`/`missing_scope`）は**連携を自動無効化 + 一度だけ通知**して再設定を促す（タイマー動作は止めない）。一時エラー（`ratelimited`/`network_error`）は握りつぶしてログのみ。
- **S4（レート制限）**: **状態遷移時のみ**呼ぶ（tick では呼ばない）。内部フラグ + **単一実行 + 末尾コアレス**（§4）で無駄打ちを防ぐ。`429` は `Retry-After` を尊重（基本は次遷移まで放置で十分）。
- **S6（自動解除＝安全網）**: crash 等で解除処理が走らなくても、**Snooze は num_minutes 後に自動解除**され、ステータスも `status_expiration` で自動クリアされる。→ Focus DND の「リロード依存(A1)」より**堅牢**。解除は num_minutes=残り作業時間、expiration=作業終了時刻に合わせる。

---

## 3. 機能仕様

### トークン取得（ユーザー作業・README に記載）

1. https://api.slack.com/apps → Create New App → From scratch（ワークスペース選択）
2. OAuth & Permissions → **User Token Scopes** に `dnd:write` と `users.profile:write` を追加（Bot でなく User 側）
3. Install to Workspace → **User OAuth Token（`xoxp-...`）** をコピー
4. VS Code で `BrainSync: Slack連携を設定` を実行し、トークンを貼り付け（SecretStorage に保存）

### 設定（新規, `package.json`）

| キー | 型 | 既定 | 説明 |
|------|----|----|------|
| `brainsync.slackIntegration` | boolean | `false` | 作業中に Slack を集中モードにする（DND Snooze）。要トークン設定。 |
| `brainsync.slackSetStatus` | boolean | `true` | 作業中に Slack ステータスも自動設定する |
| `brainsync.slackStatusText` | string | `集中中` | 設定するステータス文言 |
| `brainsync.slackStatusEmoji` | string | `:tomato:` | ステータス絵文字コード |

> トークンは**設定に置かない**（S5）。SecretStorage キー `brainsync.slackToken` に保存。

### コマンド（新規）

| コマンド | 動作 |
|---------|------|
| `BrainSync: Slack連携を設定` (`brainsync.connectSlack`) | `showInputBox({password:true})` でトークン入力 → `auth.test` で**トークン検証**＋レスポンスヘッダ `x-oauth-scopes` で**スコープ検証**（下記）→ OK なら SecretStorage 保存し「〇〇（ワークスペース名）として接続しました」を表示。`notifiedAuthFailure` をリセット。**保存直後に `syncForState(timer.getState(), timer.getRemainingTime())` を1回呼ぶ**（既に working 中なら即座に Snooze が効く／UX 向上） |
| `BrainSync: Slack連携を解除` (`brainsync.disconnectSlack`) | `slackActive` に関係なく**無条件で** Snooze/ステータスを解除（forceClear）→ SecretStorage からトークン削除 |

**スコープ検証（★connect時）**: `auth.test` は**トークンの有効性しか確認しない**（スコープは見ない）。Slack は Web API レスポンスヘッダ `x-oauth-scopes` に付与済みスコープを返すため、`auth.test` 応答の `headers['x-oauth-scopes']` に `dnd:write` と `users.profile:write` が含まれるか検査する。不足時は「必要な権限（dnd:write / users.profile:write）が不足しています」と表示し**保存しない**。
> 実装メモ: `x-oauth-scopes` は**カンマ区切り文字列**（例 `"dnd:write,users.profile:write,..."`）。`value.split(',').map(s => s.trim())` して集合化し、必要スコープの包含を判定する。
> フォールバック: ヘッダが取得できない環境でも、実行時に Slack が `missing_scope` エラーを返すため、それを `check()`（§7）で恒久エラーとして分類し無効化する二重防御とする。

### 挙動（タイマー状態との対応）

| 状態 | Slack |
|------|-------|
| `working` | DND Snooze（残り作業分）+ ステータス設定（有効時, expiration=作業終了） |
| `breaking` / `paused` / `idle` | endSnooze + ステータスクリア |

- `slackIntegration` OFF またはトークン未設定なら一切呼ばない。
- pause→resume は endSnooze→（resume 時）残り時間で再 Snooze。

---

## 4. 設計

### 新規モジュール構成

- `src/slack/slackClient.ts` — Slack Web API の薄いラッパー（Node `https`、依存追加なし）。テスト用に注入可能。
- `src/slack/slackManager.ts` — 状態遷移に応じた Snooze/ステータスの制御。SecretStorage 参照。

### 4-1. HTTP クライアント（依存ゼロ）

プロジェクト方針（runtime 依存なし・vsix 軽量）に合わせ `@slack/web-api` は**使わず** Node 標準 `https` で実装。

```ts
export interface SlackClient {
  call(method: string, token: string, params: Record<string, string | number>): Promise<SlackResponse>;
}
// SlackResponse = { ok: boolean; error?: string; headers?: Record<string,string>; [k: string]: unknown }
// POST https://slack.com/api/<method>, application/x-www-form-urlencoded, Bearer token
// ok:false でも reject せず結果として返す（呼び出し側が error を分類）
// レスポンスヘッダ x-oauth-scopes（付与済みスコープ一覧）を headers に載せる → connect のスコープ検証に使う（§3）
```

- タイムアウト（例 10s）を設定。ネットワーク例外は `{ok:false, error:'network_error'}` に正規化。
- **トークンはログ出力しない**。

### 4-2. SlackManager（状態同期）

Focus DND の内部フラグ方式を踏襲しつつ、**ネットワーク遅延に耐える「単一実行 + 末尾コアレス」**で競合を防ぐ（tick 連打や pause/resume 連打でも最新状態に収束）。

```ts
export class SlackManager {
  private slackActive = false;        // DND Snooze が有効か（中核の抑制状態のみ。§4-2a）
  private syncing = false;            // API 実行中フラグ（単一実行）
  private pending: { state: TimerState; remainingSec: number } | null = null;

  constructor(
    private secrets: vscode.SecretStorage,
    private client: SlackClient,
    private outputChannel: vscode.OutputChannel,
  ) {}

  // onStateChange / 設定変更 から呼ぶ。最新の要求で上書きし、実行中なら末尾に coalesce。
  async syncForState(state: TimerState, remainingSec: number): Promise<void> {
    this.pending = { state, remainingSec };
    if (this.syncing) { return; }         // 実行中：末尾 pending が処理される
    this.syncing = true;
    try {
      while (this.pending) {
        const req = this.pending; this.pending = null;
        await this.reconcile(req.state, req.remainingSec);
      }
    } finally { this.syncing = false; }
  }

  private async reconcile(state: TimerState, remainingSec: number): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('brainsync');
    const enabled = cfg.get<boolean>('slackIntegration', false);
    const token = enabled ? await this.secrets.get('brainsync.slackToken') : undefined;

    const shouldBeOn = !!token && state === 'working';
    if (shouldBeOn) {
      await this.activate(token!, remainingSec, cfg);
    } else if (this.slackActive) {
      await this.deactivate(token);         // token あれば解除 API を試行
    }
  }

  private async activate(token, remainingSec, cfg) {
    const minutes = Math.max(1, Math.ceil(remainingSec / 60));
    const r1 = await this.client.call('dnd.setSnooze', token, { num_minutes: minutes });
    // ★slackActive は「DND Snooze が有効か」= 中核の抑制状態のみを表す（§4-2a）。
    //   setSnooze 成功時だけ true。失敗時は false のまま → 次の working 遷移で再試行。
    if (!(await this.check(r1))) { return; }  // #1 恒久エラー時はここで打ち切り（profile.set しない／二重無効化を防ぐ）
    this.slackActive = true;
    // ステータスは副次。成否は slackActive に影響させない（status_expiration が保険）。
    if (cfg.get<boolean>('slackSetStatus', true)) {
      const profile = JSON.stringify({
        status_text: cfg.get('slackStatusText', '集中中'),
        status_emoji: cfg.get('slackStatusEmoji', ':tomato:'),
        status_expiration: Math.floor(Date.now()/1000) + remainingSec, // S6 自動クリア
      });
      await this.check(await this.client.call('users.profile.set', token, { profile }));
    }
  }

  private async deactivate(token?) {
    if (!token) { this.slackActive = false; return; }
    // endSnooze は成否に関わらず「解除を試みた」とみなし slackActive=false に確定する。
    // 一時的なネットワーク失敗で true のまま残すと解除が永久に走らなくなるため。
    // 未解除でも S6（num_minutes 自動解除）が最終保険。
    await this.client.call('dnd.endSnooze', token);
    const profile = JSON.stringify({ status_text: '', status_emoji: '' }); // status クリア
    await this.client.call('users.profile.set', token, { profile });
    this.slackActive = false;
  }

  // ok を検査し true/false を返す。恒久エラー（§7）は無効化処理を await して発火。
  // ★副作用（secrets.delete / config.update）が非同期のため check は async にする（#7）。
  //   これにより activate の short-circuit（#1）が「無効化完了後に打ち切る」ことを保証。
  private async check(res: SlackResponse): Promise<boolean> {
    if (res.ok) { return true; }
    if (this.isPermanentError(res.error)) { await this.handlePermanentError(res.error); }
    else { this.log(`Slack transient error: ${res.error}`); }  // network_error / ratelimited 等
    return false;
  }
  // 恒久エラー集合（§7）。token_expired も含める。
  private isPermanentError(e?: string): boolean {
    return ['invalid_auth','token_revoked','token_expired','account_inactive','missing_scope'].includes(e ?? '');
  }
  private async handlePermanentError(error?: string): Promise<void> { /* §7 の5手順 */ }

  // エスケープハッチ（disconnect / コマンド用）: slackActive に関係なく無条件で解除を試みる（§7-7）。
  async forceClear(): Promise<void> {
    const token = await this.secrets.get('brainsync.slackToken');
    await this.deactivate(token);
  }

  dispose(): void { /* ベストエフォート解除。S6 の自動解除が最終保険 */ }
}
```

#### 4-2a. `slackActive` の権威ルール（★部分成功の扱い）

複数 API（Snooze + ステータス）を跨ぐため、フラグの意味を1つに固定する：

- **`slackActive` = 「DND Snooze が有効か」だけを表す**（中核の通知抑制）。ステータスは含めない。
- **セット条件**: `dnd.setSnooze` が `ok:true` を返したときのみ `true`。失敗なら `false` のまま → 次の `working` 遷移で再試行。
- **クリア条件**: `deactivate` で `dnd.endSnooze` を**試みたら**（成否問わず）`false` に確定。一時失敗で `true` に留めると解除が二度と走らなくなるため。未解除は S6（自動解除）が保険。
- **部分成功（Snooze成功・ステータス失敗）**: `slackActive=true`。ステータス失敗はログのみで、`status_expiration` により Slack 側が自動クリアするので放置してよい。
- **ステータスの成否は `slackActive` に一切影響させない**（副次的関心）。

これにより「reconcile は `slackActive`（=Snooze の有無）だけを見て activate/deactivate を決める」という単純不変条件が保たれる。

### 4-3. Focus DND との関係（軽い共通化）

`FocusDndManager` と `SlackManager` は共に `onStateChange(state)` から駆動される「集中の副作用」。
インターフェイスを揃えると `extension.ts` の配線が単純化する：

```ts
// 両者が実装する軽いインターフェイス（過剰設計は避け、シグネチャ統一のみ）
interface FocusSink { syncForState(state: TimerState, remainingSec: number): void | Promise<void>; }
```

- v1 は `FocusDndManager.syncForState` に `remainingSec` 引数を**追加するだけ**（未使用でも可）にして統一。大きなリファクタはしない。

---

## 5. 既存コードへの統合ポイント

### 5-1. 配線（`extension.ts`）

1. `activate()` で `SlackClient`（https 実装）と `SlackManager(context.secrets, client, outputChannel)` を生成。**`timer.restore()` より前**（working 復帰時に onStateChange 経由で発火するため。[[focus-dnd-plan]] と同じ理由）。
2. `onStateChange` を拡張：

```ts
onStateChange: (state: TimerState) => {
  if (state === 'idle') { statusBar.update(0, state); }
  void focusDnd.syncForState(state);
  void slack.syncForState(state, timer.getRemainingTime());   // ← 追加
},
```

3. `onDidChangeConfiguration`: **Slack 関連キーが変わったときだけ** 再同期する（作業時間など無関係な `brainsync.*` 変更で `users.profile.set` を無駄打ちしない＝S4対策）：

```ts
const slackKeys = ['slackIntegration', 'slackSetStatus', 'slackStatusText', 'slackStatusEmoji'];
if (slackKeys.some((k) => e.affectsConfiguration(`brainsync.${k}`))) {
  void slack.syncForState(timer.getState(), timer.getRemainingTime());
}
```

> 補足（S4 さらなる緩和・任意）: 文言だけ変えた場合に毎回 `users.profile.set` を呼ぶのを避けたいなら、`activate` 側で「前回設定した status_text/emoji と同一なら profile.set をスキップ」する差分ガードを入れてもよい（v1 では遷移頻度が低いため必須ではない）。
4. `connectSlack` / `disconnectSlack` コマンド登録。
5. `dispose` に `slack.dispose()` 追加。

### 5-2. 作業完了時の解除タイミング

Focus DND は「info 通知が抑制されないよう通知前に解除」が必須だった（C3）。Slack の Snooze は **VS Code の通知には影響しない**ため、`handleWorkComplete` 先頭での同期解除は**不要**。`onStateChange(idle)` 経由の解除で十分。
> ただし「作業完了 → すぐ次に手動で作業再開」など短時間の往復では、コアレス（§4-2）により最新状態へ収束する。

---

## 6. セキュリティ / プライバシー（★重要）

- **トークン保管**: `context.secrets`（SecretStorage = OS キーチェーン）。**settings.json には保存しない**（平文 + Settings Sync 同期を回避, S5）。
- **ログ**: トークンや `auth.test` の生レスポンスをログ/OutputChannel に出さない。接続確認は「ユーザー名 / ワークスペース名」のみ表示。
- **送信先**: `https://slack.com/api/*` のみ。送信するのは Snooze 分数・ステータス文言・トークン（Bearer）だけ。セッション統計や作業内容は**一切送らない**。
- **README プライバシー節に追記**: Slack 連携を有効化した場合のみ、上記データが Slack に送信されること。無効時は完全ローカル（従来通り）。
- **最小権限**: 要求スコープは `dnd:write` + `users.profile:write` のみ（README の手順で明示）。
- **終了時刻表示の期待値**（★README注記）: ステータスに「〜HH:MM」の文字列を我々が埋め込むのではなく、`status_expiration`（Unix秒）を渡すと **Slack クライアント側の UI が終了時刻を表示する**。README では「Slack が有効期限から自動で終了時刻を表示します」と書き、文言に時刻が入ると誤解させない。設定する `slackStatusText` はあくまで「集中中」等の固定文言。

---

## 7. エッジケース / リスクと対策

| 項目 | 内容 | 対策 |
|------|------|------|
| トークン無効/失効/権限不足（`invalid_auth`/`token_revoked`/`token_expired`/`account_inactive`/`missing_scope`） | 作業のたびに失敗し続ける／再起動後も再試行し続ける | `check()` が恒久エラーを検知したら **自動無効化（下記の具体手順）** を実行し、**セッション中1回だけ**通知 |
| ネットワーク失敗・タイムアウト | 一時的に Snooze/解除できない | ログのみ、タイマーは止めない。フラグ規約は §4-2a に従う: activate 失敗時は `slackActive=false`（次 working で再試行）、**deactivate は失敗でも `slackActive=false` 確定**（解除ループ防止、未解除は S6 が保険）。次遷移で再収束 |
| レート制限 `ratelimited`（S4, pause/resume 連打） | `users.profile.set` 10回/分超過 | 状態遷移時のみ + コアレスで通常は到達しない。到達時はログのみで放置（次遷移で回復） |
| crash / 強制終了で Snooze が残る | dispose 走らない | **S6 の自動解除が保険**: Snooze は num_minutes 後に自動解除、ステータスは status_expiration で自動クリア。加えてコマンド `BrainSync: Slack連携を解除` で即時 forceClear 可能 |
| 非同期再入（遷移連打・ネットワーク遅延） | 古い状態で上書きされる | 単一実行 + 末尾コアレス（§4-2）で**常に最新要求に収束** |
| ステータスをユーザーが手動変更中 | 我々のクリアで上書き | v1 は受容（作業中のみ設定・終了でクリアという単純規約）。README に明記。`slackSetStatus:false` で status 操作を丸ごと無効化可能 |
| 既存の手動 Snooze | endSnooze が意図せず解除 | v1 は受容。連携有効時の挙動として明記 |
| `disconnectSlack` が `slackActive=false` で解除しない | crash 後は内部フラグ false でも Slack 側に Snooze が残ることがある | disconnect は **`forceClear`（`slackActive` を見ず無条件で endSnooze + status クリア）** を使う（§7-7） |

### 7-恒久エラー時の自動無効化（`check()` の具体手順）

`invalid_auth` / `token_revoked` / `token_expired` / `account_inactive` / `missing_scope` を検知したら：

1. **SecretStorage からトークン削除**（`secrets.delete('brainsync.slackToken')`）。
2. **`brainsync.slackIntegration` を `false` に更新**（`config.update('slackIntegration', false, ConfigurationTarget.Global)`）。
   - ★トークン削除だけでは、ユーザーが再度トークンを設定すると同じ無効トークンで再試行し得る。設定を明示 OFF にすることで**再起動後の再試行ループを確実に止める**。
3. `slackActive = false`、内部フラグ `notifiedAuthFailure = true`（**セッション中の重複通知防止**）。
4. **1回だけ**警告表示：「Slack連携が無効です（トークンが無効/権限不足）。再設定してください」＋ ボタン「Slack連携を設定」（`connectSlack` 起動）。
5. `notifiedAuthFailure` は `connectSlack` 成功時にリセット。

> **冪等性メモ（実装）**: `handlePermanentError` は複数回呼ばれ得る（activate 内の複数 API、連続遷移）。手順1（`secrets.delete`）・手順2（`config.update(false)`）は**繰り返しても安全な冪等操作**なので毎回実行してよい。**通知（手順4）だけ `notifiedAuthFailure` で1回に抑制**する。つまり「無効化は冪等に何度でも／通知は1回だけ」。

> 一時的エラー（`ratelimited` / `network_error` / タイムアウト）は**恒久エラーと区別**し、無効化も通知もしない（ログのみ、次遷移で回復）。

### 7-7. `disconnectSlack` / `forceClear` は無条件

`forceClear()` は `slackActive` を参照せず、トークンがあれば必ず `dnd.endSnooze` + status クリアを発行する（§4-2）。
crash 後に内部フラグが false でも Slack 側に Snooze が残っているケースを確実に解除するため。

---

## 8. テスト計画

### ユニットテスト（`SlackClient` と `SecretStorage` をモック）

- **無効時**: `slackIntegration=false` または token 無し → どの遷移でも API 呼び出しゼロ。
- **有効時の遷移**:
  - idle→working: `dnd.setSnooze`（num_minutes = ceil(remaining/60)）+（status有効なら）`users.profile.set`。
  - working→breaking/paused/idle: `dnd.endSnooze` + status クリア。
  - resume（paused→working）: 残り時間で再 Snooze。
- **status 無効**（`slackSetStatus=false`）: `users.profile.set` を呼ばない。
- **単一実行+コアレス**: 実行中に `syncForState` を連続で割り込ませても、最終的に**最新状態に対応する呼び出しに収束**し、中間の重複呼び出しが最小。
- **部分成功（§4-2a）**: `dnd.setSnooze` 成功・`users.profile.set` 失敗 → `slackActive=true`（Snooze 基準）。以後 breaking 遷移で `deactivate` が走る。
- **恒久エラー short-circuit（#1）**: `dnd.setSnooze` が `invalid_auth` → **`users.profile.set` を呼ばない**（`activate` 打ち切り）。`slackActive=false`、無効化は1回だけ発火。
- **失敗分類（§7）**: 恒久エラー（`invalid_auth`/`token_revoked`/`token_expired`/`missing_scope` 等）→ トークン削除 + `slackIntegration=false` + 1回だけ通知（`notifiedAuthFailure` で重複抑止）。一時エラー（`network_error`/`ratelimited`）→ 無効化も通知もせずログのみ。
- **deactivate の flag 確定**: `endSnooze` がネットワーク失敗でも `slackActive=false` になる（解除ループ防止）。
- **forceClear / disconnect 無条件**: `slackActive=false` でも token があれば endSnooze + status クリアを呼ぶ（§7-7）。
- **num_minutes 下限**: remaining < 60s でも `num_minutes >= 1`。
- **connectSlack**: `auth.test` 成功かつ `x-oauth-scopes` に必要スコープあり → 保存。トークン無効 or スコープ不足 → 保存しない。成功時に `notifiedAuthFailure` リセット。
- **設定変更スコープ**: Slack 無関係キー（例 `workDuration`）変更では `syncForState` を呼ばない。

> テスト方針: `SlackClient` を注入（呼び出し記録スパイ）、`SecretStorage` はメモリ実装。既存の `test/unit/mocks/vscode.ts` に `secrets` と `commands` を拡張。

### 手動テスト（`docs/TESTING.md` 追記）

1. Slack App 作成 → User トークン取得 → `BrainSync: Slack連携を設定`（接続確認メッセージ）。
2. `slackIntegration:true`。作業開始 → Slack が DND（通知バッジ静音）+ ステータス「🍅 集中中」。終了時刻（〜HH:MM）は **Slack 側が `status_expiration` から表示**することを確認。
3. 一時停止 → DND/ステータス解除。再開 → 再設定。
4. 作業完了 → 解除。
5. トークンを無効化（Slackでアプリ削除）して作業 → 「トークンが無効」通知が**一度だけ**出て、`slackIntegration` が自動で OFF になる（再試行が止まる）。
6. `BrainSync: Slack連携を解除` → ステータス/DND が消え、トークン削除（作業中でなくても・内部状態に関わらず解除されること）。
7. `slackSetStatus:false` でステータスは変えず DND のみ動くこと。
8. connect 時に権限不足トークン（scope を1つ外したApp）を入力 → 「権限が不足」で保存されないこと。

---

## 9. 実装ステップ

1. `package.json`: 設定4種 + コマンド2種を追加。
2. `src/slack/slackClient.ts`: Node `https` の薄いラッパー（注入可能, タイムアウト, ok 判定, トークン非ログ, **レスポンスヘッダ解析**して `headers['x-oauth-scopes']` を返す＝connect のスコープ検証用）。
3. `src/slack/slackManager.ts`: `SlackManager`（reconcile + 単一実行コアレス + check + forceClear + dispose）。
4. `src/extension.ts`: 生成（restore 前）・`onStateChange`/`onDidChangeConfiguration` 配線・コマンド登録・dispose。`FocusSink` シグネチャ統一（`FocusDndManager.syncForState` に `remainingSec` 引数追加）。
5. `test/unit/mocks/vscode.ts`: `secrets`（メモリ）・`window.showInputBox` を追加。
6. ユニットテスト `test/unit/slackManager.test.ts` / `slackClient.test.ts`。
7. `README.md`（設定表・コマンド・トークン取得手順・プライバシー節）/ `CHANGELOG.md` / `docs/TESTING.md` 更新。
8. 動作確認（実 Slack ワークスペースで手動テスト）。

---

## 10. スコープ外（将来）

- OAuth フロー（自作アプリ不要のワンクリック接続）: リダイレクト用バックエンドが必要 → 大幅増。v1 は手動トークンで割り切り。
- 複数ワークスペース同時連携。
- macOS 集中モード連携（Mac限定・別機能）。

---

## 11. 見積もり

| 区分 | 工数感 |
|------|--------|
| 実装（client + manager + 配線 + 設定/コマンド） | 中（〜1日） |
| テスト（ユニット + 実 Slack 手動） | 中 |
| ドキュメント（トークン取得手順が肝） | 小〜中 |

Focus DND より重い（ネットワーク・認証・秘密情報・レート制限）が、OS非依存で効果大。
セキュリティ（S5）とトークン取得手順の分かりやすさが成否の鍵。
</content>
