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
  private webviewReady: boolean = false;
  private pendingSound: { url: string; volume: number } | null = null;

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
      // サウンド再生用のWebviewを使用
      if (!this.soundWebviewPanel) {
        this.webviewReady = false;
        this.soundWebviewPanel = this.createSoundWebview();
      }

      const soundFile = type === 'alert' ? 'alert.mp3' : `${type}.mp3`;
      const soundUri = this.soundWebviewPanel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'resources', 'sounds', soundFile)
      );

      const message = {
        command: 'playSound',
        url: soundUri.toString(),
        volume: config.soundVolume / 100,
      };

      if (this.webviewReady) {
        this.soundWebviewPanel.webview.postMessage(message);
      } else {
        // Webviewがまだ準備できていない場合はキューに入れる
        this.pendingSound = { url: message.url, volume: message.volume };
      }
    } catch (error) {
      // サイレント失敗
      console.log('Sound playback failed:', error);
    }
  }

  private createSoundWebview(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'brainSyncSound',
      'BrainSync Sound Player',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources', 'sounds')],
        retainContextWhenHidden: true,
      }
    );

    panel.webview.html = this.getSoundWebviewHtml(panel.webview);

    // Webviewからのメッセージを受信
    panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'ready') {
        this.webviewReady = true;
        // 保留中のサウンドがあれば再生
        if (this.pendingSound && this.soundWebviewPanel) {
          this.soundWebviewPanel.webview.postMessage({
            command: 'playSound',
            url: this.pendingSound.url,
            volume: this.pendingSound.volume,
          });
          this.pendingSound = null;
        }
      } else if (message.command === 'soundComplete') {
        // サウンド再生完了後にパネルを破棄（タブを閉じる）
        this.disposeSoundPanel();
      }
    });

    panel.onDidDispose(() => {
      this.soundWebviewPanel = null;
      this.webviewReady = false;
      this.pendingSound = null;
    });

    // パネル作成後、元のエディタにフォーカスを戻す
    vscode.commands.executeCommand('workbench.action.focusPreviousGroup');

    return panel;
  }

  private disposeSoundPanel(): void {
    if (this.soundWebviewPanel) {
      this.soundWebviewPanel.dispose();
      // onDidDispose で null 化される
    }
  }

  private getSoundWebviewHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    media-src ${webview.cspSource};
    connect-src ${webview.cspSource};
    script-src 'unsafe-inline';
    style-src 'unsafe-inline';
  ">
  <title>BrainSync Sound Player</title>
  <style>
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .status { opacity: 0.7; font-size: 14px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    #playBtn {
      margin-top: 16px;
      padding: 8px 24px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-size: 14px;
      display: none;
    }
    #playBtn:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="icon">🔔</div>
  <p class="status" id="status">サウンドプレーヤー準備完了</p>
  <button id="playBtn">🔊 サウンドを再生</button>
  <script>
    const vscode = acquireVsCodeApi();
    let audioContext = null;
    let pendingMessage = null;

    function getAudioContext() {
      if (!audioContext) {
        audioContext = new AudioContext();
      }
      return audioContext;
    }

    async function playWithAudioContext(url, volume) {
      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        gainNode.gain.value = volume;
        source.buffer = audioBuffer;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        document.getElementById('status').textContent = '♪ サウンド再生中...';
        source.onended = () => {
          document.getElementById('status').textContent = 'サウンドプレーヤー準備完了';
          vscode.postMessage({ command: 'soundComplete' });
        };
      } catch (err) {
        console.error('AudioContext play failed:', err);
        // フォールバック: Audio要素で再生を試みる
        playWithAudioElement(url, volume);
      }
    }

    function playWithAudioElement(url, volume) {
      try {
        const audio = new Audio(url);
        audio.volume = volume;
        audio.onended = () => {
          vscode.postMessage({ command: 'soundComplete' });
        };
        audio.play().catch(err => {
          console.error('Audio element play also failed:', err);
          document.getElementById('status').textContent =
            '⚠️ 自動再生がブロックされました。下のボタンをクリックしてください。';
          document.getElementById('playBtn').style.display = 'inline-block';
          pendingMessage = { url, volume };
        });
      } catch (err) {
        console.error('Audio element creation failed:', err);
      }
    }

    // 手動再生ボタン（autoplayがブロックされた場合のフォールバック）
    document.getElementById('playBtn').addEventListener('click', () => {
      if (pendingMessage) {
        playWithAudioContext(pendingMessage.url, pendingMessage.volume);
        pendingMessage = null;
        document.getElementById('playBtn').style.display = 'none';
      }
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'playSound') {
        playWithAudioContext(message.url, message.volume);
      }
    });

    // 準備完了を通知
    vscode.postMessage({ command: 'ready' });
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
