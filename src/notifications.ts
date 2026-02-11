import * as vscode from 'vscode';
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
  private soundWebviewPanel: vscode.WebviewPanel | null = null;
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
  // Sound
  // ============================================================

  private async playSound(type: 'work-end' | 'break-end' | 'alert'): Promise<void> {
    const config = getNotificationConfig();
    if (!config.soundEnabled || config.soundFile === 'silent') {
      return;
    }

    try {
      // サウンド再生用の非表示Webviewを使用
      if (!this.soundWebviewPanel) {
        this.soundWebviewPanel = this.createSoundWebview();
      }

      const soundFile = type === 'alert' ? 'alert.mp3' : `${type}.mp3`;
      const soundUri = this.soundWebviewPanel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'resources', 'sounds', soundFile)
      );

      this.soundWebviewPanel.webview.postMessage({
        command: 'playSound',
        url: soundUri.toString(),
        volume: config.soundVolume / 100,
      });
    } catch (error) {
      // サイレント失敗
      console.log('Sound playback failed:', error);
    }
  }

  private createSoundWebview(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'brainSyncSound',
      'BrainSync Sound',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources', 'sounds')],
        retainContextWhenHidden: true,
      }
    );

    // 非表示にする（パネルを閉じないが見えない状態にはできないので最小化）
    // 実際にはVS Code APIでは完全に非表示にできないため、retainContextWhenHiddenを利用
    panel.webview.html = this.getSoundWebviewHtml(panel.webview);

    panel.onDidDispose(() => {
      this.soundWebviewPanel = null;
    });

    return panel;
  }

  private getSoundWebviewHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    media-src ${webview.cspSource};
    script-src 'unsafe-inline';
  ">
  <title>BrainSync Sound</title>
</head>
<body>
  <p>BrainSync Sound Player</p>
  <script>
    const vscode = acquireVsCodeApi();
    let audio = null;

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'playSound') {
        if (audio) {
          audio.pause();
          audio = null;
        }
        audio = new Audio(message.url);
        audio.volume = message.volume;
        audio.play().catch(err => {
          console.error('Audio play failed:', err);
        });
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    if (this.soundWebviewPanel) {
      this.soundWebviewPanel.dispose();
      this.soundWebviewPanel = null;
    }
  }
}
