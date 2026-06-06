import './setup';

import * as assert from 'assert';
import {
  generateUUID,
  formatTime,
  formatMinutes,
  getTodayDateStr,
  getWeekStart,
  getWeekEnd,
  getFatigueLevel,
} from '../../src/utils';
import { FATIGUE_LEVELS } from '../../src/config';

// ============================================================
// utils ユニットテスト
// ============================================================

suite('utils Unit Tests', () => {

  // ----------------------------------------------------------
  // generateUUID
  // ----------------------------------------------------------
  suite('generateUUID', () => {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    test('UUID v4 形式に一致する', () => {
      const uuid = generateUUID();
      assert.ok(uuidPattern.test(uuid), `Invalid UUID format: ${uuid}`);
    });

    test('14番目の文字が "4" である（version 4）', () => {
      const uuid = generateUUID();
      assert.strictEqual(uuid[14], '4');
    });

    test('生成のたびに異なる値になる', () => {
      const set = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        set.add(generateUUID());
      }
      assert.strictEqual(set.size, 1000, 'すべてユニークであるべき');
    });
  });

  // ----------------------------------------------------------
  // formatTime
  // ----------------------------------------------------------
  suite('formatTime', () => {
    test('0秒は 0:00', () => {
      assert.strictEqual(formatTime(0), '0:00');
    });

    test('5秒は 0:05（ゼロ埋め）', () => {
      assert.strictEqual(formatTime(5), '0:05');
    });

    test('90秒は 1:30', () => {
      assert.strictEqual(formatTime(90), '1:30');
    });

    test('600秒は 10:00', () => {
      assert.strictEqual(formatTime(600), '10:00');
    });

    test('60分超でも分が繰り上がる（3661秒 -> 61:01）', () => {
      assert.strictEqual(formatTime(3661), '61:01');
    });

    test('小数秒は切り捨てられる（59.9秒 -> 0:59）', () => {
      assert.strictEqual(formatTime(59.9), '0:59');
    });
  });

  // ----------------------------------------------------------
  // formatMinutes
  // ----------------------------------------------------------
  suite('formatMinutes', () => {
    test('0分は "0分"', () => {
      assert.strictEqual(formatMinutes(0), '0分');
    });

    test('59分は "59分"', () => {
      assert.strictEqual(formatMinutes(59), '59分');
    });

    test('60分は "1時間"（分がゼロのときは省略）', () => {
      assert.strictEqual(formatMinutes(60), '1時間');
    });

    test('90分は "1時間30分"', () => {
      assert.strictEqual(formatMinutes(90), '1時間30分');
    });

    test('120分は "2時間"', () => {
      assert.strictEqual(formatMinutes(120), '2時間');
    });

    test('125分は "2時間5分"', () => {
      assert.strictEqual(formatMinutes(125), '2時間5分');
    });
  });

  // ----------------------------------------------------------
  // getTodayDateStr
  // ----------------------------------------------------------
  suite('getTodayDateStr', () => {
    test('YYYY-MM-DD 形式である', () => {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(getTodayDateStr()));
    });

    test('UTC基準の今日と一致する', () => {
      const expected = new Date().toISOString().split('T')[0];
      assert.strictEqual(getTodayDateStr(), expected);
    });
  });

  // ----------------------------------------------------------
  // getWeekStart / getWeekEnd
  // ----------------------------------------------------------
  suite('getWeekStart / getWeekEnd', () => {
    test('週の開始は月曜日（getDay()===1）', () => {
      // 適当な複数の曜日で検証
      for (const iso of ['2024-01-01', '2024-03-13', '2024-12-29', '2025-06-06']) {
        const start = getWeekStart(new Date(iso + 'T12:00:00'));
        assert.strictEqual(start.getDay(), 1, `${iso} の週開始は月曜であるべき`);
      }
    });

    test('週の開始は 00:00:00 にリセットされる', () => {
      const start = getWeekStart(new Date('2024-06-06T15:42:30'));
      assert.strictEqual(start.getHours(), 0);
      assert.strictEqual(start.getMinutes(), 0);
      assert.strictEqual(start.getSeconds(), 0);
      assert.strictEqual(start.getMilliseconds(), 0);
    });

    test('週の終了は日曜日（開始の6日後）', () => {
      const ref = new Date('2024-06-06T12:00:00');
      const start = getWeekStart(ref);
      const end = getWeekEnd(ref);
      assert.strictEqual(end.getDay(), 0, '週終了は日曜であるべき');
      const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      assert.strictEqual(diffDays, 6, '開始と終了は6日差であるべき');
    });

    test('日曜を渡しても同じ週の月曜を返す（ISO 8601）', () => {
      // 2024-06-09 は日曜日
      const sunday = new Date('2024-06-09T12:00:00');
      const start = getWeekStart(sunday);
      assert.strictEqual(start.getDay(), 1);
      // 同じ週の月曜 = 2024-06-03
      assert.strictEqual(start.getDate(), 3);
      assert.strictEqual(start.getMonth(), 5); // 6月 (0-indexed)
    });

    test('引数のDateを破壊しない', () => {
      const original = new Date('2024-06-06T12:00:00');
      const copy = new Date(original.getTime());
      getWeekStart(original);
      getWeekEnd(original);
      assert.strictEqual(original.getTime(), copy.getTime(), '元のDateは変更されないべき');
    });
  });

  // ----------------------------------------------------------
  // getFatigueLevel
  // ----------------------------------------------------------
  suite('getFatigueLevel', () => {
    test('0点は good', () => {
      assert.strictEqual(getFatigueLevel(0), FATIGUE_LEVELS.good);
    });

    test('境界値10点は good', () => {
      assert.strictEqual(getFatigueLevel(10), FATIGUE_LEVELS.good);
    });

    test('11点は caution', () => {
      assert.strictEqual(getFatigueLevel(11), FATIGUE_LEVELS.caution);
    });

    test('20点は caution', () => {
      assert.strictEqual(getFatigueLevel(20), FATIGUE_LEVELS.caution);
    });

    test('21点は warning', () => {
      assert.strictEqual(getFatigueLevel(21), FATIGUE_LEVELS.warning);
    });

    test('30点は warning', () => {
      assert.strictEqual(getFatigueLevel(30), FATIGUE_LEVELS.warning);
    });

    test('31点は danger', () => {
      assert.strictEqual(getFatigueLevel(31), FATIGUE_LEVELS.danger);
    });

    test('最大45点は danger', () => {
      assert.strictEqual(getFatigueLevel(45), FATIGUE_LEVELS.danger);
    });
  });
});
