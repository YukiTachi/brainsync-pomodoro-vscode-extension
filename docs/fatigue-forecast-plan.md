# 実装計画書: 脳疲労スコアの先読み警告

- **対象機能**: 現在の作業ペースから「あと N セットで警戒域に入る」ことを、閾値を**越える前に**知らせる
- **作成日**: 2026-09-06
- **ステータス**: 計画（未着手）
- **Notion**: 優先度 中 / 💬 機能リクエスト / 工数 中
- **関連**: [[focus-dnd-plan]]（C3: DND 中は info/warning トーストが抑制される）、[[marketplace-l10n-plan]] §10（実行時文字列の l10n は後続）

---

## 1. 概要

現在の脳疲労スコア（0〜45点）は**セッション完了後に事後計算**され、閾値（既定 21点＝警戒）に**達してから**アラートが出る。つまり「もう疲れている」と後から言われる設計。

スコアは**セッション数などの決定的な関数**なので、「あと k セットやったら何点か」を**正確にシミュレーション**できる。これを使い、閾値を越える**前**に予告する：

> ⚠️ このペースだと、あと **2 セット**で「警戒」（21点）に達します（現在 16点）

- 通知は**セッション完了時**（次のセットを始めるか決める瞬間）に出す
- 統計画面にも**トーストと同じ判定・同じ文言**で先読みを表示（`fatigueForecastEnabled` が ON のとき。通知の有無には依存しない。§4-1c / §4-4）
- **推測ではなく既存ルールの正確な先読み**。ユーザーに嘘をつかない

---

## 2. 背景と技術的前提（★実コードで確認済み）

| # | 事実 | 設計への影響 |
|---|------|------|
| F1 | `estimateFatigueScore(stats)`（`statistics.ts:19`）は **今日のセッション数 / 今週のセッション数 / 連続日数 / 中断率 / 休憩スキップ率** の5指標から段階加点で算出する純関数。入力は `Statistics` のみ | `stats` を複製して `today.sessions` / `week.totalSessions` を +k した仮データで再計算すれば**先読みが正確に出せる**（新しい推定モデル不要） |
| F2 | 加点は段階式（今日 6/8/10/12、今週 30/40/50/60、連続 5/7 日）。段階を跨ぐと最大 **+15 点** 跳ぶ一方、**中断率は分母（完了+中断）が増えて下がる**ため、+k で**スコアが現在より下がることもある＝先読みは非単調** | 「あと k セットで閾値到達」は最小の k を 1..lookahead で**線形探索**する（非単調でも「最初に閾値以上になる k」は正しく求まる）。統計画面の見せ方は §4-4 で定義 |
| F3 | **`updateTodayStats`（`:183`）が `today.fatigueScore` を計算する時点（`:210`）で `stats.week` は更新前**。直後の `updateWeeklyStats`（`:218`）は `week.fatigueScore`（`:255`）を再計算するが **`today.fatigueScore` は更新しない**。結果、`recordSession` 後の **`today.fatigueScore` は「週セッション数が 1 少ない」古い値**のまま残る（既存の潜在バグ） | **「現在スコア」が2系統になり隙間が生じる**: 既存アラートは `today.fatigueScore`（`extension.ts:388`）、素朴な先読みは `estimateFatigueScore(stats)`（新しい値）を見るため、`today.fatigueScore < 閾値 ≤ estimateFatigueScore(stats)`（今回のセッションで週の段階 30/40/50/60 を跨いだとき）に**どちらも出ない**。完了トーストの「X点」と先読みの「現在 Y点」と統計画面も食い違う。→ **根本修正: `updateWeeklyStats` の末尾で `today.fatigueScore` を再計算し 1 系統に統一**（§4-1a）。先読みの「現在」も `today.fatigueScore` を使う |
| F4 | 既存アラート `checkAndNotifyFatigueAlert`（`notifications.ts:111`）は `AlertState{lastAlertDate,lastAlertScore}`（`config.ts:88`）で**同日1回、+5点以上で再通知**という頻度制御をしている | 先読みは**別のフィールドで独立に頻度制御**し、既存アラートと干渉させない（§4-3） |
| F5 | **Focus DND（[[focus-dnd-plan]] C3）**: 作業中（`working`）は VS Code の info/warning トーストが抑制される。`handleWorkComplete`（`extension.ts:368`）は先頭で `ensureOff()` するため、**完了時点では DND が解除済み** | 作業**開始時**に出すトーストは DND に消され得る → **主トリガーは「セッション完了時」**に置く（§3 挙動）。開始時トリガーは v2 で検討 |
| F6 | 作業開始の入口は4つ（`startTimer` コマンド `:114`、`onSkipBreak` `:83`、`onStartWork` `:86`、`autoStartWork` `:411`）で、すべて `timer.startWork()` に集約 | 開始時に出すなら Timer に `onWorkStart` イベントを1つ足せば4箇所を網羅できる（v2 用の設計メモ） |

### 前提から導く設計方針

