import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig } from './mocks/vscode';
import { Timer, TimerEvents } from '../../src/timer';
import { Storage } from '../../src/storage';
import { TimerData, SessionRecord, createDefaultTimerData } from '../../src/config';

// ============================================================
// テストヘルパー
// ============================================================

function createMockStorage(initial?: Partial<TimerData>): Storage {
  let savedData: TimerData = { ...createDefaultTimerData(), ...initial };
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
  ticks: Array<{ remaining: number; state: string }>;
}

function createCtx(): TestContext {
  return {
    workCompleteSessions: [],
    breakCompleteSessions: [],
    stateChanges: [],
    ticks: [],
  };
}

function createMockEvents(ctx: TestContext): TimerEvents {
  return {
    onTick: (remaining, state) => ctx.ticks.push({ remaining, state }),
    onWorkComplete: (session) => ctx.workCompleteSessions.push(session),
    onBreakComplete: (session) => ctx.breakCompleteSessions.push(session),
    onStateChange: (state) => ctx.stateChanges.push(state),
  };
}

function setupConfig(overrides?: Record<string, any>) {
  _resetConfig();
  _setConfig({
    workDuration: 30,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
    autoStartBreak: false,
    autoStartWork: false,
    ...overrides,
  });
}

// ============================================================
// テストスイート
// ============================================================

