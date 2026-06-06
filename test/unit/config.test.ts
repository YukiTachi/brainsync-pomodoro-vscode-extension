import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig } from './mocks/vscode';
import {
  createDefaultTimerData,
  createDefaultDailyStats,
  createDefaultWeeklyStats,
  createDefaultStatistics,
  createDefaultAlertState,
  getTimerConfig,
  getNotificationConfig,
  getFatigueAlertConfig,
} from '../../src/config';

// ============================================================
// config ユニットテスト
// ============================================================

suite('config Unit Tests', () => {

  teardown(() => {
    _resetConfig();
  });

  // ----------------------------------------------------------
  // デフォルトファクトリ
  // ----------------------------------------------------------
  suite('デフォルトファクトリ', () => {
    test('createDefaultTimerData は idle / setIndex=1', () => {
      const data = createDefaultTimerData();
      assert.strictEqual(data.state, 'idle');
      assert.strictEqual(data.previousState, null);
      assert.strictEqual(data.remainingTime, 0);
      assert.strictEqual(data.currentSetIndex, 1);
      assert.strictEqual(data.startTimestamp, null);
      assert.strictEqual(data.pausedAt, null);
      assert.strictEqual(data.totalDuration, 0);
    });

    test('createDefaultDailyStats は全カウント0で日付を保持', () => {
      const daily = createDefaultDailyStats('2024-06-06');
      assert.strictEqual(daily.date, '2024-06-06');
      assert.strictEqual(daily.sessions, 0);
      assert.strictEqual(daily.totalFocusTime, 0);
      assert.strictEqual(daily.totalBreakTime, 0);
      assert.strictEqual(daily.interruptedSessions, 0);
      assert.strictEqual(daily.fatigueScore, 0);
    });

    test('createDefaultWeeklyStats は空の週統計', () => {
      const week = createDefaultWeeklyStats();
      assert.strictEqual(week.totalSessions, 0);
      assert.strictEqual(week.totalFocusTime, 0);
      assert.strictEqual(week.dailyAverage, 0);
      assert.deepStrictEqual(week.dailyStats, []);
    });

    test('createDefaultStatistics は今日の日付で初期化される', () => {
      const stats = createDefaultStatistics();
      const today = new Date().toISOString().split('T')[0];
      assert.strictEqual(stats.today.date, today);
      assert.strictEqual(stats.allTime.startDate, today);
      assert.strictEqual(stats.allTime.totalSessions, 0);
      assert.deepStrictEqual(stats.history, []);
      assert.deepStrictEqual(stats.dailyStatsHistory, []);
    });

    test('createDefaultAlertState は未通知状態', () => {
      const alert = createDefaultAlertState();
      assert.strictEqual(alert.lastAlertDate, null);
      assert.strictEqual(alert.lastAlertScore, 0);
    });
  });

  // ----------------------------------------------------------
  // getTimerConfig
  // ----------------------------------------------------------
  suite('getTimerConfig', () => {
    test('設定未指定時はデフォルト値を返す', () => {
      _resetConfig();
      const config = getTimerConfig();
      assert.strictEqual(config.workDuration, 30);
      assert.strictEqual(config.shortBreak, 5);
      assert.strictEqual(config.longBreak, 15);
      assert.strictEqual(config.longBreakInterval, 4);
      assert.strictEqual(config.autoStartBreak, true);
      assert.strictEqual(config.autoStartWork, false);
    });

    test('設定値が反映される', () => {
      _setConfig({
        workDuration: 45,
        shortBreak: 8,
        longBreak: 20,
        longBreakInterval: 3,
        autoStartBreak: false,
        autoStartWork: true,
      });
      const config = getTimerConfig();
      assert.strictEqual(config.workDuration, 45);
      assert.strictEqual(config.shortBreak, 8);
      assert.strictEqual(config.longBreak, 20);
      assert.strictEqual(config.longBreakInterval, 3);
      assert.strictEqual(config.autoStartBreak, false);
      assert.strictEqual(config.autoStartWork, true);
    });
  });

  // ----------------------------------------------------------
  // getNotificationConfig
  // ----------------------------------------------------------
  suite('getNotificationConfig', () => {
    test('デフォルト値を返す', () => {
      _resetConfig();
      const config = getNotificationConfig();
      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.soundEnabled, true);
      assert.strictEqual(config.soundVolume, 50);
      assert.strictEqual(config.soundFile, 'bell');
    });

    test('設定値が反映される', () => {
      _setConfig({
        notificationEnabled: false,
        soundEnabled: false,
        soundVolume: 80,
        soundFile: 'chime',
      });
      const config = getNotificationConfig();
      assert.strictEqual(config.enabled, false);
      assert.strictEqual(config.soundEnabled, false);
      assert.strictEqual(config.soundVolume, 80);
      assert.strictEqual(config.soundFile, 'chime');
    });
  });

  // ----------------------------------------------------------
  // getFatigueAlertConfig
  // ----------------------------------------------------------
  suite('getFatigueAlertConfig', () => {
    test('デフォルト値を返す', () => {
      _resetConfig();
      const config = getFatigueAlertConfig();
      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.threshold, 21);
    });

    test('設定値が反映される', () => {
      _setConfig({
        fatigueAlertEnabled: false,
        fatigueAlertThreshold: 28,
      });
      const config = getFatigueAlertConfig();
      assert.strictEqual(config.enabled, false);
      assert.strictEqual(config.threshold, 28);
    });
  });
});
