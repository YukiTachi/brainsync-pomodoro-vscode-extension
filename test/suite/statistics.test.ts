import * as assert from 'assert';
import {
  estimateFatigueScore,
  calculateConsecutiveDays,
  calculateInterruptionRate,
  calculateBreakSkipRate,
  updateTodayStats,
  updateWeeklyStats,
  exportToCSV,
  createMockStats,
} from '../../src/statistics';
import {
  Statistics,
  DailyStats,
  SessionRecord,
  createDefaultStatistics,
  createDefaultDailyStats,
} from '../../src/config';
import { generateUUID, getTodayDateStr } from '../../src/utils';

suite('Statistics Test Suite', () => {

  // ============================================================
  // estimateFatigueScore
  // ============================================================

  suite('estimateFatigueScore', () => {
    test('デフォルト統計ではスコアが0', () => {
      const stats = createDefaultStatistics();
      const score = estimateFatigueScore(stats);
      assert.strictEqual(score, 0);
    });

    test('セッション数6でスコアが3', () => {
      const stats = createMockStats({ sessions: 6 });
      // 週次統計はデフォルト（0セッション）なので今日のスコアのみ
      const score = estimateFatigueScore(stats);
      assert.strictEqual(score, 3);
    });

    test('セッション数8でスコアが5', () => {
      const stats = createMockStats({ sessions: 8 });
      const score = estimateFatigueScore(stats);
      assert.strictEqual(score, 5);
    });

    test('セッション数10でスコアが10', () => {
      const stats = createMockStats({ sessions: 10 });
      const score = estimateFatigueScore(stats);
      assert.strictEqual(score, 10);
    });

    test('セッション数12でスコアが15', () => {
      const stats = createMockStats({ sessions: 12 });
      const score = estimateFatigueScore(stats);
      assert.strictEqual(score, 15);
    });

    test('スコアは0-45の範囲', () => {
      const stats = createMockStats({ sessions: 15 });
      stats.week.totalSessions = 70;
      stats.today.interruptedSessions = 20;
      const score = estimateFatigueScore(stats);
      assert.ok(score >= 0, `Score ${score} should be >= 0`);
      assert.ok(score <= 45, `Score ${score} should be <= 45`);
    });

    test('連続7日作業でスコアに10点加算', () => {
      const stats = createMockStats({ consecutiveDays: 7 });
      const score = estimateFatigueScore(stats);
      assert.ok(score >= 10, `Score ${score} should be >= 10 for 7 consecutive days`);
    });

    test('連続5日作業でスコアに5点加算', () => {
      const stats = createMockStats({ consecutiveDays: 5 });
      const score = estimateFatigueScore(stats);
      assert.ok(score >= 5, `Score ${score} should be >= 5 for 5 consecutive days`);
    });
  });

  // ============================================================
  // calculateInterruptionRate
  // ============================================================

  suite('calculateInterruptionRate', () => {
    test('セッションなしの場合は0', () => {
      const daily = createDefaultDailyStats(getTodayDateStr());
      assert.strictEqual(calculateInterruptionRate(daily), 0);
    });

    test('中断なしの場合は0', () => {
      const daily = createDefaultDailyStats(getTodayDateStr());
      daily.sessions = 5;
      daily.interruptedSessions = 0;
      assert.strictEqual(calculateInterruptionRate(daily), 0);
    });

    test('50%中断の場合は0.5', () => {
      const daily = createDefaultDailyStats(getTodayDateStr());
      daily.sessions = 5;
      daily.interruptedSessions = 5;
      assert.strictEqual(calculateInterruptionRate(daily), 0.5);
    });
  });

  // ============================================================
  // calculateBreakSkipRate
  // ============================================================

  suite('calculateBreakSkipRate', () => {
    test('履歴なしの場合は0', () => {
      assert.strictEqual(calculateBreakSkipRate([]), 0);
    });

    test('作業と休憩が同数の場合はスキップ率が低い', () => {
      const now = new Date();
      const history: SessionRecord[] = [];
      for (let i = 0; i < 5; i++) {
        const time = new Date(now.getTime() - i * 3600000).toISOString();
        history.push({
          id: generateUUID(),
          startTime: time,
          endTime: time,
          duration: 30,
          type: 'work',
          completed: true,
        });
        history.push({
          id: generateUUID(),
          startTime: time,
          endTime: time,
          duration: 5,
          type: 'break',
          completed: true,
        });
      }
      const rate = calculateBreakSkipRate(history);
      assert.ok(rate < 0.2, `Skip rate ${rate} should be < 0.2`);
    });
  });

  // ============================================================
  // updateTodayStats
  // ============================================================

  suite('updateTodayStats', () => {
    test('作業セッション完了で統計が更新される', () => {
      let stats = createDefaultStatistics();
      const session: SessionRecord = {
        id: generateUUID(),
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 30,
        type: 'work',
        completed: true,
      };

      stats = updateTodayStats(stats, session);

      assert.strictEqual(stats.today.sessions, 1);
      assert.strictEqual(stats.today.totalFocusTime, 30);
      assert.strictEqual(stats.allTime.totalSessions, 1);
      assert.strictEqual(stats.history.length, 1);
    });

    test('中断された作業セッションでinterruptedSessionsが増加', () => {
      let stats = createDefaultStatistics();
      const session: SessionRecord = {
        id: generateUUID(),
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 15,
        type: 'work',
        completed: false,
      };

      stats = updateTodayStats(stats, session);

      assert.strictEqual(stats.today.sessions, 0);
      assert.strictEqual(stats.today.interruptedSessions, 1);
    });

    test('休憩セッション完了でbreakTimeが加算', () => {
      let stats = createDefaultStatistics();
      const session: SessionRecord = {
        id: generateUUID(),
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 5,
        type: 'break',
        completed: true,
      };

      stats = updateTodayStats(stats, session);

      assert.strictEqual(stats.today.totalBreakTime, 5);
    });
  });

  // ============================================================
  // exportToCSV
  // ============================================================

  suite('exportToCSV', () => {
    test('ヘッダー行が正しい', () => {
      const stats = createDefaultStatistics();
      stats.week = {
        weekStart: '2026-02-09',
        weekEnd: '2026-02-15',
        totalSessions: 0,
        totalFocusTime: 0,
        dailyAverage: 0,
        fatigueScore: 0,
        dailyStats: [stats.today],
      };
      const csv = exportToCSV(stats, 'week');
      const lines = csv.split('\n');
      assert.strictEqual(
        lines[0],
        'Date,Sessions,Focus Time (min),Break Time (min),Interrupted,Fatigue Score'
      );
    });

    test('全期間エクスポートにtodayが含まれる', () => {
      const stats = createDefaultStatistics();
      const csv = exportToCSV(stats, 'all');
      const lines = csv.split('\n');
      assert.ok(lines.length >= 2, 'Should have header + at least 1 data row');
    });
  });

  // ============================================================
  // updateWeeklyStats
  // ============================================================

  suite('updateWeeklyStats', () => {
    test('週次統計が正しく集計される', () => {
      let stats = createDefaultStatistics();
      stats.today.sessions = 3;
      stats.today.totalFocusTime = 90;

      stats = updateWeeklyStats(stats);

      assert.ok(stats.week.weekStart, 'weekStart should be set');
      assert.ok(stats.week.weekEnd, 'weekEnd should be set');
      assert.ok(stats.week.dailyStats.length === 7, 'Should have 7 daily stats');
      assert.ok(stats.week.totalSessions >= 3, `Total sessions ${stats.week.totalSessions} should be >= 3`);
    });
  });
});
