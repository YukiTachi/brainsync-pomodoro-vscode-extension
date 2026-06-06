import './setup';

import * as assert from 'assert';
import { Storage } from '../../src/storage';
import {
  STORAGE_KEYS,
  createDefaultStatistics,
  createDefaultTimerData,
  createDefaultAlertState,
} from '../../src/config';

// ============================================================
// テストヘルパー
// ============================================================

/**
 * vscode.ExtensionContext.globalState を模した Map ベースのモック
 */
function createMockContext() {
  const store = new Map<string, any>();
  return {
    context: {
      globalState: {
        get: (key: string) => store.get(key),
        update: async (key: string, value: any) => {
          if (value === undefined) {
            store.delete(key);
          } else {
            store.set(key, value);
          }
        },
      },
    } as any,
    store,
  };
}

function createMockOutputChannel() {
  return {
    appendLine: (_msg: string) => { /* noop */ },
    dispose: () => { /* noop */ },
  } as any;
}

function createStorage() {
  const { context, store } = createMockContext();
  const storage = new Storage(context, createMockOutputChannel());
  return { storage, store, context };
}

// ============================================================
// storage ユニットテスト
// ============================================================

suite('storage Unit Tests', () => {

  // ----------------------------------------------------------
  // Statistics
  // ----------------------------------------------------------
  suite('Statistics の保存と取得', () => {
    test('空の状態ではデフォルト統計を返す', () => {
      const { storage } = createStorage();
      const stats = storage.getStatistics();
      assert.strictEqual(stats.today.sessions, 0);
      assert.deepStrictEqual(stats.history, []);
    });

    test('保存した統計を取得できる（ラウンドトリップ）', async () => {
      const { storage } = createStorage();
      const stats = createDefaultStatistics();
      stats.today.sessions = 7;
      stats.allTime.totalSessions = 42;
      await storage.saveStatistics(stats);

      const loaded = storage.getStatistics();
      assert.strictEqual(loaded.today.sessions, 7);
      assert.strictEqual(loaded.allTime.totalSessions, 42);
    });

    test('不正なデータの場合はデフォルトを返す', () => {
      const { storage, store } = createStorage();
      // 必須フィールドを欠いた不正データ
      store.set(STORAGE_KEYS.statistics, { foo: 'bar' });
      const stats = storage.getStatistics();
      assert.strictEqual(stats.today.sessions, 0, 'デフォルトにフォールバックすべき');
    });

    test('history が配列でない場合はデフォルトを返す', () => {
      const { storage, store } = createStorage();
      store.set(STORAGE_KEYS.statistics, {
        today: { date: '2024-06-06', sessions: 5 },
        history: 'not-an-array',
        dailyStatsHistory: [],
      });
      const stats = storage.getStatistics();
      assert.strictEqual(stats.today.sessions, 0);
    });
  });

  // ----------------------------------------------------------
  // TimerData
  // ----------------------------------------------------------
  suite('TimerData の保存と取得', () => {
    test('空の状態ではデフォルトタイマーデータを返す', () => {
      const { storage } = createStorage();
      const data = storage.getTimerData();
      assert.strictEqual(data.state, 'idle');
      assert.strictEqual(data.currentSetIndex, 1);
    });

    test('保存したタイマーデータを取得できる', async () => {
      const { storage } = createStorage();
      const data = createDefaultTimerData();
      data.state = 'working';
      data.remainingTime = 1500;
      data.currentSetIndex = 3;
      await storage.saveTimerData(data);

      const loaded = storage.getTimerData();
      assert.strictEqual(loaded.state, 'working');
      assert.strictEqual(loaded.remainingTime, 1500);
      assert.strictEqual(loaded.currentSetIndex, 3);
    });

    test('不正なタイマーデータの場合はデフォルトを返す', () => {
      const { storage, store } = createStorage();
      store.set(STORAGE_KEYS.timerData, { state: 123 }); // state が数値
      const data = storage.getTimerData();
      assert.strictEqual(data.state, 'idle');
    });
  });

  // ----------------------------------------------------------
  // AlertState
  // ----------------------------------------------------------
  suite('AlertState の保存と取得', () => {
    test('空の状態ではデフォルトアラート状態を返す', () => {
      const { storage } = createStorage();
      const alert = storage.getAlertState();
      assert.strictEqual(alert.lastAlertDate, null);
      assert.strictEqual(alert.lastAlertScore, 0);
    });

    test('保存したアラート状態を取得できる', async () => {
      const { storage } = createStorage();
      await storage.saveAlertState({ lastAlertDate: '2024-06-06', lastAlertScore: 25 });
      const alert = storage.getAlertState();
      assert.strictEqual(alert.lastAlertDate, '2024-06-06');
      assert.strictEqual(alert.lastAlertScore, 25);
    });
  });

  // ----------------------------------------------------------
  // Reset
  // ----------------------------------------------------------
  suite('リセット', () => {
    test('resetAll は全データを削除する', async () => {
      const { storage, store } = createStorage();
      await storage.saveStatistics(createDefaultStatistics());
      await storage.saveTimerData(createDefaultTimerData());
      await storage.saveAlertState(createDefaultAlertState());

      await storage.resetAll();

      assert.strictEqual(store.has(STORAGE_KEYS.statistics), false);
      assert.strictEqual(store.has(STORAGE_KEYS.timerData), false);
      assert.strictEqual(store.has(STORAGE_KEYS.alertState), false);
    });

    test('resetStatistics は統計とアラートのみ削除し、タイマーは残す', async () => {
      const { storage, store } = createStorage();
      await storage.saveStatistics(createDefaultStatistics());
      await storage.saveTimerData(createDefaultTimerData());
      await storage.saveAlertState(createDefaultAlertState());

      await storage.resetStatistics();

      assert.strictEqual(store.has(STORAGE_KEYS.statistics), false);
      assert.strictEqual(store.has(STORAGE_KEYS.alertState), false);
      assert.strictEqual(store.has(STORAGE_KEYS.timerData), true, 'タイマーデータは保持される');
    });
  });
});
