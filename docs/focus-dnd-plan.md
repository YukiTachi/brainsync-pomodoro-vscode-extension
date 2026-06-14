# 実装計画書: 作業中のVS Code通知抑制（Focus Do Not Disturb）

- **対象機能**: 作業セッション中、VS Code の通知（他拡張のトースト等）を自動で抑制し、休憩・終了時に自動解除する
- **作成日**: 2026-06-14
- **ステータス**: 計画（未着手）
- **スコープ**: VS Code 内の通知抑制のみ（macOS集中モード / Slack 連携は対象外。将来の別機能）

---

## 1. 概要

ポモドーロの「作業中」だけ、VS Code 標準の **Do Not Disturb（DND）モード** を自動で ON にし、
作業を中断する通知（他拡張のトースト等）を抑える。休憩・一時停止・リセット・完了時に自動で OFF に戻す。

- **オプトイン**（デフォルト OFF）。新設定 `brainsync.focusDoNotDisturb` で有効化。
- セットアップ不要・OS非依存で全ユーザーに効く（Slack/macOS連携と違い、トークンや事前設定が不要）。

---

## 2. 背景と技術的制約（★最重要）

VS Code の DND は拡張から扱う上で **3つの強い制約**がある。設計はこれに従う。

| # | 制約 | 出典 |
|---|------|------|
| C1 | **トグル専用コマンドしかない**。`notifications.toggleDoNotDisturbMode`（ON/OFF を反転）。「ONにする」「OFFにする」という個別コマンドは**存在しない**。 | vscode `notificationsCommands.ts` |
| C2 | **現在の DND 状態を取得する公開APIがない**。`settings.json` のキーでもない（`NotificationsFilter` の実行時状態）。拡張からは読めない。 | 同上 |
| C3 | DND = フィルタ `ERROR`。**info / warning のトーストが抑制**され、通知センターに静かに溜まる。**error と modal は引き続き表示**される。 | 同上 |

### 制約から導かれる設計方針

- **C1 + C2**: 状態を読めずトグルしかできない → **拡張側で「自分が今 ON にしているか」を内部フラグ（`dndActive`）で管理**し、
  必要な遷移のときだけトグルを発行する（冪等に保つ）。むやみに連打しない。
- **C2 の副作用（ユーザーとの競合）**: ユーザーがベルアイコンから手動でトグルすると、我々の内部状態とズレる可能性がある。
  → v1 は **オプトイン + 「作業中だけ ON、それ以外は必ず OFF に戻す」** という単純で予測可能な挙動に限定し、ズレのリスクを最小化する。
  → 逃げ道として、ユーザーはいつでもベルアイコンで手動トグルできる（ステータスバーに bell-slash アイコンが出る）。
- **C3 の副作用（自前通知が消える）**: 本拡張の作業完了通知は `showInformationMessage`（info）。
  **DND が ON のままだとこの通知自体が抑制される**。→ 作業完了通知を出す**前**に必ず DND を OFF にする（§5 シーケンス参照）。

### 前提（実装時に要確認）

- **A1**: DND の実行時状態はウィンドウのリロードで OFF にリセットされる想定。
  → 起動時は「DND は OFF」と仮定して `dndActive = false` で開始する。
  万一リロードをまたいで ON が残る環境があっても、§6 のエスケープハッチで救済可能。

---

## 3. 機能仕様

### 設定（新規）

`package.json` の `contributes.configuration.properties` に追加：

```jsonc
"brainsync.focusDoNotDisturb": {
  "type": "boolean",
  "default": false,
  "description": "作業中はVS Codeの通知（他拡張のトースト等）を自動で抑制する（Do Not Disturb）。休憩・終了時に自動解除されます。"
}
```

### 挙動

| タイマー状態 | DND |
|--------------|-----|
| `working`（作業中） | **ON**（設定が有効なときのみ） |
| `breaking`（休憩中） | OFF |
| `paused`（一時停止） | OFF |
| `idle`（停止） | OFF |

- 設定が OFF のときは一切トグルしない（既存挙動を変えない）。
- 作業を一時停止 → 再開すると、OFF → ON に戻る（作業中だけ抑制、という一貫したルール）。

---

## 4. 設計

### 新規モジュール: `src/focusDnd.ts`

DND のトグルと内部状態管理を 1 クラスに閉じ込める（テスト容易・責務分離）。

