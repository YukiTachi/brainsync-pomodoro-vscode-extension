import * as vscode from 'vscode';
import { Timer, TimerEvents } from './timer';
import { StatusBar } from './statusBar';
import { NotificationManager, NotificationCallbacks } from './notifications';
import { StatsViewProvider } from './webview/statsViewProvider';
import { Storage } from './storage';
import {
  SessionRecord,
  TimerState,
  getTimerConfig,
  createDefaultStatistics,
} from './config';
import {
  updateTodayStats,
  updateWeeklyStats,
  exportToCSV,
} from './statistics';
import { openDiagnosisPage, getTodayDateStr } from './utils';

let timer: Timer;
let statusBar: StatusBar;
let notificationManager: NotificationManager;
let statsViewProvider: StatsViewProvider;
let storage: Storage;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('BrainSync');
  outputChannel.appendLine(`[${new Date().toISOString()}] BrainSync Focus Timer activated`);

  // ストレージ初期化
  storage = new Storage(context, outputChannel);

  // ステータスバー初期化
  statusBar = new StatusBar();

  // 統計Webview
  statsViewProvider = new StatsViewProvider(context.extensionUri);

  // タイマーイベント定義
  const timerEvents: TimerEvents = {
    onTick: (remainingTime: number, state: TimerState) => {
      statusBar.update(remainingTime, state);
    },

    onWorkComplete: (session: SessionRecord) => {
      handleWorkComplete(session);
    },

    onBreakComplete: (session: SessionRecord) => {
      handleBreakComplete(session);
    },

    onStateChange: (state: TimerState) => {
      if (state === 'idle') {
        statusBar.update(0, state);
      }
    },
  };

  // 通知コールバック定義
  const notificationCallbacks: NotificationCallbacks = {
    onStartBreak: (isLongBreak: boolean) => {
      timer.startBreak(isLongBreak);
    },
    onSkipBreak: () => {
      timer.startWork();
    },
    onStartWork: () => {
      timer.startWork();
    },
    onExtendBreak: () => {
      // 短い休憩を再度開始
      timer.startBreak(false);
    },
  };

  // 通知マネージャ初期化
  notificationManager = new NotificationManager(
    storage,
    notificationCallbacks,
    context.extensionUri,
  );

  // タイマー初期化
  timer = new Timer(storage, timerEvents, outputChannel);

  // 保存された状態から復元
  timer.restore();

  // ============================================================
  // コマンド登録
  // ============================================================

  // タイマー開始
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.startTimer', () => {
      const state = timer.getState();
      if (state === 'idle') {
        timer.startWork();
      } else if (state === 'paused') {
        timer.togglePause();
      }
    })
  );

  // 一時停止/再開
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.pauseTimer', () => {
      timer.togglePause();
    })
  );

  // リセット
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.resetTimer', () => {
      const record = timer.reset();
      if (record && record.type === 'work' && !record.completed) {
        recordSession(record);
      }
    })
  );

  // 休憩スキップ
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.skipBreak', () => {
      timer.skipBreak();
    })
  );

  // 統計表示
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.viewStats', () => {
      const stats = storage.getStatistics();
      const updatedStats = updateWeeklyStats(stats);
      storage.saveStatistics(updatedStats);
      statsViewProvider.show(updatedStats);
    })
  );

  // 診断ページを開く
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.openDiagnosis', () => {
      openDiagnosisPage('command_palette');
    })
  );

  // データエクスポート
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.exportData', async () => {
      const stats = storage.getStatistics();
      const updatedStats = updateWeeklyStats(stats);

      const range = await vscode.window.showQuickPick(
        [
          { label: '今週', value: 'week' as const },
          { label: '過去30日', value: 'month' as const },
          { label: '全期間', value: 'all' as const },
        ],
        { placeHolder: 'エクスポート範囲を選択' }
      );

      if (!range) {return;}

      const csv = exportToCSV(updatedStats, range.value);

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`brainsync-stats-${getTodayDateStr()}.csv`),
        filters: { 'CSV Files': ['csv'] },
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
        vscode.window.showInformationMessage('統計データをエクスポートしました');
      }
    })
  );

  // 統計リセット
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.resetStats', async () => {
      const confirm = await vscode.window.showWarningMessage(
        '統計データをすべてリセットしますか？この操作は元に戻せません。',
        { modal: true },
        'リセット',
      );

      if (confirm === 'リセット') {
        await storage.resetStatistics();
        vscode.window.showInformationMessage('統計データをリセットしました');
      }
    })
  );

  // 設定を開く
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.settings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:donut-service.brainsync-focus-timer'
      );
    })
  );

  // クイックピックメニュー（内部コマンド）
  context.subscriptions.push(
    vscode.commands.registerCommand('brainsync.showQuickPick', async () => {
      const state = timer.getState();
      const items: vscode.QuickPickItem[] = [];

      if (state === 'idle') {
        items.push({ label: '$(play) タイマー開始', description: '作業セッションを開始' });
      } else if (state === 'working' || state === 'breaking') {
        items.push({ label: '$(debug-pause) 一時停止', description: 'タイマーを一時停止' });
      } else if (state === 'paused') {
        items.push({ label: '$(play) 再開', description: 'タイマーを再開' });
      }

      if (state !== 'idle') {
        items.push({ label: '$(refresh) リセット', description: 'タイマーをリセット' });
      }

      if (state === 'breaking' || (state === 'paused' && timer.getTimerData().previousState === 'breaking')) {
        items.push({ label: '$(debug-step-over) 休憩をスキップ', description: '休憩をスキップして作業開始' });
      }

      items.push(
        { label: '$(graph) 統計を表示', description: '統計画面を開く' },
        { label: '$(gear) 設定', description: '設定画面を開く' },
      );

      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'BrainSync Focus Timer',
      });

      if (!selection) {return;}

      const label = selection.label;
      if (label.includes('タイマー開始') || label.includes('再開')) {
        vscode.commands.executeCommand('brainsync.startTimer');
      } else if (label.includes('一時停止')) {
        vscode.commands.executeCommand('brainsync.pauseTimer');
      } else if (label.includes('リセット')) {
        vscode.commands.executeCommand('brainsync.resetTimer');
      } else if (label.includes('休憩をスキップ')) {
        vscode.commands.executeCommand('brainsync.skipBreak');
      } else if (label.includes('統計を表示')) {
        vscode.commands.executeCommand('brainsync.viewStats');
      } else if (label.includes('設定')) {
        vscode.commands.executeCommand('brainsync.settings');
      }
    })
  );

  // ============================================================
  // 設定変更監視
  // ============================================================
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('brainsync')) {
        timer.reloadConfig();
        outputChannel.appendLine(`[${new Date().toISOString()}] Configuration changed`);
      }
    })
  );

  // ============================================================
  // Disposables
  // ============================================================
  context.subscriptions.push({
    dispose: () => {
      timer.dispose();
      statusBar.dispose();
      notificationManager.dispose();
      statsViewProvider.dispose();
      outputChannel.dispose();
    },
  });
}

