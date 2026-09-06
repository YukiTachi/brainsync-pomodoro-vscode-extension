import {
  Statistics,
  DailyStats,
  SessionRecord,
  MAX_HISTORY_RECORDS,
  MAX_DAILY_STATS_HISTORY,
  createDefaultDailyStats,
  createDefaultStatistics,
} from './config';
import { getTodayDateStr, getWeekStart, getWeekEnd, getFatigueLevel } from './utils';

// ============================================================
// 脳疲労スコア推定
// ============================================================

/**
 * 脳疲労スコアを推定する（0-45点）
 */
export function estimateFatigueScore(stats: Statistics): number {
  let score = 0;

  // 1. 今日のセッション数による加点
  const todaySessions = stats.today.sessions;
  if (todaySessions >= 12) {
    score += 15;
  } else if (todaySessions >= 10) {
    score += 10;
  } else if (todaySessions >= 8) {
    score += 5;
  } else if (todaySessions >= 6) {
    score += 3;
  }

  // 2. 今週のセッション数による加点
  const weekSessions = stats.week.totalSessions;
  if (weekSessions >= 60) {
    score += 15;
  } else if (weekSessions >= 50) {
    score += 10;
  } else if (weekSessions >= 40) {
    score += 5;
  } else if (weekSessions >= 30) {
    score += 3;
  }

  // 3. 連続作業日数による加点
  const consecutiveDays = calculateConsecutiveDays(stats);
  if (consecutiveDays >= 7) {
    score += 10;
  } else if (consecutiveDays >= 5) {
    score += 5;
  }

  // 4. 中断率による加点
  const interruptionRate = calculateInterruptionRate(stats.today);
  if (interruptionRate >= 0.5) {
    score += 10;
  } else if (interruptionRate >= 0.3) {
    score += 5;
  }

  // 5. 休憩スキップ率による加点
  const skipRate = calculateBreakSkipRate(stats.history);
  if (skipRate >= 0.5) {
    score += 5;
  }

  return Math.min(score, 45);
}

/**
 * 連続作業日数を計算
 */
