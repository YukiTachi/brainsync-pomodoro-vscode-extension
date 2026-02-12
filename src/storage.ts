import * as vscode from 'vscode';
import {
  Statistics,
  TimerData,
  AlertState,
  STORAGE_KEYS,
  createDefaultStatistics,
  createDefaultTimerData,
  createDefaultAlertState,
} from './config';

/**
 * Global State を使用したデータ永続化レイヤー
 */
export class Storage {
  private context: vscode.ExtensionContext;
  private outputChannel: vscode.OutputChannel;

  constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.context = context;
    this.outputChannel = outputChannel;
  }

  // ============================================================
  // Statistics
  // ============================================================

  getStatistics(): Statistics {
    try {
      const data = this.context.globalState.get<Statistics>(STORAGE_KEYS.statistics);
      if (data && this.validateStatistics(data)) {
        return data;
      }
    } catch (error) {
      this.logError('Failed to read statistics', error);
    }
    return createDefaultStatistics();
  }

  async saveStatistics(stats: Statistics): Promise<void> {
    try {
      await this.context.globalState.update(STORAGE_KEYS.statistics, stats);
    } catch (error) {
      this.logError('Failed to save statistics', error);
    }
  }

  // ============================================================
  // TimerData
  // ============================================================

  getTimerData(): TimerData {
    try {
      const data = this.context.globalState.get<TimerData>(STORAGE_KEYS.timerData);
      if (data && this.validateTimerData(data)) {
        return data;
      }
    } catch (error) {
      this.logError('Failed to read timer data', error);
    }
    return createDefaultTimerData();
  }

  async saveTimerData(timerData: TimerData): Promise<void> {
    try {
      await this.context.globalState.update(STORAGE_KEYS.timerData, timerData);
    } catch (error) {
      this.logError('Failed to save timer data', error);
    }
  }

  // ============================================================
  // AlertState
  // ============================================================

  getAlertState(): AlertState {
    try {
      const data = this.context.globalState.get<AlertState>(STORAGE_KEYS.alertState);
      if (data) {
        return data;
      }
    } catch (error) {
      this.logError('Failed to read alert state', error);
    }
    return createDefaultAlertState();
  }

  async saveAlertState(alertState: AlertState): Promise<void> {
    try {
      await this.context.globalState.update(STORAGE_KEYS.alertState, alertState);
    } catch (error) {
      this.logError('Failed to save alert state', error);
    }
  }

  // ============================================================
  // Reset
  // ============================================================

  async resetAll(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEYS.statistics, undefined);
    await this.context.globalState.update(STORAGE_KEYS.timerData, undefined);
    await this.context.globalState.update(STORAGE_KEYS.alertState, undefined);
  }

  async resetStatistics(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEYS.statistics, undefined);
    await this.context.globalState.update(STORAGE_KEYS.alertState, undefined);
  }

  // ============================================================
  // Validation
  // ============================================================

  private validateStatistics(data: any): data is Statistics {
    return (
      data &&
      typeof data === 'object' &&
      data.today &&
      typeof data.today.date === 'string' &&
      typeof data.today.sessions === 'number' &&
      Array.isArray(data.history) &&
      Array.isArray(data.dailyStatsHistory)
    );
  }

  private validateTimerData(data: any): data is TimerData {
    return (
      data &&
      typeof data === 'object' &&
      typeof data.state === 'string' &&
      typeof data.remainingTime === 'number' &&
      typeof data.currentSetIndex === 'number'
    );
  }

  // ============================================================
  // Logging
  // ============================================================

  private logError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.outputChannel.appendLine(
      `[${new Date().toISOString()}] ERROR: ${message} - ${errorMessage}`
    );
  }
}
