import * as assert from 'assert';
import {
  TimerData,
  createDefaultTimerData,
  getTimerConfig,
} from '../../src/config';
import { formatTime, getWeekStart, getWeekEnd } from '../../src/utils';

suite('Timer Utility Test Suite', () => {

  // ============================================================
  // formatTime
  // ============================================================

  suite('formatTime', () => {
    test('0秒を0:00にフォーマット', () => {
      assert.strictEqual(formatTime(0), '0:00');
    });

    test('60秒を1:00にフォーマット', () => {
      assert.strictEqual(formatTime(60), '1:00');
    });

    test('90秒を1:30にフォーマット', () => {
      assert.strictEqual(formatTime(90), '1:30');
    });

    test('1800秒を30:00にフォーマット', () => {
      assert.strictEqual(formatTime(1800), '30:00');
    });

    test('61秒を1:01にフォーマット', () => {
      assert.strictEqual(formatTime(61), '1:01');
    });

    test('3599秒を59:59にフォーマット', () => {
      assert.strictEqual(formatTime(3599), '59:59');
    });
  });

  // ============================================================
  // createDefaultTimerData
  // ============================================================

  suite('createDefaultTimerData', () => {
    test('デフォルトのタイマーデータが正しい', () => {
      const data = createDefaultTimerData();
      assert.strictEqual(data.state, 'idle');
      assert.strictEqual(data.previousState, null);
      assert.strictEqual(data.remainingTime, 0);
      assert.strictEqual(data.currentSetIndex, 1);
      assert.strictEqual(data.startTimestamp, null);
      assert.strictEqual(data.pausedAt, null);
      assert.strictEqual(data.totalDuration, 0);
    });
  });

  // ============================================================
  // getWeekStart / getWeekEnd
  // ============================================================

  suite('getWeekStart', () => {
    test('月曜日は自分自身を返す', () => {
      // 2026-02-09 is a Monday
      const monday = new Date(2026, 1, 9);
      const result = getWeekStart(monday);
      assert.strictEqual(result.getDay(), 1); // Monday
    });

    test('水曜日は月曜日を返す', () => {
      // 2026-02-11 is a Wednesday
      const wednesday = new Date(2026, 1, 11);
      const result = getWeekStart(wednesday);
      assert.strictEqual(result.getDay(), 1); // Monday
      assert.strictEqual(result.getDate(), 9);
    });

    test('日曜日は前の月曜日を返す', () => {
      // 2026-02-15 is a Sunday
      const sunday = new Date(2026, 1, 15);
      const result = getWeekStart(sunday);
      assert.strictEqual(result.getDay(), 1); // Monday
      assert.strictEqual(result.getDate(), 9);
    });

    test('元のDateオブジェクトを変更しない', () => {
      const original = new Date(2026, 1, 11);
      const originalTime = original.getTime();
      getWeekStart(original);
      assert.strictEqual(original.getTime(), originalTime);
    });
  });

  suite('getWeekEnd', () => {
    test('月曜日の週の終わりは日曜日', () => {
      const monday = new Date(2026, 1, 9);
      const result = getWeekEnd(monday);
      assert.strictEqual(result.getDay(), 0); // Sunday
      assert.strictEqual(result.getDate(), 15);
    });

    test('元のDateオブジェクトを変更しない', () => {
      const original = new Date(2026, 1, 11);
      const originalTime = original.getTime();
      getWeekEnd(original);
      assert.strictEqual(original.getTime(), originalTime);
    });
  });
});
