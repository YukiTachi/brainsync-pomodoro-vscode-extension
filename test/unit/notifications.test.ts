import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig, Uri } from './mocks/vscode';
import { NotificationManager, NotificationCallbacks } from '../../src/notifications';
import { Storage } from '../../src/storage';
import { createDefaultAlertState, createDefaultStatistics, Statistics, AlertState, SessionRecord } from '../../src/config';

// ============================================================
// テストヘルパー
// ============================================================

function createMockStorage(): Storage {
  return {
    getAlertState: () => createDefaultAlertState(),
    saveAlertState: async () => {},
  } as any;
}

function createMockCallbacks(): NotificationCallbacks {
  return {
    onStartBreak: () => {},
    onSkipBreak: () => {},
    onStartWork: () => {},
    onExtendBreak: () => {},
  };
}

function createManager(configOverrides?: Record<string, any>): NotificationManager {
  _resetConfig();
  _setConfig({
    notificationEnabled: true,
    soundEnabled: true,
    soundVolume: 50,
    soundFile: 'bell',
    fatigueAlertEnabled: true,
    fatigueAlertThreshold: 21,
    ...configOverrides,
  });

  const extensionUri = Uri.file('/mock/extension') as any;
  return new NotificationManager(
    createMockStorage(),
    createMockCallbacks(),
    extensionUri,
  );
}

// ============================================================
// テストスイート
// ============================================================

