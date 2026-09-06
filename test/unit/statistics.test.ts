import './setup';

import * as assert from 'assert';
import {
  estimateFatigueScore,
  calculateConsecutiveDays,
  calculateInterruptionRate,
  calculateBreakSkipRate,
  rolloverDailyStats,
  updateTodayStats,
  updateWeeklyStats,
  exportToCSV,
  createMockStats,
  projectFatigueScore,
  sessionsUntilThreshold,
  describeForecast,
} from '../../src/statistics';
import {
  createDefaultStatistics,
  createDefaultDailyStats,
  SessionRecord,
  Statistics,
} from '../../src/config';
import { getTodayDateStr } from '../../src/utils';

// ============================================================
// テストヘルパー
// ============================================================

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    startTime: now,
    endTime: now,
    duration: 30,
    type: 'work',
    completed: true,
    ...overrides,
  };
}

function dateStrDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// ============================================================
// statistics ユニットテスト
// ============================================================

suite('statistics Unit Tests', () => {

  // ----------------------------------------------------------
  // estimateFatigueScore
  // ----------------------------------------------------------
  suite('estimateFatigueScore', () => {
    test('デフォルト（活動なし）は0点', () => {
      const stats = createDefaultStatistics();
      assert.strictEqual(estimateFatigueScore(stats), 0);
    });

    test('今日6セッションで +3点', () => {
      const stats = createMockStats({ sessions: 6 });
      assert.strictEqual(estimateFatigueScore(stats), 3);
    });

    test('今日8セッションで +5点', () => {
      const stats = createMockStats({ sessions: 8 });
      assert.strictEqual(estimateFatigueScore(stats), 5);
    });

    test('今日10セッションで +10点', () => {
      const stats = createMockStats({ sessions: 10 });
      assert.strictEqual(estimateFatigueScore(stats), 10);
    });

    test('今日12セッションで +15点', () => {
      const stats = createMockStats({ sessions: 12 });
      assert.strictEqual(estimateFatigueScore(stats), 15);
    });

    test('週60セッションで +15点', () => {
      const stats = createDefaultStatistics();
      stats.week.totalSessions = 60;
      assert.strictEqual(estimateFatigueScore(stats), 15);
    });

    test('連続7日作業で +10点', () => {
      const stats = createMockStats({ consecutiveDays: 7 });
      // 各日 sessions=1 なので今日のセッション加点(>=6)は無し → 連続日数分のみ
      assert.strictEqual(estimateFatigueScore(stats), 10);
    });

    test('連続5日作業で +5点', () => {
      const stats = createMockStats({ consecutiveDays: 5 });
      assert.strictEqual(estimateFatigueScore(stats), 5);
    });

    test('中断率0.5以上で +10点', () => {
      const stats = createDefaultStatistics();
      stats.today.sessions = 2;
      stats.today.interruptedSessions = 2; // rate = 0.5
      // sessions=2 は加点閾値(6)未満なので中断率分のみ
      assert.strictEqual(estimateFatigueScore(stats), 10);
    });

    test('スコアは最大45点でクランプされる', () => {
      const stats = createMockStats({ consecutiveDays: 7 });
      stats.today.sessions = 12;          // +15
      stats.week.totalSessions = 60;      // +15
      stats.today.interruptedSessions = 12; // rate >= 0.5 -> +10  (合計 15+15+10+10=50 -> clamp 45)
      assert.strictEqual(estimateFatigueScore(stats), 45);
    });
  });

  // ----------------------------------------------------------
  // calculateConsecutiveDays
  // ----------------------------------------------------------
  suite('calculateConsecutiveDays', () => {
    test('活動なしは0日', () => {
      const stats = createDefaultStatistics();
      assert.strictEqual(calculateConsecutiveDays(stats), 0);
    });

    test('今日のみ活動で1日', () => {
      const stats = createMockStats({ sessions: 3 });
      assert.strictEqual(calculateConsecutiveDays(stats), 1);
    });

    test('連続3日で3日', () => {
      const stats = createMockStats({ consecutiveDays: 3 });
      assert.strictEqual(calculateConsecutiveDays(stats), 3);
    });

    test('間に空白日があると連続が途切れる', () => {
      const stats = createDefaultStatistics();
      stats.today.date = getTodayDateStr();
      stats.today.sessions = 1;
      // 今日と2日前に活動があるが、昨日は無し
      stats.dailyStatsHistory.push({
        ...createDefaultDailyStats(dateStrDaysAgo(2)),
        sessions: 1,
      });
      assert.strictEqual(calculateConsecutiveDays(stats), 1, '昨日が空なので今日の1日のみ');
    });

    test('今日活動がなくても昨日からの連続を数える', () => {
      const stats = createDefaultStatistics();
      // 今日は活動なし、昨日・一昨日に活動
      stats.dailyStatsHistory.push({
        ...createDefaultDailyStats(dateStrDaysAgo(1)),
        sessions: 1,
      });
      stats.dailyStatsHistory.push({
        ...createDefaultDailyStats(dateStrDaysAgo(2)),
        sessions: 1,
      });
      assert.strictEqual(calculateConsecutiveDays(stats), 2);
    });

    test('history からも活動日を補完する', () => {
      const stats = createDefaultStatistics();
      stats.history.push(makeSession({
        type: 'work',
        completed: true,
        startTime: new Date().toISOString(),
      }));
      assert.strictEqual(calculateConsecutiveDays(stats), 1);
    });
  });

  // ----------------------------------------------------------
  // calculateInterruptionRate
  // ----------------------------------------------------------
  suite('calculateInterruptionRate', () => {
    test('活動なしは0', () => {
      const daily = createDefaultDailyStats(getTodayDateStr());
      assert.strictEqual(calculateInterruptionRate(daily), 0);
    });

    test('中断なしは0', () => {
      const daily = createDefaultDailyStats(getTodayDateStr());
      daily.sessions = 5;
      assert.strictEqual(calculateInterruptionRate(daily), 0);
    });

    test('完了2・中断2は0.5', () => {
      const daily = createDefaultDailyStats(getTodayDateStr());
      daily.sessions = 2;
      daily.interruptedSessions = 2;
      assert.strictEqual(calculateInterruptionRate(daily), 0.5);
    });

    test('全て中断は1.0', () => {
      const daily = createDefaultDailyStats(getTodayDateStr());
      daily.sessions = 0;
      daily.interruptedSessions = 3;
      assert.strictEqual(calculateInterruptionRate(daily), 1);
    });
  });

  // ----------------------------------------------------------
  // calculateBreakSkipRate
  // ----------------------------------------------------------
  suite('calculateBreakSkipRate', () => {
    test('履歴なしは0', () => {
      assert.strictEqual(calculateBreakSkipRate([]), 0);
    });

    test('休憩を全く取らないと1.0（全スキップ）', () => {
      const history: SessionRecord[] = [];
      for (let i = 0; i < 10; i++) {
        history.push(makeSession({ type: 'work', completed: true }));
      }
      assert.strictEqual(calculateBreakSkipRate(history), 1);
    });

    test('十分に休憩を取るとスキップ率0', () => {
      const history: SessionRecord[] = [];
      for (let i = 0; i < 10; i++) {
        history.push(makeSession({ type: 'work', completed: true }));
        history.push(makeSession({ type: 'break', completed: true }));
      }
      assert.strictEqual(calculateBreakSkipRate(history), 0);
    });

    test('7日より古いレコードは無視される', () => {
      const old = new Date();
      old.setDate(old.getDate() - 30);
      const history: SessionRecord[] = [];
      for (let i = 0; i < 10; i++) {
        history.push(makeSession({
          type: 'work',
          completed: true,
          startTime: old.toISOString(),
        }));
      }
      assert.strictEqual(calculateBreakSkipRate(history), 0, '古いレコードのみなら作業0扱い');
    });
  });

  // ----------------------------------------------------------
  // rolloverDailyStats
  // ----------------------------------------------------------
  suite('rolloverDailyStats', () => {
    test('today が当日なら何も変更しない', () => {
      const stats = createDefaultStatistics();
      stats.today.sessions = 3;
      const before = JSON.stringify(stats);
      rolloverDailyStats(stats);
      assert.strictEqual(JSON.stringify(stats), before);
    });

    test('日付が古く活動があれば履歴へ退避し today をリセット', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2026-02-28';
      stats.today.sessions = 1;
      stats.today.totalFocusTime = 15;
      stats.today.fatigueScore = 5;

      rolloverDailyStats(stats);

      assert.ok(
        stats.dailyStatsHistory.some((d) => d.date === '2026-02-28' && d.sessions === 1),
        '古い today が履歴へ退避されるべき',
      );
      assert.strictEqual(stats.today.date, getTodayDateStr(), 'today は当日に更新される');
      assert.strictEqual(stats.today.sessions, 0, 'today のセット数は0にリセットされる');
      assert.strictEqual(stats.today.totalFocusTime, 0);
      assert.strictEqual(stats.today.fatigueScore, 0);
    });

    test('日付が古く活動がなければ履歴へ退避せず today だけリセット', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2026-02-28';
      // sessions も interruptedSessions も 0

      rolloverDailyStats(stats);

      assert.strictEqual(stats.dailyStatsHistory.length, 0, '空の日は履歴に残さない');
      assert.strictEqual(stats.today.date, getTodayDateStr());
    });

    test('中断のみの日も履歴へ退避される', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2026-02-28';
      stats.today.interruptedSessions = 2;

      rolloverDailyStats(stats);

      assert.ok(stats.dailyStatsHistory.some((d) => d.date === '2026-02-28'));
    });
  });

  // ----------------------------------------------------------
  // 回帰テスト: 古い today が当日として表示されるバグ
  // ----------------------------------------------------------
  suite('回帰: 日付跨ぎ後の today 表示', () => {
    test('updateWeeklyStats は古い today をロールオーバーする', () => {
      // 再現: 2026-02-28 に完了した1セッションが today に残ったまま、
      // 別日に統計を開いた（= updateWeeklyStats を呼んだ）状況
      const stats = createDefaultStatistics();
      stats.today.date = '2026-02-28';
      stats.today.sessions = 1;
      stats.today.totalFocusTime = 15;

      const updated = updateWeeklyStats(stats);

      // 「今日の記録」に使われる today が当日0セットにリセットされていること
      assert.strictEqual(updated.today.date, getTodayDateStr());
      assert.strictEqual(updated.today.sessions, 0, '開始しただけの当日は0セットであるべき');
      // 過去分は履歴に残る
      assert.ok(updated.dailyStatsHistory.some((d) => d.date === '2026-02-28'));
    });

    test('exportToCSV も当日分は0で出力される（updateWeeklyStats経由）', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2026-02-28';
      stats.today.sessions = 1;

      const updated = updateWeeklyStats(stats);
      const csv = exportToCSV(updated, 'all');
      const todayLine = csv
        .split('\n')
        .find((line) => line.startsWith(getTodayDateStr()));
      assert.ok(todayLine, '当日行が存在する');
      assert.strictEqual(todayLine, `${getTodayDateStr()},0,0,0,0,0`);
    });
  });

  // ----------------------------------------------------------
  // updateTodayStats
  // ----------------------------------------------------------
  suite('updateTodayStats', () => {
    test('完了した作業セッションがカウントされる', () => {
      const stats = createDefaultStatistics();
      const updated = updateTodayStats(stats, makeSession({ type: 'work', completed: true, duration: 30 }));
      assert.strictEqual(updated.today.sessions, 1);
      assert.strictEqual(updated.today.totalFocusTime, 30);
      assert.strictEqual(updated.allTime.totalSessions, 1);
      assert.strictEqual(updated.allTime.totalFocusTime, 30);
    });

    test('中断した作業セッションは interruptedSessions に計上される', () => {
      const stats = createDefaultStatistics();
      const updated = updateTodayStats(stats, makeSession({ type: 'work', completed: false }));
      assert.strictEqual(updated.today.sessions, 0);
      assert.strictEqual(updated.today.interruptedSessions, 1);
      assert.strictEqual(updated.allTime.totalSessions, 0);
    });

    test('完了した休憩は totalBreakTime に計上される', () => {
      const stats = createDefaultStatistics();
      const updated = updateTodayStats(stats, makeSession({ type: 'break', completed: true, duration: 5 }));
      assert.strictEqual(updated.today.totalBreakTime, 5);
      assert.strictEqual(updated.today.sessions, 0);
    });

    test('セッションが history に追加される', () => {
      const stats = createDefaultStatistics();
      const updated = updateTodayStats(stats, makeSession());
      assert.strictEqual(updated.history.length, 1);
    });

    test('fatigueScore が再計算される', () => {
      let stats = createDefaultStatistics();
      for (let i = 0; i < 6; i++) {
        stats = updateTodayStats(stats, makeSession({ type: 'work', completed: true }));
      }
      // 6セッション完了(+3) かつ 休憩を1回も取っていない(スキップ率1.0 -> +5) = 8点
      assert.strictEqual(stats.today.fatigueScore, 8);
    });

    test('日付が変わると前日分が dailyStatsHistory に退避される', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2020-01-01';
      stats.today.sessions = 5;
      const updated = updateTodayStats(stats, makeSession({ type: 'work', completed: true }));

      assert.ok(
        updated.dailyStatsHistory.some((d) => d.date === '2020-01-01'),
        '前日分が履歴に退避されるべき',
      );
      assert.strictEqual(updated.today.date, getTodayDateStr(), '今日の日付に更新される');
      assert.strictEqual(updated.today.sessions, 1, '新しい日のカウントは1から');
    });
  });

  // ----------------------------------------------------------
  // updateWeeklyStats
  // ----------------------------------------------------------
  suite('updateWeeklyStats', () => {
    test('週統計は7日分の dailyStats を持つ', () => {
      const stats = createDefaultStatistics();
      const updated = updateWeeklyStats(stats);
      assert.strictEqual(updated.week.dailyStats.length, 7);
    });

    test('今日のセッションが週合計に反映される', () => {
      const stats = createDefaultStatistics();
      stats.today.sessions = 4;
      stats.today.totalFocusTime = 120;
      const updated = updateWeeklyStats(stats);
      assert.strictEqual(updated.week.totalSessions, 4);
      assert.strictEqual(updated.week.totalFocusTime, 120);
    });

    test('dailyAverage は totalSessions/7 の小数1桁', () => {
      const stats = createDefaultStatistics();
      stats.today.sessions = 7;
      const updated = updateWeeklyStats(stats);
      assert.strictEqual(updated.week.dailyAverage, 1.0);
    });

    test('weekStart と weekEnd が YYYY-MM-DD 形式で設定される', () => {
      const stats = createDefaultStatistics();
      const updated = updateWeeklyStats(stats);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(updated.week.weekStart));
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(updated.week.weekEnd));
    });
  });

  // ----------------------------------------------------------
  // exportToCSV
  // ----------------------------------------------------------
  suite('exportToCSV', () => {
    test('ヘッダー行が含まれる', () => {
      const stats = createDefaultStatistics();
      const csv = exportToCSV(stats, 'all');
      const firstLine = csv.split('\n')[0];
      assert.strictEqual(
        firstLine,
        'Date,Sessions,Focus Time (min),Break Time (min),Interrupted,Fatigue Score',
      );
    });

    test('all範囲: 履歴+今日が出力される', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2024-06-06';
      stats.today.sessions = 3;
      stats.dailyStatsHistory.push({
        ...createDefaultDailyStats('2024-06-05'),
        sessions: 2,
      });
      const csv = exportToCSV(stats, 'all');
      const lines = csv.split('\n');
      assert.strictEqual(lines.length, 3, 'ヘッダー + 2日分');
      // 日付昇順でソートされている
      assert.ok(lines[1].startsWith('2024-06-05'));
      assert.ok(lines[2].startsWith('2024-06-06'));
    });

    test('データ行に各フィールドが正しく出力される', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2024-06-06';
      stats.today.sessions = 3;
      stats.today.totalFocusTime = 90;
      stats.today.totalBreakTime = 15;
      stats.today.interruptedSessions = 1;
      stats.today.fatigueScore = 12;
      const csv = exportToCSV(stats, 'all');
      const lines = csv.split('\n');
      assert.strictEqual(lines[1], '2024-06-06,3,90,15,1,12');
    });

    test('week範囲は week.dailyStats を使用する', () => {
      const stats = createDefaultStatistics();
      stats.week.dailyStats = [
        createDefaultDailyStats('2024-06-03'),
        createDefaultDailyStats('2024-06-04'),
      ];
      const csv = exportToCSV(stats, 'week');
      const lines = csv.split('\n');
      assert.strictEqual(lines.length, 3, 'ヘッダー + 2日分');
    });
  });

  // ----------------------------------------------------------
  // createMockStats
  // ----------------------------------------------------------
  suite('createMockStats', () => {
    test('sessions オーバーライドが反映される', () => {
      const stats = createMockStats({ sessions: 9 });
      assert.strictEqual(stats.today.sessions, 9);
    });

    test('consecutiveDays で履歴日数が生成される', () => {
      const stats = createMockStats({ consecutiveDays: 4 });
      // 今日 + 3日分の履歴
      assert.strictEqual(stats.dailyStatsHistory.length, 3);
    });

    test('引数なしでデフォルト統計を返す', () => {
      const stats: Statistics = createMockStats();
      assert.strictEqual(stats.today.sessions, 0);
      assert.strictEqual(stats.history.length, 0);
    });
  });
});