- **F1/F2**: 先読みは `statistics.ts` に **純関数 `projectFatigueScore` / `sessionsUntilThreshold` / `describeForecast`** として追加。vscode 非依存でユニットテストが容易。`describeForecast` はトーストと統計画面が共有する「何を伝えるか」の判定（§4-1c）
- **F3**: **`updateWeeklyStats` の末尾で `today.fatigueScore = estimateFatigueScore(stats)` に揃える**（§4-1a）。これにより `today.fatigueScore === estimateFatigueScore(stats)` が**不変条件**になり、既存アラート・先読み・完了トースト・統計画面が同じ「現在」を見る。既存挙動の修正なので **CHANGELOG の Fixed** に載せ、テストで不変条件を担保する。先読みの呼び出しは引き続き `updateWeeklyStats` 後の stats に限定
- **F4**: `AlertState` に先読み専用フィールドを追加。「同日・同じ残りセット数では再通知しない／残りが減ったら再通知」
- **F5**: v1 の通知トリガーは **`handleWorkComplete`（完了時）のみ**。DND の影響を受けず、既存アラートと同じ場所・同じ作法で並ぶ

---

## 3. 機能仕様

### 設定（新規, `package.json`）

| キー | 型 | 既定 | 説明 |
|------|----|----|------|
| `brainsync.fatigueForecastEnabled` | boolean | `true` | 脳疲労の先読み警告を表示する |
| `brainsync.fatigueForecastLookahead` | number（1〜4） | `2` | 何セット先まで見て警告するか |

- 閾値は既存の **`brainsync.fatigueAlertThreshold`（既定 21）を共用**（別閾値は作らない＝「警戒域」の定義を1つに保つ）
- `fatigueAlertEnabled` / `notificationEnabled` が OFF なら先読みも出さない（既存アラートと同じゲート）
- 設定名・説明は `package.nls.json` / `package.nls.ja.json` に**両方追加**（nls 整合テストが強制する）

### 挙動（v1）

| タイミング | 動作 |
|---|---|
| **セッション完了時**（`handleWorkComplete`） | 完了後の stats（week 更新済み）で `describeForecast(stats, threshold, lookahead)` を評価（§4-1c）。結果が **`reach`**（現在 < 閾値 かつ lookahead 内に到達）のときだけ先読み通知。`projection` / `null` は通知しない |
| 現在スコア ≥ 閾値 | 先読みは**出さない**（既存の `checkAndNotifyFatigueAlert` の領分。二重通知を避ける） |
| 統計画面（`viewStats`） | **トーストと同じ判定**（§4-1c `describeForecast`）で 1 行表示。lookahead 内に到達するなら「あと k セットで「{levelLabel}」（{threshold}点）」、到達しないなら +1 予測（`projected > current` のときのみ）、それ以外は非表示。**`fatigueForecastEnabled` が ON のときのみ**（§4-4） |

### 通知メッセージ（実行時文字列・当面は日本語）

```
⚠️ このペースだと、あと {k} セットで「{levelLabel}」（{threshold}点）に達します（現在 {score}点）
  [詳しい診断を受ける]  [閉じる]
```
- **`{levelLabel}` は `getFatigueLevel(threshold).label` から導出**する。`fatigueAlertThreshold` は 15〜30 で可変で、例えば 15 のときのレベルは「やや注意」なので「警戒域」と固定表記すると**誤表示**になる
- `{score}` は **`stats.today.fatigueScore`**（§4-1a の修正後は `estimateFatigueScore(stats)` と一致）
- 「詳しい診断を受ける」→ `openDiagnosisPage('fatigue_forecast')`（既存の導線と同じ UTM 規約、campaign 値だけ新設）
- `k = 1` のときは文言を「**次のセット**で「{levelLabel}」に達します」に切り替える（「あと1セット」より自然）
- **l10n**: これは `src` 内の実行時文字列なので、[[marketplace-l10n-plan]] §10 の後続タスクの対象。**そのタスクが先に完了していれば `vscode.l10n.t` で書く**。順序依存を §9 に明記

---

## 4. 設計

### 4-1. 純関数（`src/statistics.ts` に追加）

```ts
/** 今日のセッションを extra 回追加した場合の推定脳疲労スコア（既存ルールの正確な先読み） */
export function projectFatigueScore(stats: Statistics, extraSessions: number): number {
  if (extraSessions <= 0) { return estimateFatigueScore(stats); }
  // 元の stats を汚さない（deep copy）。today と week だけ差し替えれば十分
  const projected: Statistics = {
    ...stats,
    today: { ...stats.today, sessions: stats.today.sessions + extraSessions },
    week:  { ...stats.week,  totalSessions: stats.week.totalSessions + extraSessions },
  };
  return estimateFatigueScore(projected);
}

/**
 * 閾値に到達するまでのセット数。1..maxLookahead の最小 k を返す。
 * 現在すでに閾値以上なら 0、maxLookahead 以内に到達しないなら null。
 */
export function sessionsUntilThreshold(
  stats: Statistics, threshold: number, maxLookahead: number,
): number | null {
  if (estimateFatigueScore(stats) >= threshold) { return 0; }
  for (let k = 1; k <= maxLookahead; k++) {
    if (projectFatigueScore(stats, k) >= threshold) { return k; }
  }
  return null;
}
```

**なぜ today と week だけで足りるか（F1 の5指標の挙動）**
- 今日/今週のセッション数: 直接 +k
- 連続日数: `calculateConsecutiveDays` は `stats.today.sessions > 0` で今日を数えるため、+k で**今日が0→1以上になるケースも自然に反映**される
- 中断率: 分母（sessions + interrupted）が増えて率は**下がる**方向 → +k で保守的（過大警告にならない）
- 休憩スキップ率: `history` 依存で +k の影響なし（変化しない指標として扱う）

