import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getNotificationConfig, getFatigueAlertConfig, AlertState, SessionRecord } from './config';
import { getFatigueLevel, openDiagnosisPage, formatMinutes, getTodayDateStr } from './utils';
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
    const config = getNotificationConfig();
    if (!config.enabled) {return;}

    await this.playSound('work-end');

    const isLongBreakDue = currentSetIndex > longBreakInterval;
    const workDuration = session.duration;

    if (isLongBreakDue) {
      // 4セット完了
      const level = getFatigueLevel(fatigueScore);
      const selection = await vscode.window.showInformationMessage(
        `🌟 ${longBreakInterval}セット完了！素晴らしい！\n推定脳疲労スコア: ${fatigueScore}点 ${level.emoji}`,
        '15分休憩する',
        '詳しい診断を受ける',
      );

      if (selection === '15分休憩する') {
        this.callbacks.onStartBreak(true);
      } else if (selection === '詳しい診断を受ける') {
        openDiagnosisPage('session_complete');
      }
    } else {
      const selection = await vscode.window.showInformationMessage(
        `🎉 お疲れ様でした！${workDuration}分の集中、完了しました`,
        '5分休憩する',
        '休憩をスキップ',
      );

      if (selection === '5分休憩する') {
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
    const config = getNotificationConfig();
    if (!config.enabled) {return;}

    await this.playSound('break-end');

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

    const notifConfig = getNotificationConfig();
    if (!notifConfig.enabled) {return;}

    // 重複防止チェック
    const alertState = this.storage.getAlertState();
    const today = getTodayDateStr();

    if (alertState.lastAlertDate === today) {
      // 同日既にアラート済み: スコアが5点以上上昇した場合のみ再表示
      if (fatigueScore - alertState.lastAlertScore < 5) {
        return;
      }
    }

    // アラート状態を更新
    const newAlertState: AlertState = {
      lastAlertDate: today,
      lastAlertScore: fatigueScore,
    };
    await this.storage.saveAlertState(newAlertState);

    await this.playSound('alert');

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
        this.extensionUri, 'resources', 'sounds', soundFile,
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
      // Windows: PowerShell で MediaPlayer を使用（MP3 対応）
      const psScript = [
        'Add-Type -AssemblyName presentationCore;',
        '$p = New-Object System.Windows.Media.MediaPlayer;',
        `$p.Open([Uri]"${filePath.replace(/\\/g, '/')}");`,
        `$p.Volume = ${volume};`,
        '$p.Play();',
        'Start-Sleep -Seconds 5;',
      ].join(' ');
      return {
        command: 'powershell',
        args: ['-NoProfile', '-Command', psScript],
        options: {},
      };
    }

    // Linux（WSL 含む）
    if (this.isWSL()) {
      // WSL: PULSE_SERVER を明示的に設定して paplay を使用
      return {
        command: 'paplay',
        args: [filePath, `--volume=${Math.round(volume * 65536)}`],
        options: {
          env: { ...process.env, PULSE_SERVER: '/mnt/wslg/PulseServer' },
        },
      };
    }

    // ネイティブ Linux: paplay を使用
    return {
      command: 'paplay',
      args: [filePath, `--volume=${Math.round(volume * 65536)}`],
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