> **非同期に関する注意（重要）**: `vscode.commands.executeCommand(...)` は **Thenable（非同期）** を返す。
> トグルの反映は次のマイクロタスク以降になり得るため、**「同期的に OFF できる」と仮定してはならない**。
> 特に `soundEnabled: false` のとき `playSound` が即 return するため、解除と次の通知表示がレースし得る。
> → 公開メソッドはすべて **`async` + `await executeCommand`** とし、呼び出し側も `await` する。

```ts
export class FocusDndManager {
  private dndActive = false;   // 「自分が今 ON にしているか」の内部仮定（C1/C2対策）

  constructor(private outputChannel: vscode.OutputChannel) {}

  // タイマーの状態遷移ごとに呼ぶ。working なら ON、それ以外は OFF に揃える。
  async syncForState(state: TimerState): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('brainsync')
      .get<boolean>('focusDoNotDisturb', false);

    const shouldBeOn = enabled && state === 'working';
    if (shouldBeOn && !this.dndActive) { await this.toggle(true); }
    else if (!shouldBeOn && this.dndActive) { await this.toggle(false); }
  }

  // 明示的に OFF（作業完了通知を出す直前に await して呼ぶ。C3対策）
  // 注: dndActive===false のとき no-op。通常運用ではこれで正しいが、
  //     内部仮定がズレた復旧用途には使えない（→ forceDisable）。
  async ensureOff(): Promise<void> {
    if (this.dndActive) { await this.toggle(false); }
  }

  // エスケープハッチ（コマンド brainsync.disableDnd 用）。
  // ★ensureOff のガード（dndActive===true）を通さず、無条件でトグルを1回発行する。
  //   クラッシュ後など「実際は DND ON だが内部は dndActive=false 仮定」のズレから
  //   復旧するのが目的なので、ガード付き ensureOff では肝心の場面で no-op になり用を成さない。
  async forceDisable(): Promise<void> {
    await this.toggle(false);
  }

  private async toggle(target: boolean): Promise<void> {
    // ★内部状態を await の「前」に楽観的更新する（再入競合対策）。
    //   async 化により toggle() 実行中に他の syncForState() が再入し得る。
    //   フラグを先に確定しておくことで、再入した同期判定が古い値を読んで
    //   二重トグルするのを防ぐ（§5-2 の no-op 成立条件）。
    this.dndActive = target;
    // トグル専用コマンドしかない（C1）。Thenable を await して反映を待つ
    //（呼び出し側 ensureOff の await が、通知前のコマンド到達を保証＝C3対策）。
    try {
      await vscode.commands.executeCommand('notifications.toggleDoNotDisturbMode');
    } catch (e) {
      // 失敗時は楽観的更新をロールバック（実トグルが起きていないため内部仮定を戻す）。
      this.dndActive = !target;
      this.log(`DND toggle failed, rolled back: ${e}`);
      return;
    }
    this.log(`DND -> ${target ? 'ON' : 'OFF'}`);
  }

  dispose(): void {
    // ベストエフォートで OFF に戻す。executeCommand は非同期で、終了シーケンスでは
    // 完了を await できない＝解除は「保証なし」。前提 A1（リロードで OFF にリセット）で救済する。
    void this.ensureOff();
  }
}
```

### 状態遷移とトグル発行（冪等性の表）

`dndActive` を見て「逆向きのときだけ」トグルするので、同じ状態が連続しても二重トグルしない。

| 遷移 | shouldBeOn | dndActive(前) | アクション |
|------|-----------|---------------|-----------|
| idle → working | true | false | **toggle ON** → dndActive=true |
| working → working（tick等） | true | true | なし |
| working → breaking | false | true | **toggle OFF** → false |
| working → paused | false | true | **toggle OFF** → false |
| paused → working（resume） | true | false | **toggle ON** → true |
| working → idle（完了/リセット） | false | true/false | §5 で先に ensureOff 済み → なし |

---

## 5. 既存コードへの統合ポイント

### 5-1. 配線（`src/extension.ts`）

1. `activate()` で `FocusDndManager` を生成。
2. `timerEvents.onStateChange` を拡張して**全状態**で DND を同期（現状は `idle` のみ処理）：

```ts
onStateChange: (state: TimerState) => {
  if (state === 'idle') { statusBar.update(0, state); }
  void focusDnd.syncForState(state);   // ← 追加（fire-and-forget で可）
},
```

3. `dispose` の集約に `focusDnd.dispose()` を追加。

4. **設定の途中変更ハンドリング**（★レビュー指摘）: 既存の `onDidChangeConfiguration`（extension.ts:258-265）は
   現状 `timer.reloadConfig()` のみ。作業中に `brainsync.focusDoNotDisturb` を ON/OFF された場合に即時反映するため、
   現在のタイマー状態で再同期する：