> **呼び出し規約（F3）**: 引数の `stats` は **`updateWeeklyStats` 適用後**であること。`recordSession` 経由の stats はこれを満たす。

### 4-1a. 「現在スコア」を 1 系統に統一する（★F3 の根本修正・既存挙動の変更）

> **実装で判明した追加事実**: 既存コードの `week.fatigueScore` は object literal 内の `estimateFatigueScore(stats)` で計算されており、**`stats.week` 代入前の古い `totalSessions`（更新前）を読んでいた**。つまり `week.fatigueScore` にも「今週のセッション数」加点が反映されていなかった（潜在バグ）。単に `today.fatigueScore = week.fatigueScore` とコピーするだけでは不変条件が成立しないため、**スコアは `stats.week` を代入した後に 1 回計算し、`week` と `today` の両方へ同じ値を入れる**実装にした。これにより `week.fatigueScore` も週加点を含む正しい値になる（統計画面の週次疲労表示も改善）。CHANGELOG の Fixed はこの点も含めて記述する。

`updateWeeklyStats`（`statistics.ts:218`）の末尾に 1 行追加し、週更新後の値で `today.fatigueScore` を揃える：

```ts
  stats.week = { /* ...既存... */ fatigueScore: estimateFatigueScore(stats), dailyStats };
  // ★追加: week 更新後の値で today も揃える（today.fatigueScore === estimateFatigueScore(stats) を不変条件にする）
  stats.today.fatigueScore = stats.week.fatigueScore;
  return stats;
```

- `week.fatigueScore` は同じ `estimateFatigueScore(stats)` の結果なので、代入で不変条件が成立する
- 影響: `recordSession` 後の `today.fatigueScore` が**週セッション数を正しく含んだ値**になる。既存アラート（`extension.ts:388`）が「週の段階を跨いだ直後」に反応するようになる＝**既存の潜在バグの修正**（CHANGELOG **Fixed**）
- 先読み側（§4-2）は「現在」に `stats.today.fatigueScore` を使い、`sessionsUntilThreshold` の k=0 判定（`estimateFatigueScore(stats)`）と一致する

**★意図した副作用（既存の見える挙動変更）**: `updateWeeklyStats` は `recordSession` だけでなく **`viewStats`（`extension.ts:152`、保存あり）と `exportData`（`:169`）からも呼ばれ**、先頭で `rolloverDailyStats` を実行する。日付が変わった直後に統計画面を開くと、today は空データ（sessions 0）のまま `estimateFatigueScore(stats)` が走り、**週セッション数・連続日数・休憩スキップ率の加点だけが乗った値**（例: 週 ≥30 で +3、連続 5 日で +5、スキップ率で +5 → 13点）が `today.fatigueScore` に入って保存される。現状は最初のセッションまで 0 のままなので、次が変わる：
- 統計画面の「🧠 推定脳疲労スコア」が**朝一で 0 でなくなる**
- `generateAdvices`（定義 `statsViewProvider.ts:377`）の `score >= 21` 分岐（`:385`）が 0 セットでも発火し得る（週 60 + 連続 7 日 = 25 なら「睡眠時間を30分延長」が出る）
- CSV エクスポートの today 行の Fatigue Score

**判断: この挙動を採用する。** モデル的には「疲労は前日から持ち越す」という意味で正しい方向であり、`week.fatigueScore` は**すでにこの値を持っていた**ので新しい計算ではない。代替（再計算を `recordSession` 側に置く）は `viewStats` 経路で不変条件が崩れるため採らない。CHANGELOG では **Fixed**（今日のスコアが週セッション数を含まず古かった）に加え **Changed**（0 セットの日でも週・連続日数由来のスコアが表示される）として明記する。§8 に rollover 直後のテストを置く。

**`updateTodayStats` の `:210` は冗長になる**（直後の `updateWeeklyStats` が上書きするため）。削除せず残す場合は「`updateWeeklyStats` 側が正。ここは `recordSession` 以外から `updateTodayStats` 単独で呼ばれた場合の暫定値」とコメントを添える。本計画では**コメント追記に留め、削除はしない**（`updateTodayStats` 単体の既存テストへの影響を避ける）。

**良い副作用**: `updateWeeklyStats` 内で `dayStats = stats.today`（`statistics.ts:237`）は**同一オブジェクト参照**なので、`today.fatigueScore` への代入は `week.dailyStats` 内の today 行にも反映され、統計画面の週内訳とも整合する（§8 で検証）。

### 4-1b. 非単調性と統計画面の扱い（F2）

中断率の希釈により `projectFatigueScore(stats, k)` は現在より**低く**なり得る（例: 完了1・中断1 = 50% → +10、完了2・中断1 = 33% → +5 で **−5**）。`sessionsUntilThreshold` の線形探索は非単調でも正しいが、統計画面で「次のセット後の予測: 15点」が現在 20点より低く出ると混乱を招く。→ 統計画面は **§4-1c の `describeForecast` に従う**: lookahead 内に到達するなら k を示し、到達しないときだけ +1 予測を `projected > current` の条件で示す。「作業を続けると下がる」という表示は、モデル上は正しくても「先読み**警告**」の目的（上昇リスクの提示）に反するため出さない。

