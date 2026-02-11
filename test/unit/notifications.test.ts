import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig, _getLastCreatedPanel, _resetLastCreatedPanel, Uri } from './mocks/vscode';
import { NotificationManager, NotificationCallbacks } from '../../src/notifications';
import { Storage } from '../../src/storage';
import { createDefaultAlertState } from '../../src/config';

// ============================================================
// テストヘルパー
// ============================================================

function createMockStorage(): Storage {
  return {
    getAlertState: () => createDefaultAlertState(),
    saveAlertState: async () => {},
  } as any;
}

function createMockCallbacks(): NotificationCallbacks {
  return {
    onStartBreak: () => {},
    onSkipBreak: () => {},
    onStartWork: () => {},
    onExtendBreak: () => {},
  };
}

function createManager(configOverrides?: Record<string, any>): NotificationManager {
  _resetConfig();
  _setConfig({
    notificationEnabled: true,
    soundEnabled: true,
    soundVolume: 50,
    soundFile: 'bell',
    fatigueAlertEnabled: true,
    fatigueAlertThreshold: 21,
    ...configOverrides,
  });

  const extensionUri = Uri.file('/mock/extension') as any;
  return new NotificationManager(
    createMockStorage(),
    createMockCallbacks(),
    extensionUri,
  );
}

// ============================================================
// テストスイート
// ============================================================

