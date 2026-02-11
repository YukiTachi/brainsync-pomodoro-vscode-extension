import * as vscode from 'vscode';
import { DIAGNOSIS_BASE_URL, UTM_PARAMS, FATIGUE_LEVELS } from './config';

/**
 * UUID v4 を生成する（簡易版）
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 秒数を MM:SS 形式にフォーマット
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 分数を「X時間Y分」形式にフォーマット
 */
export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) {
    return `${mins}分`;
  }
  if (mins === 0) {
    return `${hours}時間`;
  }
  return `${hours}時間${mins}分`;
}

/**
 * 今日の日付を YYYY-MM-DD 形式で取得
 */
export function getTodayDateStr(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * 週の開始日（月曜日）を取得（ISO 8601準拠）
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 週の終了日（日曜日）を取得
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(new Date(date));
  return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
}

/**
 * 脳疲労スコアのレベル情報を取得
 */
export function getFatigueLevel(score: number) {
  if (score <= FATIGUE_LEVELS.good.max) {
    return FATIGUE_LEVELS.good;
  }
  if (score <= FATIGUE_LEVELS.caution.max) {
    return FATIGUE_LEVELS.caution;
  }
  if (score <= FATIGUE_LEVELS.warning.max) {
    return FATIGUE_LEVELS.warning;
  }
  return FATIGUE_LEVELS.danger;
}

/**
 * BrainSync脳疲労診断ページを開く
 */
export function openDiagnosisPage(source: string): void {
  const url = `${DIAGNOSIS_BASE_URL}?utm_source=${UTM_PARAMS.source}&utm_medium=${UTM_PARAMS.medium}&utm_campaign=${source}`;
  const uri = vscode.Uri.parse(url);
  vscode.env.openExternal(uri);
}
