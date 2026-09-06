import * as vscode from 'vscode';

// ============================================================
// タイマーの状態
// ============================================================
export type TimerState = 'idle' | 'working' | 'breaking' | 'paused';

// ============================================================
// タイマー設定
// ============================================================
export interface TimerConfig {
  workDuration: number;      // 分
  shortBreak: number;        // 分
  longBreak: number;         // 分
  longBreakInterval: number; // セット数
  autoStartBreak: boolean;
  autoStartWork: boolean;
}

// ============================================================
// タイマー状態データ
// ============================================================
export interface TimerData {
  state: TimerState;
  previousState: 'working' | 'breaking' | null;
  remainingTime: number;         // 秒
  currentSetIndex: number;       // 長い休憩サイクル内での現在のセット番号（1～longBreakInterval）
  startTimestamp: number | null; // タイマー開始時刻（エポックミリ秒）
  pausedAt: number | null;       // 一時停止時刻（エポックミリ秒）
  totalDuration: number;         // 秒（復元用）
}

// ============================================================
// セッション記録
// ============================================================
export interface SessionRecord {
  id: string;
  startTime: string;   // ISO 8601
  endTime: string;     // ISO 8601
  duration: number;    // 分
  type: 'work' | 'break';
  completed: boolean;
}

// ============================================================
// 日次統計
// ============================================================
export interface DailyStats {
  date: string;               // YYYY-MM-DD
  sessions: number;
  totalFocusTime: number;     // 分
  totalBreakTime: number;     // 分
  interruptedSessions: number;
  fatigueScore: number;
}

// ============================================================
// 週次統計
// ============================================================
export interface WeeklyStats {
  weekStart: string;  // YYYY-MM-DD
  weekEnd: string;    // YYYY-MM-DD
  totalSessions: number;
  totalFocusTime: number; // 分
  dailyAverage: number;
  fatigueScore: number;
  dailyStats: DailyStats[];
}

// ============================================================
// 統計データ全体
// ============================================================
export interface Statistics {
  today: DailyStats;
  week: WeeklyStats;
  allTime: {
    totalSessions: number;
    totalFocusTime: number; // 分
    startDate: string;      // YYYY-MM-DD
  };
  history: SessionRecord[];
  dailyStatsHistory: DailyStats[];
}

// ============================================================
// アラート状態
// ============================================================
export interface AlertState {
  lastAlertDate: string | null;         // YYYY-MM-DD（既存アラート）
  lastAlertScore: number;               // 既存アラート
  lastForecastDate: string | null;      // YYYY-MM-DD（先読み警告を最後に出した日）
  lastForecastRemaining: number | null; // そのときの残りセット数 k
}

// ============================================================
// 設定データ
// ============================================================
export interface Configuration {
  timer: TimerConfig;
  notification: {
    enabled: boolean;
    soundEnabled: boolean;
    soundVolume: number;
    soundFile: 'bell' | 'chime' | 'silent';
  };
  fatigueAlert: {
    enabled: boolean;
    threshold: number;
  };
}

// ============================================================
// Global State キー
// ============================================================
export const STORAGE_KEYS = {
  statistics: 'brainsync.statistics',
  timerData: 'brainsync.timerData',
  configuration: 'brainsync.configuration',
  alertState: 'brainsync.alertState',
} as const;

// ============================================================
// 定数
// ============================================================
export const DIAGNOSIS_BASE_URL = 'https://donut-service.com/brain-fatigue-assessment/';

export const UTM_PARAMS = {
  source: 'vscode',
  medium: 'extension',
} as const;

export const FATIGUE_LEVELS = {
  good: { min: 0, max: 10, label: '良好', emoji: '🟢' },
  caution: { min: 11, max: 20, label: 'やや注意', emoji: '🟡' },
  warning: { min: 21, max: 30, label: '警戒', emoji: '🟠' },
  danger: { min: 31, max: 45, label: '危険', emoji: '🔴' },
} as const;

export const MAX_HISTORY_RECORDS = 1000;
export const MAX_DAILY_STATS_HISTORY = 90;

// ============================================================
// デフォルト値
// ============================================================
export function createDefaultTimerData(): TimerData {
  return {
    state: 'idle',
    previousState: null,
    remainingTime: 0,
    currentSetIndex: 1,
    startTimestamp: null,
    pausedAt: null,
    totalDuration: 0,
  };
}

export function createDefaultDailyStats(date: string): DailyStats {
  return {
    date,
    sessions: 0,
    totalFocusTime: 0,
    totalBreakTime: 0,
    interruptedSessions: 0,
    fatigueScore: 0,
  };
}

export function createDefaultWeeklyStats(): WeeklyStats {
  return {
    weekStart: '',
    weekEnd: '',
    totalSessions: 0,
    totalFocusTime: 0,
    dailyAverage: 0,
    fatigueScore: 0,
    dailyStats: [],
  };
}

export function createDefaultStatistics(): Statistics {
  const today = new Date().toISOString().split('T')[0];
  return {
    today: createDefaultDailyStats(today),
    week: createDefaultWeeklyStats(),
    allTime: {
      totalSessions: 0,
      totalFocusTime: 0,
      startDate: today,
    },
    history: [],
    dailyStatsHistory: [],
  };
}

export function createDefaultAlertState(): AlertState {
  return {
    lastAlertDate: null,
    lastAlertScore: 0,
    lastForecastDate: null,
    lastForecastRemaining: null,
  };
}

// ============================================================
// 設定読み取り
// ============================================================
export function getTimerConfig(): TimerConfig {
  const config = vscode.workspace.getConfiguration('brainsync');
  return {
    workDuration: config.get<number>('workDuration', 30),
    shortBreak: config.get<number>('shortBreak', 5),
    longBreak: config.get<number>('longBreak', 15),
    longBreakInterval: config.get<number>('longBreakInterval', 4),
    autoStartBreak: config.get<boolean>('autoStartBreak', true),
    autoStartWork: config.get<boolean>('autoStartWork', false),
  };
}

export function getNotificationConfig() {
  const config = vscode.workspace.getConfiguration('brainsync');
  return {
    enabled: config.get<boolean>('notificationEnabled', true),
    soundEnabled: config.get<boolean>('soundEnabled', true),
    soundVolume: config.get<number>('soundVolume', 50),
    soundFile: config.get<string>('soundFile', 'bell') as 'bell' | 'chime' | 'silent',
  };
}

export function getFatigueAlertConfig() {
  const config = vscode.workspace.getConfiguration('brainsync');
  return {
    enabled: config.get<boolean>('fatigueAlertEnabled', true),
    threshold: config.get<number>('fatigueAlertThreshold', 21),
  };
}

export function getFatigueForecastConfig() {
  const config = vscode.workspace.getConfiguration('brainsync');
  const raw = config.get<number>('fatigueForecastLookahead', 2);
  // settings.json 直書きは UI の min/max を通らないため、ここでクランプする
  const lookahead = Math.max(1, Math.min(4, Math.round(raw)));
  return {
    enabled: config.get<boolean>('fatigueForecastEnabled', true),
    lookahead,
  };
}