```ts
vscode.workspace.onDidChangeConfiguration((e) => {
  if (e.affectsConfiguration('brainsync')) {
    timer.reloadConfig();
    void focusDnd.syncForState(timer.getState());   // ← 追加: 途中で有効化/無効化された場合に追従
    outputChannel.appendLine(`[${new Date().toISOString()}] Configuration changed`);
  }
});
```

   - 作業中に OFF にされた → `shouldBeOn=false` かつ `dndActive=true` なら解除。
   - 作業中に ON にされた → `shouldBeOn=true` かつ `dndActive=false` なら抑制開始。

### 5-2. 作業完了通知の前に DND を OFF（★C3 対策）

`handleWorkComplete()`（extension.ts:285）の**先頭**で明示的に OFF にする。

`handleWorkComplete` を **`async`** にし、通知の前に **`await`** で確実に解除する：

```ts
async function handleWorkComplete(session: SessionRecord): Promise<void> {
  await focusDnd.ensureOff();   // ← info通知が抑制されないよう、通知の前に必ず解除（await で反映を待つ）
  recordSession(session);
  ...
  notificationManager.notifyWorkComplete(...);
}
```

呼び出し元 `onWorkComplete: (session) => handleWorkComplete(session)` は戻り値を使わない（fire-and-forget で可）。

**なぜ `onStateChange` 任せにしないか**: `timer.handleSessionComplete()`（timer.ts:310）は
`onWorkComplete`（=通知開始）を**先**に呼び、`state='idle'` と `onStateChange(idle)` を**後**で発火する（timer.ts:327→348）。
つまり onStateChange による解除は通知より遅れて競合する。よって通知直前に明示 `await ensureOff()` する。

**★async 再入と二重トグルの回避**: `handleWorkComplete` が `await ensureOff()` で中断している間に、
timer は同期的に `onStateChange(idle)` を発火し `void syncForState('idle')` が**再入**する。
このとき `toggle()` が `dndActive` を **await 前に確定**しているため（§4 楽観的更新）、
再入した `syncForState('idle')` は `dndActive===false` を見て **no-op** となり、二重トグルを起こさない。
> 逆に旧案のように `dndActive = target` を await の**後**に置くと、再入時にまだ `true` のままで二重トグル → DND が ON に戻り完了通知が抑制される。**この順序が機能の正しさの要**。

> ★レビュー反映: 旧案の「`playSound` の await で時間が稼げる」前提は不採用。
> `executeCommand` は Thenable であり、かつ `soundEnabled: false` だと `playSound` が即 return してレースし得る。
> よって**タイミング依存に頼らず `await ensureOff()` で明示的に反映を待つ**設計とする。

---

## 6. エッジケース / リスクと対策

| 項目 | 内容 | 対策 |
|------|------|------|
| ユーザー手動トグルとの競合（C2） | 作業中にユーザーがベルから DND を切替 → 内部仮定とズレる | v1 は受容。挙動を単純化し、いつでも手動で上書き可能（ベルアイコン）と明記。 |
| クラッシュ/強制終了で ON のまま残る | `dispose()` が走らない、走っても `executeCommand` を **await できず終了シーケンスで間に合わない可能性**（解除は**保証なし**と割り切る） | A1（リロードで OFF にリセット）が効くので通常は復帰。加えて**エスケープハッチ**としてコマンド `BrainSync: 通知抑制を解除` を用意。**ただし `ensureOff` ではなく `forceDisable`（無条件トグル）を呼ぶこと**（下記注意）。 |
| 復元時（`timer.restore()`）に作業中へ復帰 | 起動直後 `dndActive=false` 仮定 → restore が `onStateChange(working)` を発火 → 正しく ON になる | 既存の restore が onStateChange を呼ぶため追加対応ほぼ不要（要確認）。 |
| `notifyBreakComplete` の通知 | 休憩中は DND OFF なので抑制されない | 対応不要。 |
| modal 通知（統計リセット確認等） | DND 中でも modal は表示される（C3） | 影響なし。 |