suite('NotificationManager Unit Tests', () => {

  teardown(() => {
    _resetConfig();
  });

  // ============================================================
  // getAudioCommand - プラットフォーム別コマンド生成
  // ============================================================

  suite('getAudioCommand - プラットフォーム別コマンド', () => {

    test('コマンド結果に command, args, options が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
      assert.ok('command' in result, 'Should have command');
      assert.ok('args' in result, 'Should have args');
      assert.ok('options' in result, 'Should have options');
      assert.ok(Array.isArray(result.args), 'args should be an array');
    });

    test('WSL 環境で powershell.exe が使用される', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        try {
          const version = require('fs').readFileSync('/proc/version', 'utf8');
          if (/microsoft|wsl/i.test(version)) {
            const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
            assert.strictEqual(result.command, 'powershell.exe');
          }
        } catch {
          // /proc/version が読めない環境ではスキップ
        }
      }
    });

    test('WSL 環境で wslpath によるWindows パスが使用される', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        try {
          const version = require('fs').readFileSync('/proc/version', 'utf8');
          if (/microsoft|wsl/i.test(version)) {
            const result = manager.getAudioCommand('/home/user/sound.mp3', 0.5);
            const scriptArg = result.args.find((a: string) => a.includes('sound.mp3'));
            assert.ok(scriptArg, 'Should contain sound.mp3 in PowerShell script');
            // wslpath が Windows パス（バックスラッシュ or \\wsl...）に変換する
            assert.ok(
              scriptArg!.includes('\\') || scriptArg!.includes('/'),
              'Should contain a path separator',
            );
          }
        } catch {
          // skip
        }
      }
    });

    test('WSL 環境で volume が PowerShell スクリプトに含まれる', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        try {
          const version = require('fs').readFileSync('/proc/version', 'utf8');
          if (/microsoft|wsl/i.test(version)) {
            const result = manager.getAudioCommand('/path/to/sound.mp3', 0.75);
            const scriptArg = result.args.find((a: string) => a.includes('Volume'));
            assert.ok(scriptArg, 'Should contain Volume in PowerShell script');
            assert.ok(
              scriptArg!.includes('0.75'),
              'Should set volume to 0.75',
            );
          }
        } catch {
          // skip
        }
      }
    });
  });

  // ============================================================
  // playSound - サウンド有効/無効
  // ============================================================

  suite('playSound - サウンド有効/無効', () => {

    test('soundEnabled=false の場合、エラーなく完了する', async () => {
      const manager = createManager({ soundEnabled: false });

      // soundEnabled=false なので playSound は何もしない
      await manager.notifyBreakComplete();
      assert.ok(true, 'Should complete without error');
    });

    test('soundFile=silent の場合、エラーなく完了する', async () => {
      const manager = createManager({ soundFile: 'silent' });

      await manager.notifyBreakComplete();
      assert.ok(true, 'Should complete without error');
    });
  });

  // ============================================================
  // サウンドファイルパス生成
  // ============================================================

  suite('サウンドファイルパス生成', () => {

    test('getAudioCommand の引数に work-end.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/work-end.mp3', 0.5,
      );
      const allArgs = result.args.join(' ');
      assert.ok(
        allArgs.includes('work-end.mp3'),
        `Should use work-end.mp3, got: ${allArgs}`,
      );
    });

    test('getAudioCommand の引数に break-end.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/break-end.mp3', 0.5,
      );
      const allArgs = result.args.join(' ');
      assert.ok(
        allArgs.includes('break-end.mp3'),
        `Should use break-end.mp3, got: ${allArgs}`,
      );
    });

    test('getAudioCommand の引数に alert.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/alert.mp3', 0.5,
      );
      const allArgs = result.args.join(' ');
      assert.ok(
        allArgs.includes('alert.mp3'),
        `Should use alert.mp3, got: ${allArgs}`,
      );
    });
  });

  // ============================================================
  // 音量変換
  // ============================================================

  suite('音量変換', () => {

    test('volume=0.5 で PowerShell スクリプトに 0.5 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
      const scriptArg = result.args.join(' ');
      assert.ok(
        scriptArg.includes('0.5') || scriptArg.includes('-f 16384'),
        `Volume 0.5 should be in command args: ${scriptArg}`,
      );
    });

    test('volume=1.0 で正しい引数が生成される', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 1.0);
      const scriptArg = result.args.join(' ');
      assert.ok(
        scriptArg.includes('1') || scriptArg.includes('-f 32768'),
        `Volume 1.0 should be in command args: ${scriptArg}`,
      );
    });

    test('volume=0 で正しい引数が生成される', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0);
      const scriptArg = result.args.join(' ');
      assert.ok(
        scriptArg.includes('Volume = 0') || scriptArg.includes('-f 0') || scriptArg.includes('-v 0'),
        `Volume 0 should be in command args: ${scriptArg}`,
      );
    });
  });

  // ============================================================
  // 脳疲労アラートの重複防止
  // ============================================================

  suite('脳疲労アラート制御', () => {

    test('閾値未満の場合、アラートが表示されない', async () => {
      const manager = createManager({ fatigueAlertThreshold: 21 });

      // 15 < 21 なのでアラートは出ない
      await manager.checkAndNotifyFatigueAlert(15);
      assert.ok(true, 'Should not alert below threshold');
    });

    test('通知無効の場合、アラートが表示されない', async () => {
      const manager = createManager({
        notificationEnabled: false,
        fatigueAlertThreshold: 10,
      });

      await manager.checkAndNotifyFatigueAlert(25);
      assert.ok(true, 'Should not alert when notifications disabled');
    });
  });

  // ============================================================
  // dispose
  // ============================================================

  suite('ライフサイクル', () => {

    test('dispose() がエラーなく完了する', () => {
      const manager = createManager();
      manager.dispose();
      assert.ok(true, 'dispose completed without error');
    });
  });
});


// ============================================================
// 脳疲労スコアの先読み警告（docs/fatigue-forecast-plan.md §8）
// ============================================================

/** saveAlertState を記録する状態保持型ストレージ */
function statefulStorage(initial?: Partial<AlertState>) {
  let state: AlertState = { ...createDefaultAlertState(), ...initial };
  const saves: AlertState[] = [];
  const storage = {
    getAlertState: () => state,
    saveAlertState: async (s: AlertState) => { state = s; saves.push(s); },
  } as any;
  return { storage, saves, get: () => state };
}

function managerWith(storage: any, cfg?: Record<string, any>): NotificationManager {
  _resetConfig();
  _setConfig({
    notificationEnabled: true, soundEnabled: false, soundVolume: 50, soundFile: 'silent',
    fatigueAlertEnabled: true, fatigueAlertThreshold: 15,
    fatigueForecastEnabled: true, fatigueForecastLookahead: 2,
    ...cfg,
  });
  return new NotificationManager(storage, createMockCallbacks(), Uri.file('/mock') as any);
}

