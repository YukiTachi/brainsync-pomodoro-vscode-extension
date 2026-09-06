import * as vscode from 'vscode';
import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getNotificationConfig, getFatigueAlertConfig, getFatigueForecastConfig, getTimerConfig, AlertState, SessionRecord, Statistics } from './config';
import { getFatigueLevel, openDiagnosisPage, formatMinutes, getTodayDateStr } from './utils';
import { describeForecast } from './statistics';
import { Storage } from './storage';

/**
 * 通知コールバック
 */
export interface NotificationCallbacks {
  onStartBreak: (isLongBreak: boolean) => void;
  onSkipBreak: () => void;
  onStartWork: () => void;
  onExtendBreak: () => void;
}

/**
 * 通知管理
 */
export class NotificationManager {
  private storage: Storage;
  private callbacks: NotificationCallbacks;
  private extensionUri: vscode.Uri;

  constructor(
    storage: Storage,
    callbacks: NotificationCallbacks,
    extensionUri: vscode.Uri,
  ) {
    this.storage = storage;
    this.callbacks = callbacks;
    this.extensionUri = extensionUri;
  }

  /**
   * 作業終了通知
   */
  async notifyWorkComplete(
    session: SessionRecord,
    currentSetIndex: number,
    longBreakInterval: number,
    fatigueScore: number,
  ): Promise<void> {
    await this.playSound('work-end');

    const config = getNotificationConfig();
    if (!config.enabled) {return;}

    const timerConfig = getTimerConfig();
    const isLongBreakDue = currentSetIndex > longBreakInterval;
    const workDuration = session.duration;

    if (isLongBreakDue) {
      // 4セット完了
      const level = getFatigueLevel(fatigueScore);
      const breakLabel = `${timerConfig.longBreak}分休憩する`;
      const selection = await vscode.window.showInformationMessage(
        `🌟 ${longBreakInterval}セット完了！素晴らしい！\n推定脳疲労スコア: ${fatigueScore}点 ${level.emoji}`,
        breakLabel,
        '詳しい診断を受ける',
      );

      if (selection === breakLabel) {
        this.callbacks.onStartBreak(true);
      } else if (selection === '詳しい診断を受ける') {
        openDiagnosisPage('session_complete');
      }
    } else {
      const breakLabel = `${timerConfig.shortBreak}分休憩する`;
      const selection = await vscode.window.showInformationMessage(
        `🎉 お疲れ様でした！${workDuration}分の集中、完了しました`,
        breakLabel,
        '休憩をスキップ',
      );

      if (selection === breakLabel) {
        this.callbacks.onStartBreak(false);
      } else if (selection === '休憩をスキップ') {
        this.callbacks.onSkipBreak();
      }
    }
  }

  /**
   * 休憩終了通知
   */
  async notifyBreakComplete(): Promise<void> {
    await this.playSound('break-end');

    const config = getNotificationConfig();
    if (!config.enabled) {return;}

    const selection = await vscode.window.showInformationMessage(
      '⚡ リフレッシュできましたか？\n次のセッションを始めましょう',
      '開始する',
      'もう少し休憩',
    );

    if (selection === '開始する') {
      this.callbacks.onStartWork();
    } else if (selection === 'もう少し休憩') {
      this.callbacks.onExtendBreak();
    }
  }

  /**
   * 脳疲労アラート通知（頻度制御付き）
   */
  async checkAndNotifyFatigueAlert(fatigueScore: number): Promise<void> {
    const alertConfig = getFatigueAlertConfig();
    if (!alertConfig.enabled) {return;}
    if (fatigueScore < alertConfig.threshold) {return;}

    // 重複防止チェック
    const alertState = this.storage.getAlertState();
    const today = getTodayDateStr();

    if (alertState.lastAlertDate === today) {
      // 同日既にアラート済み: スコアが5点以上上昇した場合のみ再表示
      if (fatigueScore - alertState.lastAlertScore < 5) {
        return;
      }
    }

    // アラート状態を更新（先読み用フィールドを消さないようスプレッドで更新）
    const newAlertState: AlertState = {
      ...alertState,
      lastAlertDate: today,
      lastAlertScore: fatigueScore,
    };
    await this.storage.saveAlertState(newAlertState);

    await this.playSound('alert');

    const notifConfig = getNotificationConfig();
    if (!notifConfig.enabled) {return;}

    const level = getFatigueLevel(fatigueScore);
    const selection = await vscode.window.showWarningMessage(
      `⚠️ 脳疲労が蓄積しています（推定スコア: ${fatigueScore}点 ${level.emoji}）\n今日はこれ以上の作業を控え、十分な休息を取ることを推奨`,
      '詳しい診断を受ける',
      '閉じる',
    );

    if (selection === '詳しい診断を受ける') {
      openDiagnosisPage('fatigue_alert');
    }
  }