// ============================================================
// セッション完了ハンドラ
// ============================================================

function handleWorkComplete(session: SessionRecord): void {
  recordSession(session);

  const stats = storage.getStatistics();
  const config = getTimerConfig();
  const isLongBreakDue = timer.getCurrentSetIndex() > config.longBreakInterval;

  // 通知
  notificationManager.notifyWorkComplete(
    session,
    timer.getCurrentSetIndex(),
    config.longBreakInterval,
    stats.today.fatigueScore,
  );

  // 脳疲労アラートチェック
  notificationManager.checkAndNotifyFatigueAlert(stats.today.fatigueScore);

  // 長い休憩サイクル後にcurrentSetIndexをリセット
  if (isLongBreakDue) {
    // タイマー内部で管理されるが、明示的に状態を更新
    const timerData = timer.getTimerData();
    timerData.currentSetIndex = 1;
    storage.saveTimerData(timerData);
  }

  // 自動休憩開始
  if (config.autoStartBreak) {
    // 通知のボタン選択を待たずに自動で休憩開始
    // ただし通知で既にbreakが開始されている可能性があるため、
    // idleの場合のみ開始
    setTimeout(() => {
      if (timer.getState() === 'idle') {
        timer.startBreak(isLongBreakDue);
      }
    }, 500);
  }
}

function handleBreakComplete(session: SessionRecord): void {
  recordSession(session);

  // 通知
  notificationManager.notifyBreakComplete();

  // 自動作業開始
  const config = getTimerConfig();
  if (config.autoStartWork) {
    setTimeout(() => {
      if (timer.getState() === 'idle') {
        timer.startWork();
      }
    }, 500);
  }
}

function recordSession(session: SessionRecord): void {
  try {
    let stats = storage.getStatistics();
    stats = updateTodayStats(stats, session);
    stats = updateWeeklyStats(stats);
    storage.saveStatistics(stats);

    // ステータスバーの脳疲労アラート表示
    const alertConfig = vscode.workspace.getConfiguration('brainsync');
    const threshold = alertConfig.get<number>('fatigueAlertThreshold', 21);
    statusBar.setFatigueAlert(stats.today.fatigueScore >= threshold);
  } catch (error) {
    outputChannel.appendLine(
      `[${new Date().toISOString()}] ERROR: Failed to record session - ${error}`
    );
  }
}

export function deactivate(): void {
  // Cleanup is handled by disposables
}
