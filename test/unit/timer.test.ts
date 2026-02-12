import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig } from './mocks/vscode';
import { Timer, TimerEvents } from '../../src/timer';
import { Storage } from '../../src/storage';
import { SessionRecord, createDefaultTimerData } from '../../src/config';

// ============================================================
// テストヘルパー
// ============================================================

function createMockStorage(): Storage {
  let savedData = createDefaultTimerData();
  return {
    getTimerData: () => ({ ...savedData }),
    saveTimerData: (data: any) => { savedData = { ...data }; },
  } as any;
}

function createMockOutputChannel() {
  return {
    appendLine: (_msg: string) => { /* noop */ },
    dispose: () => { /* noop */ },
  } as any;
}

interface TestContext {
  workCompleteSessions: SessionRecord[];
  breakCompleteSessions: SessionRecord[];
  stateChanges: string[];
}

function createMockEvents(ctx: TestContext): TimerEvents {
  return {
    onTick: () => {},
    onWorkComplete: (session: SessionRecord) => {
      ctx.workCompleteSessions.push(session);
    },
    onBreakComplete: (session: SessionRecord) => {
      ctx.breakCompleteSessions.push(session);
    },
    onStateChange: (state: string) => {
      ctx.stateChanges.push(state);
    },
  };
}

function setupConfig(overrides?: Record<string, any>) {
  _resetConfig();
  _setConfig({
    workDuration: 1,       // 1分（テスト用に短く）
    shortBreak: 1,
    longBreak: 3,
    longBreakInterval: 4,
    autoStartBreak: false,
    autoStartWork: false,
    ...overrides,
  });
}

// ============================================================
// テストスイート
// ============================================================

suite('Timer Unit Tests', () => {
  let ctx: TestContext;

  setup(() => {
    ctx = {
      workCompleteSessions: [],
      breakCompleteSessions: [],
      stateChanges: [],
    };
  });

  teardown(() => {
    _resetConfig();
  });

  // ============================================================
  // currentSetIndex のリセットテスト
  // ============================================================

  suite('長い休憩後のcurrentSetIndexリセット', () => {

    test('4セッション完了後にcurrentSetIndexが1にリセットされる', () => {
      setupConfig();
      const storage = createMockStorage();
      const timer = new Timer(storage, createMockEvents(ctx), createMockOutputChannel());

      // 4回の作業セッションをシミュレート
      for (let i = 0; i < 4; i++) {
        timer.startWork();
        // タイマー完了を強制的にトリガーするため、内部データを操作
        const data = (timer as any).data;
        data.remainingTime = 0;
        (timer as any).handleSessionComplete();
      }

      // 4セッション後、currentSetIndexは1にリセットされているはず
      assert.strictEqual(
        timer.getCurrentSetIndex(),
        1,
        '4セッション完了後、currentSetIndexは1にリセットされるべき',
      );
    });

    test('4セッション目でisLongBreakDueがtrueになり、リセット後はfalseになる', () => {
      setupConfig();
      const storage = createMockStorage();

      let wasLongBreakDue = false;
      let timerRef: Timer;
      const events: TimerEvents = {
        onTick: () => {},
        onWorkComplete: () => {
          wasLongBreakDue = timerRef.isLongBreakDue();
        },
        onBreakComplete: () => {},
        onStateChange: () => {},
      };

      const timer = new Timer(storage, events, createMockOutputChannel());
      timerRef = timer;

      // 3セッション完了: longBreakDueではない
      for (let i = 0; i < 3; i++) {
        timer.startWork();
        const data = (timer as any).data;
        data.remainingTime = 0;
        (timer as any).handleSessionComplete();
      }
      assert.strictEqual(timer.isLongBreakDue(), false, '3セッション後はlongBreakDueではない');
      assert.strictEqual(wasLongBreakDue, false, '3セッション目のonWorkCompleteではfalse');

      // 4セッション目: onWorkCompleteが呼ばれた時点ではlongBreakDue
      timer.startWork();
      const data = (timer as any).data;
      data.remainingTime = 0;
      (timer as any).handleSessionComplete();

      assert.strictEqual(wasLongBreakDue, true, 'onWorkComplete内ではlongBreakDueがtrue');
      assert.strictEqual(timer.isLongBreakDue(), false, 'リセット後はlongBreakDueがfalse');
      assert.strictEqual(timer.getCurrentSetIndex(), 1, 'リセット後のcurrentSetIndexは1');
    });

    test('長い休憩後の次のセッション完了で短い休憩になる', () => {
      setupConfig();
      const storage = createMockStorage();

      // onWorkComplete時のisLongBreakDue状態を記録
      const longBreakDueHistory: boolean[] = [];
      const events: TimerEvents = {
        onTick: () => {},
        onWorkComplete: () => {
          longBreakDueHistory.push(timer.isLongBreakDue());
        },
        onBreakComplete: () => {},
        onStateChange: () => {},
      };

      const timer = new Timer(storage, events, createMockOutputChannel());

      // 5セッション連続実行
      for (let i = 0; i < 5; i++) {
        timer.startWork();
        const data = (timer as any).data;
        data.remainingTime = 0;
        (timer as any).handleSessionComplete();
      }

      // セッション1-3: 短い休憩 (false)
      // セッション4: 長い休憩 (true)
      // セッション5: 短い休憩 (false) ← ここが重要
      assert.deepStrictEqual(
        longBreakDueHistory,
        [false, false, false, true, false],
        '5セッションのlongBreakDue履歴が正しいこと',
      );
    });

    test('8セッションで2回目の長い休憩サイクルが正しく動作する', () => {
      setupConfig();
      const storage = createMockStorage();

      const longBreakDueHistory: boolean[] = [];
      const events: TimerEvents = {
        onTick: () => {},
        onWorkComplete: () => {
          longBreakDueHistory.push(timer.isLongBreakDue());
        },
        onBreakComplete: () => {},
        onStateChange: () => {},
      };

      const timer = new Timer(storage, events, createMockOutputChannel());

      // 8セッション連続実行
      for (let i = 0; i < 8; i++) {
        timer.startWork();
        const data = (timer as any).data;
        data.remainingTime = 0;
        (timer as any).handleSessionComplete();
      }

      // セッション 1-3: false, 4: true, 5-7: false, 8: true
      assert.deepStrictEqual(
        longBreakDueHistory,
        [false, false, false, true, false, false, false, true],
        '8セッションで2回の長い休憩サイクルが正しいこと',
      );
    });

    test('persist後もcurrentSetIndexが正しく保存される', () => {
      setupConfig();
      const storage = createMockStorage();
      const timer = new Timer(storage, createMockEvents(ctx), createMockOutputChannel());

      // 4セッション完了
      for (let i = 0; i < 4; i++) {
        timer.startWork();
        const data = (timer as any).data;
        data.remainingTime = 0;
        (timer as any).handleSessionComplete();
      }

      // ストレージから読み取った値も1であること
      const savedData = storage.getTimerData();
      assert.strictEqual(
        savedData.currentSetIndex,
        1,
        'ストレージに保存されたcurrentSetIndexも1であること',
      );
    });
  });
});