### 4-1c. 「何を伝えるか」をトーストと統計画面で共有する（★見え方のずれを構造的に防ぐ）

統計画面を `+1` 固定にすると、トースト（lookahead 先まで見る）と食い違う。§6 の経路では **完了 6 で「あと 2 セット」のトーストが出た直後に統計画面を開いても予測行が無い**（+1 = 13 = current で非表示）。段階制スコアでは「+1 では跨がないが +2 で跨ぐ」は普通に起きるため、`+1` 固定は予測行が出ない場面が多い。→ **判定を 1 つの純関数に寄せ、両者がそれを参照する**：

```ts
export type ForecastSummary =
  | { kind: 'reach'; k: number; threshold: number; levelLabel: string }   // lookahead 内に閾値到達
  | { kind: 'projection'; score: number }                                  // 到達しないが +1 で上昇
  | null;                                                                  // 表示なし（超過中 / 上昇なし）

export function describeForecast(stats: Statistics, threshold: number, lookahead: number): ForecastSummary {
  // 「現在」は関数内で 1 回だけ計算し、到達判定と上昇判定の両方でこれを使う。
  // §4-1a の不変条件下では stats.today.fatigueScore と同値だが、純関数として
  // 任意の stats（week 更新前など）を渡されても判定が食い違わないようにする。
  const current = estimateFatigueScore(stats);
  if (current >= threshold) { return null; }                      // 既に閾値以上（既存アラートの領分）
  const k = sessionsUntilThreshold(stats, threshold, lookahead);   // 0 は上で除外済み → 1..lookahead か null
  if (k !== null) { return { kind: 'reach', k, threshold, levelLabel: getFatigueLevel(threshold).label }; }
  const projected = projectFatigueScore(stats, 1);
  return projected > current ? { kind: 'projection', score: projected } : null;
}
```

- **トースト（§4-2）**: `kind === 'reach'` のときだけ通知（`projection` は通知しない＝閾値に届かない上昇で割り込まない）。表示用の「現在 {score}点」は引き続き `stats.today.fatigueScore`（§4-1a で同値）
- **統計画面（§4-4）**: `reach` → 「あと k セットで「{levelLabel}」（{threshold}点）」、`projection` → 「次のセット後の予測: {score}点」、`null` → 非表示
- 閾値・lookahead を共有するので追加設定は不要。`projected > current` の判定は `projection` 分岐に吸収され、表示ルールが単純になる
- `getFatigueLevel` は `utils.ts` にあるため `statistics.ts` から import する（既存の依存方向 `statistics → utils` と同じ）

### 4-2. 通知（`src/notifications.ts` に追加）

```ts
async checkAndNotifyFatigueForecast(stats: Statistics): Promise<void> {
  // ★ゲートは3つとも先頭で早期 return（先読みはサウンドを鳴らさないので、通知OFFなら状態も保存しない。§8 と整合）
  const alertCfg = getFatigueAlertConfig();          // enabled / threshold（既存アラートと共用）
  const fcCfg    = getFatigueForecastConfig();       // enabled / lookahead（新設・クランプ済み）
  if (!alertCfg.enabled || !fcCfg.enabled || !getNotificationConfig().enabled) { return; }

  const fc = describeForecast(stats, alertCfg.threshold, fcCfg.lookahead);   // §4-1c（統計画面と同じ判定）
  if (!fc || fc.kind !== 'reach') { return; }        // 到達しない / 既に超過（既存アラートの領分）/ 上昇のみ
  const k = fc.k;

  // 頻度制御（§4-3）: 同日・同じ残り数以上なら出さない。残りが減ったら出す
  const st = this.storage.getAlertState();
  const today = getTodayDateStr();
  if (st.lastForecastDate === today && st.lastForecastRemaining !== null
      && k >= st.lastForecastRemaining) { return; }
  await this.storage.saveAlertState({ ...st, lastForecastDate: today, lastForecastRemaining: k });

  const score = stats.today.fatigueScore;            // §4-1a により estimateFatigueScore(stats) と一致
  const when = k === 1 ? '次のセット' : `あと ${k} セット`;
  const sel = await vscode.window.showWarningMessage(
    `⚠️ このペースだと、${when}で「${fc.levelLabel}」（${fc.threshold}点）に達します（現在 ${score}点）`,
    '詳しい診断を受ける', '閉じる',
  );
  if (sel === '詳しい診断を受ける') { openDiagnosisPage('fatigue_forecast'); }
}
```

- 既存 `checkAndNotifyFatigueAlert`（`:111`）と**同じ構造・同じ storage**を使い、読み手が並べて理解できるようにする
- サウンドは鳴らさない（既存の `alert` 音は「到達」用。予告で鳴らすとうるさい）
- **既存アラートとの排他**: `describeForecast` が `null`（現在 ≥ 閾値）を返すときは出さない。よって完了時のトーストは**最大 2 つ**（完了通知 ＋ 既存アラート **または** 先読み）