// ============================================================
// 脳疲労スコアの先読み（docs/fatigue-forecast-plan.md §8）
// ============================================================

/**
 * 今日 sessions 完了・interrupted 中断、履歴に completed の work/break を積んだ stats。
 * breaks を work と同数にすると休憩スキップ率が 0 になる（スキップ加点なし）。
 */
function forecastStats(sessions: number, interrupted: number, breaks: number): Statistics {
  const stats = createDefaultStatistics();
  stats.today.sessions = sessions;
  stats.today.interruptedSessions = interrupted;
  const now = new Date().toISOString();
  for (let i = 0; i < sessions; i++) {
    stats.history.push(makeSession({ id: `w${i}`, type: 'work', completed: true, startTime: now, endTime: now }));
  }
  for (let i = 0; i < breaks; i++) {
    stats.history.push(makeSession({ id: `b${i}`, type: 'break', completed: true, startTime: now, endTime: now }));
  }
  return stats;
}

suite('脳疲労スコアの先読み', () => {

  suite('updateWeeklyStats の不変条件（§4-1a）', () => {
    test('updateWeeklyStats 後は today.fatigueScore === estimateFatigueScore(stats) === week.fatigueScore', () => {
      const stats = createDefaultStatistics();
      stats.today.sessions = 4;
      const updated = updateWeeklyStats(stats);
      assert.strictEqual(updated.today.fatigueScore, estimateFatigueScore(updated));
      assert.strictEqual(updated.today.fatigueScore, updated.week.fatigueScore);
    });

    test('週の段階を跨ぐセッションで today が週込みの値に更新される（既存バグ修正）', () => {
      // updateTodayStats 時点では week.totalSessions が 0 のため週の加点が乗らない
      const stats = createDefaultStatistics();
      stats.today.sessions = 29;
      updateTodayStats(stats, makeSession({ type: 'work', completed: true }));
      const before = stats.today.fatigueScore;     // 今日30(+15) + スキップ率(+5) = 20、週の加点なし
      const updated = updateWeeklyStats(stats);   // 週30 → +3 が乗る
      assert.ok(updated.today.fatigueScore > before, '週の加点が today に反映されるべき');
      assert.strictEqual(updated.today.fatigueScore, estimateFatigueScore(updated));
    });

    test('week.dailyStats 内の today 行も同じ fatigueScore になる', () => {
      const stats = createDefaultStatistics();
      stats.today.sessions = 6;
      const updated = updateWeeklyStats(stats);
      const todayRow = updated.week.dailyStats.find((d) => d.date === updated.today.date);
      assert.ok(todayRow, 'today 行が week.dailyStats に存在する');
      assert.strictEqual(todayRow!.fatigueScore, updated.today.fatigueScore);
    });

    test('rollover 直後（sessions 0）でも履歴由来の加点が today.fatigueScore に乗る（§4-1a 副作用）', () => {
      const stats = createDefaultStatistics();
      stats.today.date = '2026-02-28';
      stats.today.sessions = 1;
      // 直近7日の completed work が 1 件・break 0 件 → 休憩スキップ率 1.0 → +5
      const now = new Date().toISOString();
      stats.history.push(makeSession({ type: 'work', completed: true, startTime: now, endTime: now }));
      const updated = updateWeeklyStats(stats);
      assert.strictEqual(updated.today.sessions, 0, 'rollover で今日は 0 セット');
      assert.strictEqual(updated.today.fatigueScore, 5, '週・履歴由来の加点（スキップ率 +5）が乗る');
    });
  });

  suite('projectFatigueScore', () => {
    test('extra=0 は estimateFatigueScore と一致', () => {
      const stats = forecastStats(6, 8, 6);
      assert.strictEqual(projectFatigueScore(stats, 0), estimateFatigueScore(stats));
    });

    test('元の stats を変更しない（deep copy）', () => {
      const stats = forecastStats(5, 0, 5);
      const before = JSON.stringify(stats);
      projectFatigueScore(stats, 2);
      assert.strictEqual(JSON.stringify(stats), before);
    });

    test('今日と週の段階を同時に跨ぐ（今日 5→6 で +3、週 29→30 で +3）', () => {
      const stats = forecastStats(5, 0, 5);
      stats.week.totalSessions = 29;
      const current = estimateFatigueScore(stats);      // 今日5(0) + 週29(0) = 0
      const projected = projectFatigueScore(stats, 1);  // 今日6(+3) + 週30(+3) = 6
      assert.strictEqual(current, 0);
      assert.strictEqual(projected, 6);
    });

    test('今日 0 セットから +1 で連続日数に今日が加わる', () => {
      // 昨日まで 4 日連続 → 今日を足すと 5 日連続で +5
      const stats = createMockStats({ consecutiveDays: 5 });
      stats.today.sessions = 0;                          // 今日はまだ 0 セット
      const current = estimateFatigueScore(stats);      // 連続は昨日から4日 → 0
      const projected = projectFatigueScore(stats, 1);  // 今日が加わり5日 → +5
      assert.strictEqual(current, 0);
      assert.strictEqual(projected, 5);
    });

    test('非単調: 中断率の希釈で予測が現在より下がる', () => {
      const stats = forecastStats(1, 1, 1);             // 1/2 = 50% → +10
      const current = estimateFatigueScore(stats);
      const projected = projectFatigueScore(stats, 1);  // 1/3 = 33% → +5
      assert.strictEqual(current, 10);
      assert.strictEqual(projected, 5);
    });
  });

  suite('sessionsUntilThreshold', () => {
    test('既に閾値以上なら 0', () => {
      assert.strictEqual(sessionsUntilThreshold(forecastStats(8, 8, 8), 15, 2), 0);
    });
    test('lookahead 内で到達するなら最小の k', () => {
      assert.strictEqual(sessionsUntilThreshold(forecastStats(6, 8, 6), 15, 2), 2);
      assert.strictEqual(sessionsUntilThreshold(forecastStats(7, 8, 7), 15, 2), 1);
    });
    test('lookahead 内に到達しなければ null', () => {
      assert.strictEqual(sessionsUntilThreshold(forecastStats(6, 8, 6), 15, 1), null);
      assert.strictEqual(sessionsUntilThreshold(forecastStats(0, 0, 0), 15, 4), null);
    });
  });

  suite('describeForecast（§4-1c）', () => {
    test('§6 の経路: 完了 6/7/8（中断 8）で reach{2} → reach{1} → null と推移する', () => {
      const r6 = describeForecast(forecastStats(6, 8, 6), 15, 2);
      const r7 = describeForecast(forecastStats(7, 8, 7), 15, 2);
      const r8 = describeForecast(forecastStats(8, 8, 8), 15, 2);
      assert.deepStrictEqual(r6, { kind: 'reach', k: 2, threshold: 15, levelLabel: 'やや注意' });
      assert.deepStrictEqual(r7, { kind: 'reach', k: 1, threshold: 15, levelLabel: 'やや注意' });
      assert.strictEqual(r8, null, '閾値以上は既存アラートの領分');
    });

    test('閾値 21 では levelLabel が「警戒」', () => {
      // 今日 9(+5) + 週 59(+10) = 現在 15、+1 で 今日 10(+10) + 週 60(+15) = 25 ≥ 21 → k=1
      const stats = forecastStats(9, 0, 5);
      stats.week.totalSessions = 59;
      const r = describeForecast(stats, 21, 2);
      assert.deepStrictEqual(r, { kind: 'reach', k: 1, threshold: 21, levelLabel: '警戒' });
    });

    test('到達しないが +1 で上昇する場合は projection', () => {
      const stats = forecastStats(5, 0, 5);              // 現在 0、+1 で今日6 → +3
      assert.deepStrictEqual(describeForecast(stats, 30, 1), { kind: 'projection', score: 3 });
    });

    test('到達せず +1 でも上昇しない場合は null', () => {
      const stats = forecastStats(1, 0, 1);              // 現在 0、+1 で今日2 → 0
      assert.strictEqual(describeForecast(stats, 30, 1), null);
    });

    test('到達せず +1 で下がる場合も null（非単調）', () => {
      const stats = forecastStats(1, 1, 1);              // 現在 10、+1 で 5
      assert.strictEqual(describeForecast(stats, 30, 1), null);
    });
  });
});
