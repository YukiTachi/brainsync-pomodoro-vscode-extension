import {
  Statistics,
  DailyStats,
  SessionRecord,
  MAX_HISTORY_RECORDS,
  MAX_DAILY_STATS_HISTORY,
  createDefaultDailyStats,
  createDefaultStatistics,
} from './config';
import { getTodayDateStr, getWeekStart, getWeekEnd } from './utils';

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
 * 今日の統計を更新
 */
export function updateTodayStats(stats: Statistics, newSession: SessionRecord): Statistics {
  const today = getTodayDateStr();

  // 日付が変わった場合
  if (stats.today.date !== today) {
    if (stats.today.date && (stats.today.sessions > 0 || stats.today.interruptedSessions > 0)) {
      stats.dailyStatsHistory.push({ ...stats.today });
      if (stats.dailyStatsHistory.length > MAX_DAILY_STATS_HISTORY) {
        stats.dailyStatsHistory.shift();
      }
    }
    stats.today = createDefaultDailyStats(today);
  }

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
  stats.today.fatigueScore = estimateFatigueScore(stats);

  return stats;
}

/**
 * 週次統計を更新
 */
export function updateWeeklyStats(stats: Statistics): Statistics {
  const today = new Date();
  const weekStart = getWeekStart(today);
  const weekEnd = getWeekEnd(today);

  const dailyStats: DailyStats[] = [];
  let totalSessions = 0;
  let totalFocusTime = 0;

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
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
    fatigueScore: estimateFatigueScore(stats),
    dailyStats,
  };

  return stats;
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