**別トーストにする理由（完了トーストへの埋め込みとの比較）**
- 埋め込み案（`notifyWorkComplete` の 2 行目に先読み文言を足す）は**トースト数が増えず、頻度制御の状態も不要**という利点がある（lookahead=2 なら 1 日最大 2 回の表示で同等）
- それでも別トーストを選ぶ理由: ①完了トーストのボタン（「休憩する」「スキップ」）は**タイマー操作そのもの**で、先読みの CTA（「詳しい診断」）と混ぜると誤操作しやすい ②既存 `checkAndNotifyFatigueAlert` と**同じ作法**（別トースト・独立した頻度制御）で並ぶため、コードもテストも対称になる ③`notifyWorkComplete` は既存の重要経路で、改変せずに済む
- **フォールバック**: 公開後に「トーストが多い」というフィードバックが出たら、埋め込み案へ切り替える（§10）

### 4-3. 頻度制御の状態（`src/config.ts` の `AlertState` を拡張）

```ts
export interface AlertState {
  lastAlertDate: string | null;          // 既存
  lastAlertScore: number;                // 既存
  lastForecastDate: string | null;       // 追加: 先読みを最後に出した日
  lastForecastRemaining: number | null;  // 追加: そのときの残りセット数 k
}
```
- `createDefaultAlertState()`（`:193`）に `lastForecastDate: null, lastForecastRemaining: null` を追加
- **後方互換**: 既存ユーザーの保存済み `AlertState` には新フィールドが無い（`undefined`）。`Storage.getAlertState()` で既定値とマージして読む（`{ ...createDefaultAlertState(), ...saved }`）
- 通知ルール: 「**同日に同じ k 以上では出さない**」＝「あと2」→（1セット後）「次のセット」の**2回だけ**。同じ日に何度も同じ予告を繰り返さない。**裏返しとして「k が増えたら出さない」**: 中断率の希釈（§4-1b）で k が 1 → 2 に戻っても再通知しない（スパム防止として正しい挙動。非単調対策と整合）
- **★既存 `checkAndNotifyFatigueAlert` の修正が必須**（`notifications.ts:128-132`）: 現状はオブジェクトリテラルで `AlertState` を**全置換**しているため、そのままだと先読みの `lastForecastDate/Remaining` を**上書き消去**する。`{ ...alertState, lastAlertDate: today, lastAlertScore: fatigueScore }` のスプレッド更新に変更する。新フィールドを必須型にすればコンパイルエラーで検出できるが、§5 の変更一覧にも明記して見落とさない

### 4-4. 統計画面（`src/webview/statsViewProvider.ts`）

既存の「🧠 推定脳疲労スコア」セクション（`:325-327`）の直下に、**§4-1c の `describeForecast` の結果に応じて** 1 行追加：

| `describeForecast` | 表示 |
|---|---|
| `reach`（k=1） | `次のセットで「{levelLabel}」（{threshold}点）に達します` |
| `reach`（k≥2） | `あと {k} セットで「{levelLabel}」（{threshold}点）に達します` |
| `projection` | `次のセット後の予測: {score}点 {emoji} {label}`（色は既存 `getFatigueColor` `:370`） |
| `null` | 行を出さない（閾値超過中は現在スコア表示で十分／上昇なしは出さない） |

- **トーストと同じ判定・同じ文言**なので、「あと 2 セット」と警告された直後に統計画面を開いても同じ情報が見える（§6 確認①がそのまま成立）
- **`fatigueForecastEnabled` が ON のときのみ表示**（機能を OFF にしたら統計画面にも出さない＝ユーザーの明示的なオプトアウトを尊重）。ただし別機能の **`fatigueAlertEnabled` には依存させない**（閾値 `fatigueAlertThreshold` は値として共用するだけ）。`lookahead` / `threshold` は設定値をそのまま使う（既定 2 / 21）
> レビュー反映（当初は「設定に依存せず常時表示」としていたが、コードレビューで『機能名の設定を OFF にしたのに表示が残るのは驚き』と指摘され、`fatigueForecastEnabled` を尊重する方針に変更）
- HTML 生成は `describeForecast` の結果を文字列化するだけにし、**判定ロジックを WebView 側に持たない**（テストは純関数側で担保）

---

## 5. 既存コードへの統合ポイント

| ファイル | 変更 |
|---|---|
| `src/statistics.ts` | `projectFatigueScore` / `sessionsUntilThreshold` / **`describeForecast`（＋型 `ForecastSummary`）** を追加（純関数）。**`updateWeeklyStats` 末尾で `today.fatigueScore` を再計算**（§4-1a、既存バグ修正） |
| `src/config.ts` | `AlertState` に2フィールド追加、既定値追加（`createDefaultAlertState` `:193`）、`getFatigueForecastConfig()` 追加（**lookahead を 1〜4 にクランプ**。settings.json 直書きは UI の min/max を通らないため） |
| `src/storage.ts` | `getAlertState()` を既定値マージに（後方互換） |
| `src/notifications.ts` | `checkAndNotifyFatigueForecast(stats)` 追加。**既存 `checkAndNotifyFatigueAlert` の `saveAlertState` をスプレッド更新に修正**（§4-3、新フィールド消去の防止） |
| `src/extension.ts` | `handleWorkComplete`（`:368`）で `recordSession` の後、既存の `checkAndNotifyFatigueAlert`（`:388`）の**直後**に `checkAndNotifyFatigueForecast(stats)` を呼ぶ。stats は `recordSession` 後に `storage.getStatistics()` で取り直したもの（week 更新済み） |
| `src/webview/statsViewProvider.ts` | `describeForecast` の結果を文字列化して 1 行表示（§4-4 の表。判定は持たない。`getFatigueColor` `:370` 流用） |
| `package.json` + `package.nls*.json` | 設定2件（説明は英日両方）。`fatigueForecastLookahead` に `minimum: 1` / `maximum: 4` |
| `test/unit/statistics.test.ts` | 純関数の境界値テスト追加 |
| `test/unit/notifications.test.ts` | 頻度制御・ゲートのテスト追加 |
| `test/unit/config.test.ts` | `getFatigueForecastConfig` のクランプ（0→1、9→4）と既定値 |
| `test/unit/storage.test.ts` | `getAlertState` の後方互換マージ（新フィールド欠損 → `null`） |
| `docs/TESTING.md` / `CHANGELOG.md` | 手動手順・**Added**（先読み）＋ **Fixed**（`today.fatigueScore` が週セッション数を含まず古かった問題）＋ **Changed**（0 セットの日でも週・連続日数由来のスコアが表示される。§4-1a 副作用） |

