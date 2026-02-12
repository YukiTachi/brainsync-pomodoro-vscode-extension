import * as vscode from 'vscode';
import {
  TimerState,
  TimerData,
  SessionRecord,
  TimerConfig,
  createDefaultTimerData,
  getTimerConfig,
} from './config';
import { Storage } from './storage';
import { generateUUID } from './utils';

/**
 * タイマーイベント
 */
export interface TimerEvents {
  onTick: (remainingTime: number, state: TimerState) => void;
  onWorkComplete: (session: SessionRecord) => void;
  onBreakComplete: (session: SessionRecord) => void;
  onStateChange: (state: TimerState) => void;
}

/**
 * ポモドーロタイマーのコアロジック
 */
export class Timer {
  private data: TimerData;
  private config: TimerConfig;
  private storage: Storage;
  private events: TimerEvents;
  private interval: ReturnType<typeof setInterval> | null = null;
  private sessionStartTime: string | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor(storage: Storage, events: TimerEvents, outputChannel: vscode.OutputChannel) {
    this.storage = storage;
    this.events = events;
    this.outputChannel = outputChannel;
    this.config = getTimerConfig();
    this.data = createDefaultTimerData();
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * 保存された状態から復元
   */
  restore(): void {
    this.config = getTimerConfig();
    const saved = this.storage.getTimerData();

    if (saved.state === 'idle') {
      this.data = createDefaultTimerData();
      this.data.currentSetIndex = saved.currentSetIndex;
      return;
    }

    if (saved.state === 'paused') {
      this.data = saved;
      this.events.onStateChange(this.data.state);
      this.events.onTick(this.data.remainingTime, this.data.state);
      return;
    }

    // working or breaking: 差分計算で復元
    if (saved.startTimestamp) {
      const elapsed = (Date.now() - saved.startTimestamp) / 1000;

      // 異常ケース: 未来のタイムスタンプ or 24時間超
      if (elapsed < 0 || elapsed > 86400) {
        this.log('Timer data is abnormal, resetting');
        this.data = createDefaultTimerData();
        this.data.currentSetIndex = saved.currentSetIndex;
        this.persist();
        return;
      }

      const remaining = saved.totalDuration - elapsed;
      if (remaining <= 0) {
        // セッション完了: 完了処理を行う
        this.data = saved;
        this.data.remainingTime = 0;
        this.handleSessionComplete();
        return;
      }

      this.data = saved;
      this.data.remainingTime = remaining;
      this.startInterval();
      this.events.onStateChange(this.data.state);
      this.events.onTick(this.data.remainingTime, this.data.state);
    }
  }

  /**
   * 作業タイマーを開始
   */
  startWork(): void {
    this.config = getTimerConfig();
    const durationSec = this.config.workDuration * 60;

    this.data.state = 'working';
    this.data.previousState = null;
    this.data.remainingTime = durationSec;
    this.data.totalDuration = durationSec;
    this.data.startTimestamp = Date.now();
    this.data.pausedAt = null;
    this.sessionStartTime = new Date().toISOString();

    this.persist();
    this.startInterval();
    this.events.onStateChange(this.data.state);
    this.events.onTick(this.data.remainingTime, this.data.state);
  }

  /**
   * 休憩タイマーを開始
   */
  startBreak(isLongBreak: boolean = false): void {
    this.config = getTimerConfig();
    const duration = isLongBreak ? this.config.longBreak : this.config.shortBreak;
    const durationSec = duration * 60;

    this.data.state = 'breaking';
    this.data.previousState = null;
    this.data.remainingTime = durationSec;
    this.data.totalDuration = durationSec;
    this.data.startTimestamp = Date.now();
    this.data.pausedAt = null;
    this.sessionStartTime = new Date().toISOString();

    this.persist();
    this.startInterval();
    this.events.onStateChange(this.data.state);
    this.events.onTick(this.data.remainingTime, this.data.state);
  }

  /**
   * 一時停止 / 再開 のトグル
   */
  togglePause(): void {
    if (this.data.state === 'paused') {
      this.resume();
    } else if (this.data.state === 'working' || this.data.state === 'breaking') {
      this.pause();
    }
  }

  /**
   * 一時停止
   */
  pause(): void {
    if (this.data.state !== 'working' && this.data.state !== 'breaking') {
      return;
    }

    this.stopInterval();

    // 現在の残り時間を正確に計算
    if (this.data.startTimestamp) {
      const elapsed = (Date.now() - this.data.startTimestamp) / 1000;
      this.data.remainingTime = Math.max(0, this.data.totalDuration - elapsed);
    }

    this.data.previousState = this.data.state as 'working' | 'breaking';
    this.data.state = 'paused';
    this.data.pausedAt = Date.now();

    this.persist();
    this.events.onStateChange(this.data.state);
    this.events.onTick(this.data.remainingTime, this.data.state);
  }

  /**
   * 再開
   */
  resume(): void {
    if (this.data.state !== 'paused' || !this.data.previousState) {
      return;
    }

    this.data.state = this.data.previousState;
    this.data.previousState = null;
    this.data.totalDuration = this.data.remainingTime;
    this.data.startTimestamp = Date.now();
    this.data.pausedAt = null;

    this.persist();
    this.startInterval();
    this.events.onStateChange(this.data.state);
    this.events.onTick(this.data.remainingTime, this.data.state);
  }

  /**
   * タイマーリセット
   */
  reset(): SessionRecord | null {
    this.stopInterval();

    let record: SessionRecord | null = null;

    // 進行中のセッションがあれば中断レコードを作成
    if (
      (this.data.state === 'working' || this.data.state === 'breaking' || this.data.state === 'paused') &&
      this.sessionStartTime
    ) {
      const actualState = this.data.state === 'paused' ? this.data.previousState : this.data.state;
      record = {
        id: generateUUID(),
        startTime: this.sessionStartTime,
        endTime: new Date().toISOString(),
        duration: Math.round((this.data.totalDuration - this.data.remainingTime) / 60),
        type: actualState === 'breaking' ? 'break' : 'work',
        completed: false,
      };
    }

    const prevSetIndex = this.data.currentSetIndex;
    this.data = createDefaultTimerData();
    this.data.currentSetIndex = prevSetIndex;
    this.sessionStartTime = null;

    this.persist();
    this.events.onStateChange(this.data.state);
    this.events.onTick(0, this.data.state);

    return record;
  }

  /**
   * 休憩をスキップして次の作業を開始
   */
  skipBreak(): void {
    if (this.data.state !== 'breaking' && !(this.data.state === 'paused' && this.data.previousState === 'breaking')) {
      return;
    }
    this.stopInterval();
    this.sessionStartTime = null;
    this.startWork();
  }

  // ============================================================
  // Getters
  // ============================================================

  getState(): TimerState {
    return this.data.state;
  }

  getRemainingTime(): number {
    return this.data.remainingTime;
  }

  getCurrentSetIndex(): number {
    return this.data.currentSetIndex;
  }

  getTimerData(): TimerData {
    return { ...this.data };
  }

  isLongBreakDue(): boolean {
    return this.data.currentSetIndex > this.config.longBreakInterval;
  }

  /**
   * 設定を再読み込み
   */
  reloadConfig(): void {
    this.config = getTimerConfig();
  }

  // ============================================================
  // Private
  // ============================================================

  private startInterval(): void {
    this.stopInterval();
    this.interval = setInterval(() => {
      this.tick();
    }, 1000);
  }

  private stopInterval(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private tick(): void {
    if (this.data.state !== 'working' && this.data.state !== 'breaking') {
      return;
    }

    if (this.data.startTimestamp) {
      const elapsed = (Date.now() - this.data.startTimestamp) / 1000;
      this.data.remainingTime = Math.max(0, this.data.totalDuration - elapsed);
    }

    if (this.data.remainingTime <= 0) {
      this.handleSessionComplete();
    } else {
      this.events.onTick(this.data.remainingTime, this.data.state);
    }
  }

  private handleSessionComplete(): void {
    this.stopInterval();

    const endTime = new Date().toISOString();
    const isWork = this.data.state === 'working';

    const record: SessionRecord = {
      id: generateUUID(),
      startTime: this.sessionStartTime || endTime,
      endTime,
      duration: Math.round(this.data.totalDuration / 60),
      type: isWork ? 'work' : 'break',
      completed: true,
    };

    if (isWork) {
      this.data.currentSetIndex++;
      this.events.onWorkComplete(record);

      // 長い休憩サイクル完了後にcurrentSetIndexをリセット
      // NOTE: onWorkComplete内でイベントハンドラがcurrentSetIndexを参照した後にリセットする
      if (this.data.currentSetIndex > this.config.longBreakInterval) {
        this.data.currentSetIndex = 1;
      }
    } else {
      this.events.onBreakComplete(record);
    }

    // アイドル状態に戻す
    this.data.state = 'idle';
    this.data.previousState = null;
    this.data.remainingTime = 0;
    this.data.startTimestamp = null;
    this.data.pausedAt = null;
    this.data.totalDuration = 0;
    this.sessionStartTime = null;

    this.persist();
    this.events.onStateChange(this.data.state);
  }

  private persist(): void {
    this.storage.saveTimerData(this.data);
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] Timer: ${message}`);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopInterval();
  }
}