suite('Timer Lifecycle Unit Tests', () => {
  let ctx: TestContext;
  let timers: Timer[];

  setup(() => {
    ctx = createCtx();
    timers = [];
  });

  teardown(() => {
    // リークした setInterval を確実に停止
    timers.forEach((t) => t.dispose());
    _resetConfig();
  });

  function makeTimer(storage?: Storage): Timer {
    const timer = new Timer(
      storage ?? createMockStorage(),
      createMockEvents(ctx),
      createMockOutputChannel(),
    );
    timers.push(timer);
    return timer;
  }

  // ----------------------------------------------------------
  // startWork
  // ----------------------------------------------------------
  suite('startWork', () => {
    test('状態が working になり残り時間が workDuration*60 になる', () => {
      setupConfig({ workDuration: 30 });
      const timer = makeTimer();
      timer.startWork();
      assert.strictEqual(timer.getState(), 'working');
      assert.strictEqual(timer.getRemainingTime(), 1800);
    });

    test('onStateChange と onTick が発火する', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      assert.ok(ctx.stateChanges.includes('working'));
      assert.ok(ctx.ticks.length >= 1);
    });
  });

  // ----------------------------------------------------------
  // startBreak
  // ----------------------------------------------------------
  suite('startBreak', () => {
    test('短い休憩で shortBreak*60 秒になる', () => {
      setupConfig({ shortBreak: 5 });
      const timer = makeTimer();
      timer.startBreak(false);
      assert.strictEqual(timer.getState(), 'breaking');
      assert.strictEqual(timer.getRemainingTime(), 300);
    });

    test('長い休憩で longBreak*60 秒になる', () => {
      setupConfig({ longBreak: 15 });
      const timer = makeTimer();
      timer.startBreak(true);
      assert.strictEqual(timer.getRemainingTime(), 900);
    });
  });

  // ----------------------------------------------------------
  // pause / resume / togglePause
  // ----------------------------------------------------------
  suite('pause / resume', () => {
    test('pause で paused 状態かつ previousState が保存される', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      timer.pause();
      assert.strictEqual(timer.getState(), 'paused');
      assert.strictEqual(timer.getTimerData().previousState, 'working');
      assert.ok(timer.getTimerData().pausedAt !== null);
    });

    test('idle 状態で pause しても何も起きない', () => {
      setupConfig();
      const timer = makeTimer();
      timer.pause();
      assert.strictEqual(timer.getState(), 'idle');
    });

    test('resume で元の状態に戻る', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      timer.pause();
      timer.resume();
      assert.strictEqual(timer.getState(), 'working');
      assert.strictEqual(timer.getTimerData().previousState, null);
    });

    test('paused でないときに resume しても何も起きない', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      timer.resume();
      assert.strictEqual(timer.getState(), 'working');
    });

    test('togglePause は working <-> paused をトグルする', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      timer.togglePause();
      assert.strictEqual(timer.getState(), 'paused');
      timer.togglePause();
      assert.strictEqual(timer.getState(), 'working');
    });

    test('休憩中の pause は previousState=breaking', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startBreak(false);
      timer.pause();
      assert.strictEqual(timer.getTimerData().previousState, 'breaking');
    });
  });

  // ----------------------------------------------------------
  // reset
  // ----------------------------------------------------------
  suite('reset', () => {
    test('idle 状態のリセットは中断レコードを返さない', () => {
      setupConfig();
      const timer = makeTimer();
      const record = timer.reset();
      assert.strictEqual(record, null);
      assert.strictEqual(timer.getState(), 'idle');
    });

    test('作業中のリセットは未完了の work レコードを返す', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      const record = timer.reset();
      assert.ok(record, '中断レコードが返るべき');
      assert.strictEqual(record!.type, 'work');
      assert.strictEqual(record!.completed, false);
      assert.strictEqual(timer.getState(), 'idle');
    });

    test('休憩中のリセットは break レコードを返す', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startBreak(false);
      const record = timer.reset();
      assert.ok(record);
      assert.strictEqual(record!.type, 'break');
    });

    test('一時停止中のリセットは元の状態の種別でレコードを返す', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      timer.pause();
      const record = timer.reset();
      assert.ok(record);
      assert.strictEqual(record!.type, 'work');
    });

    test('リセットしても currentSetIndex は保持される', () => {
      setupConfig();
      const storage = createMockStorage();
      const timer = makeTimer(storage);
      // 1セッション完了させて setIndex を進める
      timer.startWork();
      const data = (timer as any).data;
      data.remainingTime = 0;
      (timer as any).handleSessionComplete();
      const setIndexBefore = timer.getCurrentSetIndex();

      timer.startWork();
      timer.reset();
      assert.strictEqual(timer.getCurrentSetIndex(), setIndexBefore);
    });
  });

  // ----------------------------------------------------------
  // skipBreak
  // ----------------------------------------------------------
  suite('skipBreak', () => {
    test('休憩中の skipBreak は作業を開始する', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startBreak(false);
      timer.skipBreak();
      assert.strictEqual(timer.getState(), 'working');
    });

    test('作業中の skipBreak は何もしない', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startWork();
      timer.skipBreak();
      assert.strictEqual(timer.getState(), 'working');
    });

    test('休憩を一時停止中でも skipBreak で作業開始できる', () => {
      setupConfig();
      const timer = makeTimer();
      timer.startBreak(false);
      timer.pause();
      timer.skipBreak();
      assert.strictEqual(timer.getState(), 'working');
    });
  });

  // ----------------------------------------------------------
  // isLongBreakDue
  // ----------------------------------------------------------
  suite('isLongBreakDue', () => {
    test('setIndex <= interval では false', () => {
      setupConfig({ longBreakInterval: 4 });
      const timer = makeTimer();
      assert.strictEqual(timer.isLongBreakDue(), false);
    });
  });

  // ----------------------------------------------------------
  // restore
  // ----------------------------------------------------------
  suite('restore', () => {
    test('保存状態が idle なら idle のまま setIndex を復元', () => {
      setupConfig();
      const storage = createMockStorage({ state: 'idle', currentSetIndex: 3 });
      const timer = makeTimer(storage);
      timer.restore();
      assert.strictEqual(timer.getState(), 'idle');
      assert.strictEqual(timer.getCurrentSetIndex(), 3);
    });

    test('保存状態が paused なら paused を復元しイベント発火', () => {
      setupConfig();
      const storage = createMockStorage({
        state: 'paused',
        previousState: 'working',
        remainingTime: 600,
        currentSetIndex: 2,
      });
      const timer = makeTimer(storage);
      timer.restore();
      assert.strictEqual(timer.getState(), 'paused');
      assert.strictEqual(timer.getRemainingTime(), 600);
      assert.ok(ctx.stateChanges.includes('paused'));
    });

    test('working で経過時間内なら残り時間を差分計算して復元', () => {
      setupConfig();
      const now = Date.now();
      const storage = createMockStorage({
        state: 'working',
        remainingTime: 1800,
        totalDuration: 1800,
        startTimestamp: now - 60 * 1000, // 60秒経過
        currentSetIndex: 1,
      });
      const timer = makeTimer(storage);
      timer.restore();
      assert.strictEqual(timer.getState(), 'working');
      // 残り約 1740 秒（誤差許容）
      const remaining = timer.getRemainingTime();
      assert.ok(remaining > 1730 && remaining <= 1740, `remaining=${remaining}`);
    });

    test('working で既に完了している場合は完了処理が走る', () => {
      setupConfig();
      const now = Date.now();
      const storage = createMockStorage({
        state: 'working',
        remainingTime: 1800,
        totalDuration: 1800,
        startTimestamp: now - 2000 * 1000, // totalDuration を超えて経過
        currentSetIndex: 1,
      });
      const timer = makeTimer(storage);
      timer.restore();
      assert.strictEqual(ctx.workCompleteSessions.length, 1, '完了処理が走るべき');
      assert.strictEqual(timer.getState(), 'idle');
    });

    test('異常なタイムスタンプ（未来）はリセットされる', () => {
      setupConfig();
      const storage = createMockStorage({
        state: 'working',
        remainingTime: 1800,
        totalDuration: 1800,
        startTimestamp: Date.now() + 10000 * 1000, // 未来
        currentSetIndex: 2,
      });
      const timer = makeTimer(storage);
      timer.restore();
      assert.strictEqual(timer.getState(), 'idle');
      assert.strictEqual(timer.getCurrentSetIndex(), 2, 'setIndex は保持');
    });
  });

  // ----------------------------------------------------------
  // handleSessionComplete のレコード生成
  // ----------------------------------------------------------
  suite('セッション完了レコード', () => {
    test('作業完了で completed=true の work レコードが生成される', () => {
      setupConfig({ workDuration: 30 });
      const timer = makeTimer();
      timer.startWork();
      const data = (timer as any).data;
      data.remainingTime = 0;
      (timer as any).handleSessionComplete();

      assert.strictEqual(ctx.workCompleteSessions.length, 1);
      const record = ctx.workCompleteSessions[0];
      assert.strictEqual(record.type, 'work');
      assert.strictEqual(record.completed, true);
      assert.strictEqual(record.duration, 30);
    });

    test('休憩完了で break レコードが生成される', () => {
      setupConfig({ shortBreak: 5 });
      const timer = makeTimer();
      timer.startBreak(false);
      const data = (timer as any).data;
      data.remainingTime = 0;
      (timer as any).handleSessionComplete();

      assert.strictEqual(ctx.breakCompleteSessions.length, 1);
      assert.strictEqual(ctx.breakCompleteSessions[0].type, 'break');
    });
  });
});