> **★エスケープハッチの落とし穴（重要）**: 解除コマンドを `ensureOff()` 実装にすると、
> 復旧が最も必要な「実際は DND ON だが内部は `dndActive=false`」のケースで `if (dndActive)` ガードに弾かれて **no-op** になる
> （＝一番効いてほしい場面で効かない）。よって解除コマンドは **`forceDisable()`（無条件トグル）** を呼ぶ。
> なお C1/C2 の制約上、`forceDisable` は「現在 DND が ON」を前提に1回トグルする操作であり、
> 万一すでに OFF のときに実行すると ON にしてしまう（再度実行で戻せる）。これはトグル専用APIの本質的限界として受容し、
> コマンド説明文に「通知抑制を解除（ベルアイコンの bell-slash が出ているときに使用）」と明記する。

---

## 7. テスト計画

### ユニットテスト（`test/` に追加）

スタブが2種類必要:
- `vscode.commands.executeCommand` — トグル発行回数・引数の検証用。**Promise を返すスタブ**にして `await` を成立させる。
- `vscode.workspace.getConfiguration().get` — `focusDoNotDisturb` の ON/OFF を切り替えてケースを作る。

検証項目:
- 設定 OFF のとき: どの状態遷移でもトグルが呼ばれない。
- 設定 ON のとき:
  - idle→working で 1 回だけトグル発行、working 連続では追加発行なし（冪等）。
  - working→breaking / paused / idle で OFF 方向に 1 回。
  - resume（paused→working）で再 ON。
- `ensureOff()`: dndActive=true のとき 1 回、false のとき 0 回。
- **★再入の二重トグル防止**: `ensureOff()` の `await` 解決前に `syncForState('idle')` を割り込ませても、
  `executeCommand` の呼び出しが**合計1回**に留まる（楽観的更新で2回目が no-op になる）。
  → `executeCommand` スタブを「解決を遅延させる Promise」にして、解決前に `syncForState('idle')` を呼ぶ形で検証。
- **`forceDisable()`**: `dndActive===false`（復旧シナリオ）でも **トグルが1回発行**される（`ensureOff` と違いガードで弾かれない）。
- **失敗時ロールバック**: `executeCommand` スタブが reject すると `dndActive` が更新前の値に戻る。

### 手動テスト（`docs/TESTING.md` に追記）

1. `focusDoNotDisturb: true` に設定。
2. 作業開始 → ステータスバーのベルが bell-slash（DND ON）になることを確認。
3. 別拡張等の info 通知が出ないこと（通知センターには溜まる）を確認。
4. 作業完了 → **本拡張の「休憩する」通知が表示される**こと（＝先に DND 解除されている）を確認。
5. 一時停止 → 通知が復活、再開 → 再び抑制、を確認。
6. リセット / ウィンドウ再読み込み後に DND が残らないことを確認。

---

## 8. 実装ステップ（順序）

0. **【着手前の検証】前提 A1 の実機確認**: ウィンドウ再読み込み（`Developer: Reload Window`）／再起動で
   DND がリセットされるかを確認する。設計全体が「起動時 `dndActive=false`」仮定に依存しており、
   ここが崩れると `dndActive` の初期値や復元ロジックに影響が出る。**結果次第で設計に手戻りあり**のため最初に確認する。
1. `package.json`: 設定 `brainsync.focusDoNotDisturb` とコマンド `brainsync.disableDnd`（解除エスケープハッチ）を追加。
2. `src/focusDnd.ts`: `FocusDndManager` 新規作成。
3. `src/extension.ts`: **`FocusDndManager` の生成は `timer.restore()`（extension.ts:89）より前**に行う
   （restore が `working` へ復帰する際に `onStateChange(working)` 経由で DND を ON にするため、その時点で manager が存在している必要がある）。
   さらに `onStateChange` 配線・`onDidChangeConfiguration` で `syncForState(timer.getState())` 追加・
   `handleWorkComplete` を async 化し先頭で `await ensureOff()`・`dispose`・解除コマンド登録。
4. ユニットテスト追加。
5. `docs/TESTING.md` に手動テスト手順を追記。
6. `README.md` / `CHANGELOG.md` 更新（設定表に1行追加）。
7. 動作確認（Extension Development Host）。

---

## 9. スコープ外（将来）

- `notifications.toggleDoNotDisturbModeBySource`（ソース別抑制）の活用。
- macOS 集中モード連携（要 Shortcuts、Mac限定）。
- Slack 連携（要 User Token、OS非依存）。

---

## 10. 見積もり

| 区分 | 工数感 |
|------|--------|
| 実装（モジュール+配線+設定） | 小（〜0.5日） |
| テスト（ユニット+手動） | 小 |
| ドキュメント | 小 |

実装コスト小・ユーザー全員に効く・セットアップ不要、という費用対効果の高い機能。
</content>
</invoke>