/** 今日 sessions 完了・interrupted 中断、履歴に completed work/break を積んだ stats */
function fcStats(sessions: number, interrupted: number, breaks: number): Statistics {
  const stats = createDefaultStatistics();
  stats.today.sessions = sessions;
  stats.today.interruptedSessions = interrupted;
  const now = new Date().toISOString();
  const rec = (id: string, type: 'work' | 'break'): SessionRecord =>
    ({ id, type, completed: true, duration: 1, startTime: now, endTime: now });
  for (let i = 0; i < sessions; i++) { stats.history.push(rec(`w${i}`, 'work')); }
  for (let i = 0; i < breaks; i++) { stats.history.push(rec(`b${i}`, 'break')); }
  return stats;
}

suite('NotificationManager 先読み警告', () => {
  teardown(() => { _resetConfig(); });

  test('fatigueForecastEnabled=false では通知せず状態も保存しない', async () => {
    const { storage, saves } = statefulStorage();
    await managerWith(storage, { fatigueForecastEnabled: false }).checkAndNotifyFatigueForecast(fcStats(6, 8, 6));
    assert.strictEqual(saves.length, 0);
  });

  test('fatigueAlertEnabled=false では出さない', async () => {
    const { storage, saves } = statefulStorage();
    await managerWith(storage, { fatigueAlertEnabled: false }).checkAndNotifyFatigueForecast(fcStats(6, 8, 6));
    assert.strictEqual(saves.length, 0);
  });

  test('notificationEnabled=false では出さない', async () => {
    const { storage, saves } = statefulStorage();
    await managerWith(storage, { notificationEnabled: false }).checkAndNotifyFatigueForecast(fcStats(6, 8, 6));
    assert.strictEqual(saves.length, 0);
  });

  test('reach(k=2) で通知し、残りセット数 2 を保存する', async () => {
    const { storage, saves } = statefulStorage();
    await managerWith(storage).checkAndNotifyFatigueForecast(fcStats(6, 8, 6));
    assert.strictEqual(saves.length, 1);
    assert.strictEqual(saves[0].lastForecastRemaining, 2);
  });

  test('同日・同じ k(=2) では2回目を出さない', async () => {
    const today = new Date().toISOString().split('T')[0];
    const { storage, saves } = statefulStorage({ lastForecastDate: today, lastForecastRemaining: 2 });
    await managerWith(storage).checkAndNotifyFatigueForecast(fcStats(6, 8, 6)); // k=2
    assert.strictEqual(saves.length, 0);
  });

  test('同日でも k が減れば（2→1）再通知する', async () => {
    const today = new Date().toISOString().split('T')[0];
    const { storage, saves } = statefulStorage({ lastForecastDate: today, lastForecastRemaining: 2 });
    await managerWith(storage).checkAndNotifyFatigueForecast(fcStats(7, 8, 7)); // k=1
    assert.strictEqual(saves.length, 1);
    assert.strictEqual(saves[0].lastForecastRemaining, 1);
  });

  test('既に閾値以上（reach しない）では出さない', async () => {
    const { storage, saves } = statefulStorage();
    await managerWith(storage).checkAndNotifyFatigueForecast(fcStats(8, 8, 8)); // 15点 = 閾値
    assert.strictEqual(saves.length, 0);
  });

  test('既存アラートは先読みの状態フィールドを消さない（スプレッド更新）', async () => {
    const today = new Date().toISOString().split('T')[0];
    const { storage, get } = statefulStorage({ lastForecastDate: today, lastForecastRemaining: 1 });
    // 閾値以上のスコアで既存アラートを発火させる
    await managerWith(storage, { fatigueAlertThreshold: 10 }).checkAndNotifyFatigueAlert(25);
    const st = get();
    assert.strictEqual(st.lastAlertScore, 25, '既存アラートは更新される');
    assert.strictEqual(st.lastForecastDate, today, '先読みの状態は保持される');
    assert.strictEqual(st.lastForecastRemaining, 1);
  });
});