**Timer は変更しない**（v1 は完了時トリガーのみ。F6 の `onWorkStart` は v2）。

---

## 6. 検証方法

1. **ユニット**（§8）で純関数・不変条件・頻度制御・境界値を網羅する。**精密な境界はユニットテストに任せ、手動は挙動の確認に絞る**
2. **手動**: クリーンな状態から閾値 15 に到達するには今日の加点だけで **12 セット**（+15）必要。**中断率と組み合わせた経路は「完了 7・中断 8」**（実作業 7 × 15 分 = 1 時間 45 分 **＋ 休憩 6 回**。スキップ率 0 を維持するには休憩を完了させる必要がある。`longBreakInterval` 既定 4 のため **4 セット目の後は長い休憩**になり、**短い休憩 5 回 ＋ 長い休憩 1 回 = 最小 25 分（3×5+10）〜既定 40 分（5×5+15）**。`longBreakInterval` を 8 に上げれば短い休憩 6 回で済む）。**より短いのは (a') の休憩全スキップ経路**（中断 4 件・休憩待ちなし）。**なお「1 時間 45 分」は完了 7（先読みトースト 2 回）までの時間。表の 3 行目「完了 8 で既存アラートに切替」まで観察するなら +1 セット = +15 分**（合計 2 時間、(a) なら休憩も 7 回）。以下のいずれかで再現する：
   - **(a) 中断で加点を稼ぐ（推奨・実コードで検算済み）**: `fatigueAlertThreshold=15`、`workDuration=15`、`fatigueForecastLookahead=2`。**中断 8 件を先に作り切ってから**作業を始める（`startTimer` → 直後に `resetTimer` を 8 回。`timer.reset()` は duration 0 分・`completed:false` のレコードを返し、`recordSession` が `interruptedSessions++` する。数秒で作れる）。休憩は毎回取る（スキップ率 0 を維持）。週セッション < 30・連続日数 < 5 のクリーンな状態が前提
     | 完了時点 | 中断率 | 今日の加点 | スコア | k（閾値15, lookahead 2） | 期待する表示 |
     |---|---|---|---|---|---|
     | 完了 6・中断 8 | 8/14 = 57% → +10 | +3 | **13** | 2 | **「あと 2 セット」**（先読み） |
     | 完了 7・中断 8 | 8/15 = 53% → +10 | +3 | **13** | 1 | **「次のセット」**（先読み。k が 2→1 に減ったので出る） |
     | 完了 8・中断 8 | 8/16 = 50% → +10 | +5 | **15** | 0 | 先読みは出ず**既存アラート**に切り替わる |
     - **注意**: 中断 8 件は **7 セット目の完了前に作り終える**こと。後から足すと中断率が変わって k が増える方向に動き、§4-3 の「k が増えたら出さない」に引っかかって期待どおりに観察できない
   - **(a') 休憩を全スキップして稼ぐ（最短・実コードで検算済み）**: 「休憩をスキップ」は `completed:true` の break レコードを残さないため（`skipBreak()` は `sessionStartTime = null` にしてから `startWork()` するのでレコード自体が作られない）、`calculateBreakSkipRate` が 1.0 → **+5 が定数で乗る**。これで中断は **4 件**で済み、休憩待ちも不要（実作業 1 時間 45 分のみ）。同じく中断 4 件は先に作り切る。**注意**: `autoStartBreak` 既定 ON のため完了 500 ms 後に休憩が自動開始する。完了トーストの「休憩をスキップ」または `skipBreak` コマンドで**毎回抜ける**こと（休憩を最後まで放置すると `completed:true` の break が記録され、スキップ率が下がって +5 が消える）
     | 完了時点 | 中断率 | 今日 | スキップ | スコア | k | 期待する表示 |
     |---|---|---|---|---|---|---|
     | 完了 6・中断 4 | 4/10 = 40% → +5 | +3 | +5 | **13** | 2 | 「あと 2 セット」 |
     | 完了 7・中断 4 | 4/11 = 36% → +5 | +3 | +5 | **13** | 1 | 「次のセット」 |
     | 完了 8・中断 4 | 4/12 = 33% → +5 | +5 | +5 | **15** | 0 | 既存アラートに切替 |
   - **(b) 週セッションが溜まった開発用プロファイル**で試す（週 ≥30 の加点が乗った状態から始める）
   - 確認は **2 点に絞る**: ①完了 6 で「あと 2 セット」のトーストが出て、**統計画面にも同じ文言**が出る（§4-1c）。完了 7 で「次のセット」に更新される ②同じ k で 2 回目は出ず、k が減ったら出る
   - 既に閾値超過のとき先読みが出ず、既存アラートだけ出ること
   - Focus DND ON でも完了時の通知が表示されること（F5）
   - **rollover 確認（§4-1a の副作用）**: 週セッションが溜まった状態で日付が変わった直後に統計画面を開き、0 セットでも `today.fatigueScore` が週・連続日数由来の値になっていること

---

## 7. エッジケース / リスクと対策

| 項目 | 内容 | 対策 |
|---|---|---|
| **通知過多** | 完了通知＋（既存アラート **または** 先読み）で**最大 2 トースト**（排他のため 3 にはならない） | 先読みは「現在 < 閾値」のときだけ（既存アラートと排他）。頻度制御で同日同 k は1回。サウンドなし。それでも多ければ埋め込み案へ（§4-2 フォールバック） |
| **「現在スコア」の 2 系統化**（F3・最重要） | `today.fatigueScore`（旧値）と `estimateFatigueScore(stats)`（新値）が食い違い、既存アラートも先読みも出ない隙間と表示の不一致が起きる | `updateWeeklyStats` 末尾で `today.fatigueScore` を再計算して**不変条件 `today.fatigueScore === estimateFatigueScore(stats)`** を成立させる（§4-1a）。テストで不変条件を担保。CHANGELOG Fixed |
| **week が古いまま予測**（F3） | `updateTodayStats` 直後の stats で計算すると `week.totalSessions` が旧値 | 呼び出し規約を明記し、`extension.ts` では `recordSession`（week 更新込み）後の stats を使う。テストで「week +k が反映される」を検証 |
| **予測が非単調**（F2） | 中断率の希釈で `+k` の予測が現在より下がり得る | 探索は最小 k を線形に求めるので正しい。表示は `describeForecast`（§4-1c）に従い、上昇しない `projection` は出さない |
| **rollover 直後の 0 セット日にスコアが 0 でなくなる**（§4-1a の副作用） | `viewStats`/`exportData` 経由の `updateWeeklyStats` が rollover 後に today を再計算し、週・連続日数・スキップ率の加点が乗る。`generateAdvices` の `score >= 21` 分岐も 0 セットで発火し得る | **意図した変更として採用**（疲労の持ち越し。`week.fatigueScore` は既に同じ値）。CHANGELOG に Changed として明記、§8 でテスト |
| **既存アラートが先読みの状態を消す** | `checkAndNotifyFatigueAlert` が `AlertState` を全置換 | スプレッド更新に修正（§4-3）。新フィールドを必須型にしてコンパイルで検出 |
| **Focus DND に消される**（F5） | 作業開始時に出すと抑制される | v1 は完了時のみ（DND 解除済み）。開始時トリガーは v2 で「DND 無効時のみ」等の条件付きで検討 |
| **既存 AlertState の後方互換** | 保存済みデータに新フィールドが無い | `getAlertState` で既定値マージ。`null` を「未通知」として扱う |
| **日付跨ぎ** | 「今日」の境界は **UTC**（`getTodayDateStr`）なので **JST では朝 9:00 に切り替わる**。8:50 に「次のセットで…」と出た直後にリセットされ得る | 既存仕様の帰結（週次バグ修正で UTC に統一済み）。先読みの日付キーも同じ関数を使い、既存アラートと**同じ境界**で揃える。ローカル日基準への変更は別課題 |
| **閾値をユーザーが下げた直後** | 現在スコアが即座に閾値以上になる | `describeForecast` が `null`（現在 ≥ 閾値）→ 先読みは出さず既存アラートに任せる（§4-1c の定義どおり） |
| **実行時文字列の l10n** | 新しい日本語文言が増える | [[marketplace-l10n-plan]] §10 の後続タスクの対象に追加。先に l10n が完了していれば `vscode.l10n.t` で書く |
| 「予測」の誤解 | 生理計測ではなくルールの先読み | 文言は「このペースだと」「推定」で統一し、README でも「作業ペースからの到達予告」と説明 |

---

## 8. テスト計画

### ユニット（`statistics.test.ts` / `notifications.test.ts`、既存の vscode モックで実行可）

**純関数**
- `projectFatigueScore(stats, 0)` は `estimateFatigueScore(stats)` と一致
- 今日 5 セット・週 29 → `+1` で今日 6（+3）・週 30（+3）＝ 両方の段階を同時に跨ぐケース
- 今日 0 セット → `+1` で連続日数に今日が加わる（`calculateConsecutiveDays` の分岐）
- 中断率: `interruptedSessions` 固定で `+k` すると率が下がり、加点が**減る**（過大警告しない）
- **元の stats を変更しない**（deep copy の検証）
- **非単調ケース**: 完了1・中断1（50% → +10）に `+1` すると 33% → +5 で予測が現在より**下がる**ことを確認（線形探索は影響を受けない）
- **不変条件（§4-1a）**: `updateWeeklyStats` 後に `today.fatigueScore === estimateFatigueScore(stats) === week.fatigueScore`。特に「今回のセッションで週の段階（30 等）を跨ぐ」ケースで today が週込みの値に更新される
- **rollover 直後（§4-1a 副作用）**: `today.date` を過去日にし週・連続日数の加点がある stats で `updateWeeklyStats` を呼ぶと、rollover 後の today（sessions 0）の `fatigueScore` が **0 ではなく週・連続日数由来の値**になる
- **`week.dailyStats` の today 行との整合**: `updateWeeklyStats` 後、`week.dailyStats` 内の today 行の `fatigueScore` が `today.fatigueScore` と一致する（同一オブジェクト参照の検証）
- `sessionsUntilThreshold`: 既に超過→0、lookahead 内で到達→最小 k、到達しない→null、lookahead=1 の境界
- **`describeForecast`（§4-1c）**: 超過中→`null`、lookahead 内到達→`reach{k, levelLabel}`（閾値 15 で `levelLabel` が「やや注意」になる）、到達せず +1 が上昇→`projection{score}`、到達せず +1 が横ばい/低下→`null`。**§6 の経路（完了 6/7/8）で `reach{k:2}`→`reach{k:1}`→`null` と推移する**

**通知・頻度制御**
- `fatigueForecastEnabled=false` / `fatigueAlertEnabled=false` / `notificationEnabled=false` → 通知なし（`saveAlertState` も呼ばない）
- k=2 で通知 → 同日 k=2 再度は**出ない** → k=1 になったら**出る**
- k=0（超過）→ 出ない
- 保存済み `AlertState` に新フィールドが無くても落ちない（後方互換）
- **既存アラートが先読みの状態を保持する**: `lastForecastDate/Remaining` を持つ状態で `checkAndNotifyFatigueAlert` を通しても消えない（スプレッド更新の検証）
- `lookahead` のクランプ: 0 → 1、9 → 4（`getFatigueForecastConfig` のテストなので **`config.test.ts`** に置く）
- **モック注意**: `notifications.test.ts` の既存 `createMockStorage` は `getAlertState: () => createDefaultAlertState()` で**毎回初期値を返す**ため、「k=2 → 同日 k=2 は出ない」の検証には `saveAlertState` で保持した値を `getAlertState` が返す**状態保持型のモック**が必要
- 「次のセット」/「あと N セット」の文言切替（k=1 / k≥2）

### 手動（`docs/TESTING.md` 追記）
§6 の手順

---

## 9. 実装ステップ

0. **順序判断**: 「実行時文字列の l10n 化」は**未完了**（`src` に `vscode.l10n.t` は未導入）→ 新文言は**日本語直書き**とし、後続タスクの対象一覧（Notion の説明欄）に本機能の文言を追記する
1. `statistics.ts`: **まず `updateWeeklyStats` 末尾の `today.fatigueScore` 再計算（§4-1a）＋不変条件テスト**（既存バグ修正・単独でも価値がある）。着手前に **既存の `updateWeeklyStats` テストが `today.fatigueScore` や `week.dailyStats` の today 行を固定値で比較していないか確認**する（再計算で上書きされて壊れるため。レビュー時点の grep では該当なし。`updateTodayStats` 単体のテスト `:364-371` は `updateWeeklyStats` を通さないので影響なし）。次に `projectFatigueScore` / `sessionsUntilThreshold` / **`describeForecast`** ＋ ユニットテスト（純関数から着手＝最もリスクが低い）。**ステップ 4（通知）と 6（統計画面）は両方 `describeForecast` に依存する**ので、ここで作り切っておく
2. `config.ts` / `storage.ts`: `AlertState` 拡張・既定値・後方互換マージ ＋ `getFatigueForecastConfig`（クランプ込み）。**`notifications.ts` の既存 `checkAndNotifyFatigueAlert` をスプレッド更新に修正**
3. `package.json` / `package.nls*.json`: 設定2件（nls 整合テストが通ることを確認）
4. `notifications.ts`: `checkAndNotifyFatigueForecast` ＋ 頻度制御テスト
5. `extension.ts`: `handleWorkComplete` に組み込み（既存アラートの直後）
6. `statsViewProvider.ts`: 予測行
7. `docs/TESTING.md` / `CHANGELOG.md`
8. 手動確認（閾値・作業時間を小さくして再現）→ PR

---

## 10. スコープ外（v2 候補）

- **作業開始時のトリガー**（F6 の `onWorkStart`）: DND との競合を解決してから。「DND 無効時のみ」「完了時に未通知だった場合のみ」等の条件付き
- **パターン検知**: 「連続4日目→明日で+5」「休憩スキップが増加傾向」など、セッション数以外の指標の先読み
- **推奨アクションの高度化**: 「長い休憩を今取る」「今日はここまで」を通知ボタンから直接実行（タイマー操作と連動）
- 予測の可視化（統計画面に「あと N セットの推移グラフ」）

---

## 11. 見積もり

| 区分 | 工数感 |
|---|---|
| 純関数＋テスト | 小 |
| 設定・状態・通知・配線 | 小〜中 |
| 統計画面 | 小 |
| 手動検証（閾値を下げて再現） | 小 |

コード変更は局所的で、**新しい推定モデルは作らず既存ルールを先読みするだけ**なので低リスク。肝は **F3（`today.fatigueScore` を 1 系統に統一＝既存バグ修正込み）** と **F5（完了時トリガーで DND を回避）** の2点。