export function calculateConsecutiveDays(stats: Statistics): number {
  const todayStr = getTodayDateStr();

  // dailyStatsHistoryから計算（信頼できるソース）
  const allDays = [...stats.dailyStatsHistory];
  if (stats.today.date === todayStr && stats.today.sessions > 0) {
    allDays.push(stats.today);
  }

  // セッションがある日の集合を作成
  const daysWithSessions = new Set<string>();
  for (const day of allDays) {
    if (day.sessions > 0) {
      daysWithSessions.add(day.date);
    }
  }

  // historyからも補完
  for (const record of stats.history) {
    if (record.type === 'work' && record.completed) {
      const dateStr = record.startTime.split('T')[0];
      daysWithSessions.add(dateStr);
    }
  }

  // 今日セッションがない場合は昨日から計算開始
  const hasTodaySessions = daysWithSessions.has(todayStr);
  const startDate = new Date(todayStr + 'T00:00:00Z');
  if (!hasTodaySessions) {
    startDate.setUTCDate(startDate.getUTCDate() - 1);
  }

  let consecutiveDays = 0;
  for (let i = 0; i < 14; i++) {
    const targetDate = new Date(startDate.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = targetDate.toISOString().split('T')[0];

    if (daysWithSessions.has(dateStr)) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  return consecutiveDays;
}

/**
 * セッション中断率を計算
 */
export function calculateInterruptionRate(dailyStats: DailyStats): number {
  const total = dailyStats.sessions + dailyStats.interruptedSessions;
  if (total === 0) {return 0;}
  return dailyStats.interruptedSessions / total;
}

/**
 * 休憩スキップ率を計算（過去7日間）
 */
export function calculateBreakSkipRate(history: SessionRecord[]): number {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString();

  const recentSessions = history.filter(
    (record) => record.startTime >= sevenDaysAgoStr && record.completed
  );

  const workSessions = recentSessions.filter((r) => r.type === 'work').length;
  const breakSessions = recentSessions.filter((r) => r.type === 'break').length;

  if (workSessions === 0) {return 0;}

  const expectedBreaks = workSessions * 0.9;
  const actualBreakRate = breakSessions / expectedBreaks;

  return Math.max(0, Math.min(1, 1 - actualBreakRate));
}

// ============================================================
// 統計データ更新
// ============================================================

/**
 * 日付が変わっていれば today を当日分にロールオーバーする
 *
 * 前日分に活動があれば dailyStatsHistory へ退避し、today を当日の空データにリセットする。
 * セッション完了時だけでなく、統計の表示・エクスポートなど「読み取り」経路でも
 * 当日のデータを正しく見せるために呼び出す。
 */
export function rolloverDailyStats(stats: Statistics): Statistics {
  const today = getTodayDateStr();

  if (stats.today.date !== today) {
    if (stats.today.date && (stats.today.sessions > 0 || stats.today.interruptedSessions > 0)) {
      stats.dailyStatsHistory.push({ ...stats.today });
      if (stats.dailyStatsHistory.length > MAX_DAILY_STATS_HISTORY) {
        stats.dailyStatsHistory.shift();
      }
    }
    stats.today = createDefaultDailyStats(today);
  }

  return stats;
}

/**
 * 今日の統計を更新
 */
export function updateTodayStats(stats: Statistics, newSession: SessionRecord): Statistics {
  // 日付が変わっていればロールオーバー
  rolloverDailyStats(stats);

  // セッション記録を追加
  if (newSession.type === 'work') {
    if (newSession.completed) {
      stats.today.sessions++;
      stats.today.totalFocusTime += newSession.duration;
      stats.allTime.totalSessions++;
      stats.allTime.totalFocusTime += newSession.duration;
    } else {
      stats.today.interruptedSessions++;
    }
  } else {
    if (newSession.completed) {
      stats.today.totalBreakTime += newSession.duration;
    }
  }

  // 履歴に追加
  stats.history.push(newSession);
  if (stats.history.length > MAX_HISTORY_RECORDS) {
    stats.history.shift();
  }

  // 脳疲労スコアを再計算
  // NOTE: この時点では stats.week が更新前のため、週セッション数を含まない暫定値になる。
  //       正となる値は直後の updateWeeklyStats が week 更新後に再計算して上書きする。
  //       ここは updateTodayStats が単独で呼ばれた場合の暫定値として残している。
  stats.today.fatigueScore = estimateFatigueScore(stats);

  return stats;
}

/**
 * 週次統計を更新
 */
export function updateWeeklyStats(stats: Statistics): Statistics {
  // 表示・エクスポート経路でも当日のデータを正しく見せるためロールオーバー
  rolloverDailyStats(stats);

  const today = new Date();
  const weekStart = getWeekStart(today);
  const weekEnd = getWeekEnd(today);

  const dailyStats: DailyStats[] = [];
  let totalSessions = 0;
  let totalFocusTime = 0;

  for (let i = 0; i < 7; i++) {
    // UTC 基準で 1 日ずつ進める（weekStart は UTC 深夜）。
    // ローカルの setDate を使うと UTC への変換時に日付がずれるため使わない。
    const date = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];

    let dayStats: DailyStats;
    if (dateStr === stats.today.date) {
      dayStats = stats.today;
    } else {
      dayStats = stats.dailyStatsHistory.find((d) => d.date === dateStr) ||
        createDefaultDailyStats(dateStr);
    }

    dailyStats.push(dayStats);
    totalSessions += dayStats.sessions;
    totalFocusTime += dayStats.totalFocusTime;
  }

  stats.week = {
    weekStart: weekStart.toISOString().split('T')[0],
    weekEnd: weekEnd.toISOString().split('T')[0],
    totalSessions,
    totalFocusTime,
    dailyAverage: Math.round((totalSessions / 7) * 10) / 10,
    fatigueScore: 0, // プレースホルダ。stats.week 代入後に再計算する（下記）
    dailyStats,
  };

  // ★スコアは stats.week を代入した「後」に計算する。
  //   従来は object literal 内で estimateFatigueScore(stats) を呼んでいたため、
  //   代入前の古い stats.week（totalSessions が更新前）を読み、
  //   「今週のセッション数」による加点が week.fatigueScore に反映されない潜在バグがあった。
  //   代入後に計算し、week と today の両方へ同じ値を入れることで
  //   today.fatigueScore === estimateFatigueScore(stats) === week.fatigueScore が不変条件になる。
  //   （dailyStats 内の today 行は stats.today と同一オブジェクトなので同時に反映される）
  const currentScore = estimateFatigueScore(stats);
  stats.week.fatigueScore = currentScore;
  stats.today.fatigueScore = currentScore;

  return stats;
}

// ============================================================
// 脳疲労スコアの先読み（既存ルールの正確なシミュレーション）
// ============================================================

/**
 * 今日のセッションを extraSessions 回追加した場合の推定脳疲労スコア。
 * 新しい推定モデルではなく、既存の estimateFatigueScore をそのまま先読みする。
 * 元の stats は変更しない。
 *
 * 前提: 引数の stats は updateWeeklyStats 適用後（week が最新）であること。
 */
export function projectFatigueScore(stats: Statistics, extraSessions: number): number {
  if (extraSessions <= 0) {
    return estimateFatigueScore(stats);
  }
  const projected: Statistics = {
    ...stats,
    today: { ...stats.today, sessions: stats.today.sessions + extraSessions },
    week: { ...stats.week, totalSessions: stats.week.totalSessions + extraSessions },
  };
  return estimateFatigueScore(projected);
}

/**
 * 閾値に到達するまでのセット数。
 * 現在すでに閾値以上なら 0、1..maxLookahead の範囲で到達するなら最小の k、到達しないなら null。
 * スコアは非単調（中断率の希釈で下がることがある）だが、最小 k の線形探索は影響を受けない。
 */
export function sessionsUntilThreshold(
  stats: Statistics,
  threshold: number,
  maxLookahead: number,
  current: number = estimateFatigueScore(stats),
): number | null {
  if (current >= threshold) {
    return 0;
  }
  for (let k = 1; k <= maxLookahead; k++) {
    if (projectFatigueScore(stats, k) >= threshold) {
      return k;
    }
  }
  return null;
}

/**
 * 先読みとして「何を伝えるか」の判定。トースト（notifications）と統計画面（webview）が
 * 同じ判定・同じ文言を使うための単一の情報源。
 *  - reach:      lookahead 内に閾値へ到達する（k セット後）
 *  - projection: 到達はしないが、次のセットでスコアが上がる
 *  - null:       表示なし（既に閾値以上 = 既存アラートの領分 / 上昇しない）
 */
export type ForecastSummary =
  | { kind: 'reach'; k: number; threshold: number; levelLabel: string }
  | { kind: 'projection'; score: number }
  | null;

export function describeForecast(
  stats: Statistics,
  threshold: number,
  lookahead: number,
): ForecastSummary {
  // 「現在」は関数内で 1 回だけ計算し、到達判定と上昇判定の両方でこれを使う。
  // updateWeeklyStats 後は today.fatigueScore と同値だが、純関数として
  // 任意の stats を渡されても判定が食い違わないようにする。
  const current = estimateFatigueScore(stats);
  if (current >= threshold) {
    return null;
  }
  // current を渡して estimateFatigueScore の二重計算を避ける（describeForecast 側で計算済み）
  const k = sessionsUntilThreshold(stats, threshold, lookahead, current);
  if (k !== null) {
    return { kind: 'reach', k, threshold, levelLabel: getFatigueLevel(threshold).label };
  }
  const projected = projectFatigueScore(stats, 1);
  return projected > current ? { kind: 'projection', score: projected } : null;
}

// ============================================================
// データエクスポート
// ============================================================

/**
 * CSV形式でエクスポート
 */
export function exportToCSV(stats: Statistics, range: 'week' | 'month' | 'all' = 'all'): string {
  const headers = [
    'Date',
    'Sessions',
    'Focus Time (min)',
    'Break Time (min)',
    'Interrupted',
    'Fatigue Score',
  ];

  let dailyStatsToExport: DailyStats[] = [];

  switch (range) {
    case 'week':
      dailyStatsToExport = stats.week.dailyStats;
      break;
    case 'month': {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
      dailyStatsToExport = [
        ...stats.dailyStatsHistory.filter((d) => d.date >= thirtyDaysAgoStr),
        stats.today,
      ].sort((a, b) => a.date.localeCompare(b.date));
      break;
    }
    case 'all':
      dailyStatsToExport = [
        ...stats.dailyStatsHistory,
        stats.today,
      ].sort((a, b) => a.date.localeCompare(b.date));
      break;
  }

  const rows = dailyStatsToExport.map((day) => [
    day.date,
    day.sessions.toString(),
    day.totalFocusTime.toString(),
    day.totalBreakTime.toString(),
    day.interruptedSessions.toString(),
    day.fatigueScore.toString(),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * テスト用モックデータ生成
 */
export function createMockStats(overrides: { sessions?: number; consecutiveDays?: number } = {}): Statistics {
  const stats = createDefaultStatistics();
  if (overrides.sessions !== undefined) {
    stats.today.sessions = overrides.sessions;
  }
  if (overrides.consecutiveDays !== undefined) {
    const today = new Date();
    for (let i = 0; i < overrides.consecutiveDays; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      if (i === 0) {
        stats.today.date = dateStr;
        stats.today.sessions = 1;
      } else {
        stats.dailyStatsHistory.push({
          ...createDefaultDailyStats(dateStr),
          sessions: 1,
        });
      }
    }
  }
  return stats;
}