  /**
   * 脳疲労スコアの先読み警告（頻度制御付き）
   * セッション完了時に、現在の作業ペースだと閾値へ到達する見込みを事前に知らせる。
   * 現在すでに閾値以上のときは既存アラート（checkAndNotifyFatigueAlert）の領分なので出さない。
   */
  async checkAndNotifyFatigueForecast(stats: Statistics): Promise<void> {
    const alertConfig = getFatigueAlertConfig();
    const forecastConfig = getFatigueForecastConfig();
    // サウンドは鳴らさないので、通知を出さない設定なら状態も更新せず早期 return
    if (!alertConfig.enabled || !forecastConfig.enabled) {return;}
    if (!getNotificationConfig().enabled) {return;}

    const fc = describeForecast(stats, alertConfig.threshold, forecastConfig.lookahead);
    if (!fc || fc.kind !== 'reach') {return;} // 到達しない / 既に超過 / 上昇のみ は出さない
    const k = fc.k;

    // 頻度制御: 同日・同じ残り数以上なら出さない（残りが減ったときだけ再通知）
    const alertState = this.storage.getAlertState();
    const today = getTodayDateStr();
    if (
      alertState.lastForecastDate === today &&
      alertState.lastForecastRemaining !== null &&
      k >= alertState.lastForecastRemaining
    ) {
      return;
    }
    await this.storage.saveAlertState({
      ...alertState,
      lastForecastDate: today,
      lastForecastRemaining: k,
    });

    const score = stats.today.fatigueScore;
    const when = k === 1 ? '次のセット' : `あと ${k} セット`;
    const selection = await vscode.window.showWarningMessage(
      `⚠️ このペースだと、${when}で「${fc.levelLabel}」（${fc.threshold}点）に達します（現在 ${score}点）`,
      '詳しい診断を受ける',
      '閉じる',
    );

    if (selection === '詳しい診断を受ける') {
      openDiagnosisPage('fatigue_forecast');
    }
  }

  // ============================================================
  // Sound (child_process 方式)
  // ============================================================

  private async playSound(type: 'work-end' | 'break-end' | 'alert'): Promise<void> {
    const config = getNotificationConfig();
    if (!config.soundEnabled || config.soundFile === 'silent') {
      return;
    }

    try {
      const soundFile = type === 'alert' ? 'alert.mp3' : `${type}.mp3`;
      const soundPath = vscode.Uri.joinPath(
        this.extensionUri, 'resources', 'sounds', config.soundFile, soundFile,
      ).fsPath;

      const volume = config.soundVolume / 100;
      await this.executeAudioCommand(soundPath, volume);
    } catch (error) {
      console.log('Sound playback failed:', error);
    }
  }

  /**
   * プラットフォームに応じたオーディオコマンドでサウンドを再生
   */
  private executeAudioCommand(filePath: string, volume: number): Promise<void> {
    return new Promise((resolve) => {
      const { command, args, options } = this.getAudioCommand(filePath, volume);

      execFile(command, args, options, (error) => {
        if (error) {
          console.log(`Sound command failed (${command}):`, error.message);
        }
        resolve();
      });
    });
  }

  /**
   * プラットフォーム検出に基づいてオーディオコマンドを決定
   */
  getAudioCommand(
    filePath: string,
    volume: number,
  ): { command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } } {
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS: afplay (プリインストール済み)
      return {
        command: 'afplay',
        args: [filePath, '-v', String(volume)],
        options: {},
      };
    }

    if (platform === 'win32') {
      return this.getPowerShellCommand(filePath, volume);
    }

    // Linux
    if (this.isWSL()) {
      // WSL: wslpath でWindows パスに変換し、PowerShell で再生
      try {
        const winPath = execFileSync('wslpath', ['-w', filePath]).toString().trim();
        return this.getPowerShellCommand(winPath, volume);
      } catch {
        // wslpath 失敗時は mpg123 にフォールバック
      }
    }

    // ネイティブ Linux: mpg123 を使用（sudo apt install mpg123）
    return {
      command: 'mpg123',
      args: ['-q', '-f', String(Math.round(volume * 32768)), filePath],
      options: {},
    };
  }

  /**
   * PowerShell で MediaPlayer を使用してサウンドを再生するコマンドを生成
   */
  private getPowerShellCommand(
    filePath: string,
    volume: number,
  ): { command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } } {
    const psScript = [
      'Add-Type -AssemblyName presentationCore;',
      '$p = New-Object System.Windows.Media.MediaPlayer;',
      `$p.Volume = ${volume};`,
      `$p.Open([Uri]'${filePath}');`,
      'Start-Sleep -Seconds 1;',
      '$p.Play();',
      'Start-Sleep -Seconds 3;',
    ].join(' ');
    const cmd = this.isWSL() ? 'powershell.exe' : 'powershell';
    return {
      command: cmd,
      args: ['-NoProfile', '-Command', psScript],
      options: {},
    };
  }

  /**
   * WSL 環境かどうかを検出
   */
  private isWSL(): boolean {
    try {
      const version = fs.readFileSync('/proc/version', 'utf8');
      return /microsoft|wsl/i.test(version);
    } catch {
      return false;
    }
  }

  dispose(): void {
    // child_process 方式ではクリーンアップ不要
  }
}