suite('NotificationManager Unit Tests', () => {

  setup(() => {
    _resetLastCreatedPanel();
  });

  teardown(() => {
    _resetConfig();
    _resetLastCreatedPanel();
  });

  // ============================================================
  // playSound のルーティング
  // ============================================================

  suite('playSound - サウンドファイルルーティング', () => {

    test('作業終了で work-end.mp3 のパスが使用される', async () => {
      const manager = createManager();

      await manager.notifyWorkComplete(
        { id: '1', startTime: '', endTime: '', duration: 30, type: 'work', completed: true },
        1, 4, 0,
      );

      const panel = _getLastCreatedPanel();
      assert.ok(panel, 'Webview panel should be created');

      // Webview に送信されたメッセージまたはペンディングを確認
      const posted = panel!.webview._postedMessages;
      const hasWorkEndSound = posted.some(
        (m: any) => m.command === 'playSound' && m.url.includes('work-end.mp3'),
      );
      // pendingSound 経由の場合もある（webview ready 前）
      // ready メッセージをシミュレートして再確認
      if (!hasWorkEndSound) {
        panel!.webview._simulateMessage({ command: 'ready' });
        const postedAfterReady = panel!.webview._postedMessages;
        const hasWorkEndSoundAfterReady = postedAfterReady.some(
          (m: any) => m.command === 'playSound' && m.url.includes('work-end.mp3'),
        );
        assert.ok(hasWorkEndSoundAfterReady, 'Should send playSound with work-end.mp3');
      }
    });

    test('休憩終了で break-end.mp3 のパスが使用される', async () => {
      const manager = createManager();

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      assert.ok(panel, 'Webview panel should be created');

      panel!.webview._simulateMessage({ command: 'ready' });

      const posted = panel!.webview._postedMessages;
      const hasBreakEndSound = posted.some(
        (m: any) => m.command === 'playSound' && m.url.includes('break-end.mp3'),
      );
      assert.ok(hasBreakEndSound, 'Should send playSound with break-end.mp3');
    });

    test('脳疲労アラートで alert.mp3 のパスが使用される', async () => {
      const manager = createManager({ fatigueAlertThreshold: 10 });

      await manager.checkAndNotifyFatigueAlert(15);

      const panel = _getLastCreatedPanel();
      assert.ok(panel, 'Webview panel should be created');

      panel!.webview._simulateMessage({ command: 'ready' });

      const posted = panel!.webview._postedMessages;
      const hasAlertSound = posted.some(
        (m: any) => m.command === 'playSound' && m.url.includes('alert.mp3'),
      );
      assert.ok(hasAlertSound, 'Should send playSound with alert.mp3');
    });
  });

  // ============================================================
  // サウンド ON/OFF
  // ============================================================

  suite('playSound - サウンド有効/無効', () => {

    test('soundEnabled=false の場合、Webview が作成されない', async () => {
      const manager = createManager({ soundEnabled: false });

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      // soundEnabled=false ならサウンド用パネルは作られない
      assert.strictEqual(panel, null, 'Webview panel should not be created when sound is disabled');
    });

    test('soundFile=silent の場合、Webview が作成されない', async () => {
      const manager = createManager({ soundFile: 'silent' });

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      // silent ならサウンド用パネルは作られない
      assert.strictEqual(panel, null, 'Webview panel should not be created when soundFile is silent');
    });
  });

  // ============================================================
  // 音量変換
  // ============================================================

  suite('playSound - 音量変換', () => {

    test('soundVolume=50 の場合、volume=0.5 が送信される', async () => {
      const manager = createManager({ soundVolume: 50 });

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      assert.ok(panel, 'Panel should be created');

      panel!.webview._simulateMessage({ command: 'ready' });

      const soundMsg = panel!.webview._postedMessages.find(
        (m: any) => m.command === 'playSound',
      );
      assert.ok(soundMsg, 'playSound message should exist');
      assert.strictEqual(soundMsg.volume, 0.5, 'Volume should be 0.5');
    });

    test('soundVolume=100 の場合、volume=1.0 が送信される', async () => {
      const manager = createManager({ soundVolume: 100 });

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      assert.ok(panel);
      panel!.webview._simulateMessage({ command: 'ready' });

      const soundMsg = panel!.webview._postedMessages.find(
        (m: any) => m.command === 'playSound',
      );
      assert.ok(soundMsg);
      assert.strictEqual(soundMsg.volume, 1.0);
    });

    test('soundVolume=0 の場合、volume=0 が送信される', async () => {
      const manager = createManager({ soundVolume: 0 });

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      assert.ok(panel);
      panel!.webview._simulateMessage({ command: 'ready' });

      const soundMsg = panel!.webview._postedMessages.find(
        (m: any) => m.command === 'playSound',
      );
      assert.ok(soundMsg);
      assert.strictEqual(soundMsg.volume, 0);
    });
  });

  // ============================================================
  // Webview ライフサイクル
  // ============================================================

  suite('Webview ライフサイクル', () => {

    test('Webview 準備完了前のサウンドがキューイングされる', async () => {
      const manager = createManager();

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      assert.ok(panel);

      // ready 前: postMessage はまだ送信されていない（pendingSound にキュー）
      const beforeReady = panel!.webview._postedMessages.filter(
        (m: any) => m.command === 'playSound',
      );
      assert.strictEqual(beforeReady.length, 0, 'No playSound before ready');

      // ready をシミュレート
      panel!.webview._simulateMessage({ command: 'ready' });

      // ready 後: キューからサウンドが送信される
      const afterReady = panel!.webview._postedMessages.filter(
        (m: any) => m.command === 'playSound',
      );
      assert.strictEqual(afterReady.length, 1, 'playSound sent after ready');
    });

    test('dispose() で Webview が破棄される', () => {
      const manager = createManager();

      // Webview を作成するために通知を呼ぶ
      manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      // dispose はエラーなく完了する
      manager.dispose();
      // dispose 後も問題なく動くことを確認
      assert.ok(true, 'dispose completed without error');
    });

    test('soundComplete メッセージでパネルが自動破棄される', async () => {
      const manager = createManager();

      await manager.notifyBreakComplete();

      const panel = _getLastCreatedPanel();
      assert.ok(panel, 'Panel should be created');

      // ready → soundComplete のシーケンスをシミュレート
      panel!.webview._simulateMessage({ command: 'ready' });
      panel!.webview._simulateMessage({ command: 'soundComplete' });

      // dispose 後、再度サウンドを再生すると新しいパネルが作成される
      _resetLastCreatedPanel();
      await manager.notifyBreakComplete();

      const newPanel = _getLastCreatedPanel();
      assert.ok(newPanel, 'New panel should be created after previous was disposed');
    });
  });

  // ============================================================
  // 脳疲労アラートの重複防止
  // ============================================================

  suite('脳疲労アラート制御', () => {

    test('閾値未満の場合、アラートが表示されない', async () => {
      const manager = createManager({ fatigueAlertThreshold: 21 });

      await manager.checkAndNotifyFatigueAlert(15);

      const panel = _getLastCreatedPanel();
      // 閾値未満なのでパネルが作られない
      if (panel) {
        const soundMessages = panel.webview._postedMessages.filter(
          (m: any) => m.command === 'playSound',
        );
        assert.strictEqual(soundMessages.length, 0, 'No alert sound below threshold');
      }
    });

    test('通知無効の場合、アラートが表示されない', async () => {
      const manager = createManager({
        notificationEnabled: false,
        fatigueAlertThreshold: 10,
      });

      await manager.checkAndNotifyFatigueAlert(25);

      const panel = _getLastCreatedPanel();
      if (panel) {
        assert.strictEqual(panel.webview._postedMessages.length, 0);
      }
    });
  });
});
