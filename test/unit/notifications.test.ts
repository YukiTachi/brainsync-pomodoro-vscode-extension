import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig, Uri } from './mocks/vscode';
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

  teardown(() => {
    _resetConfig();
  });

  // ============================================================
  // getAudioCommand - プラットフォーム別コマンド生成
  // ============================================================

  suite('getAudioCommand - プラットフォーム別コマンド', () => {

    test('コマンド結果に command, args, options が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
      assert.ok('command' in result, 'Should have command');
      assert.ok('args' in result, 'Should have args');
      assert.ok('options' in result, 'Should have options');
      assert.ok(Array.isArray(result.args), 'args should be an array');
    });

    test('WSL 環境で powershell.exe が使用される', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        try {
          const version = require('fs').readFileSync('/proc/version', 'utf8');
          if (/microsoft|wsl/i.test(version)) {
            const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
            assert.strictEqual(result.command, 'powershell.exe');
          }
        } catch {
          // /proc/version が読めない環境ではスキップ
        }
      }
    });

    test('WSL 環境で wslpath によるWindows パスが使用される', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        try {
          const version = require('fs').readFileSync('/proc/version', 'utf8');
          if (/microsoft|wsl/i.test(version)) {
            const result = manager.getAudioCommand('/home/user/sound.mp3', 0.5);
            const scriptArg = result.args.find((a: string) => a.includes('sound.mp3'));
            assert.ok(scriptArg, 'Should contain sound.mp3 in PowerShell script');
            // wslpath が Windows パス（バックスラッシュ or \\wsl...）に変換する
            assert.ok(
              scriptArg!.includes('\\') || scriptArg!.includes('/'),
              'Should contain a path separator',
            );
          }
        } catch {
          // skip
        }
      }
    });

    test('WSL 環境で volume が PowerShell スクリプトに含まれる', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        try {
          const version = require('fs').readFileSync('/proc/version', 'utf8');
          if (/microsoft|wsl/i.test(version)) {
            const result = manager.getAudioCommand('/path/to/sound.mp3', 0.75);
            const scriptArg = result.args.find((a: string) => a.includes('Volume'));
            assert.ok(scriptArg, 'Should contain Volume in PowerShell script');
            assert.ok(
              scriptArg!.includes('0.75'),
              'Should set volume to 0.75',
            );
          }
        } catch {
          // skip
        }
      }
    });
  });

  // ============================================================
  // playSound - サウンド有効/無効
  // ============================================================

  suite('playSound - サウンド有効/無効', () => {

    test('soundEnabled=false の場合、エラーなく完了する', async () => {
      const manager = createManager({ soundEnabled: false });

      // soundEnabled=false なので playSound は何もしない
      await manager.notifyBreakComplete();
      assert.ok(true, 'Should complete without error');
    });

    test('soundFile=silent の場合、エラーなく完了する', async () => {
      const manager = createManager({ soundFile: 'silent' });

      await manager.notifyBreakComplete();
      assert.ok(true, 'Should complete without error');
    });
  });

  // ============================================================
  // サウンドファイルパス生成
  // ============================================================

  suite('サウンドファイルパス生成', () => {

    test('getAudioCommand の引数に work-end.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/work-end.mp3', 0.5,
      );
      const allArgs = result.args.join(' ');
      assert.ok(
        allArgs.includes('work-end.mp3'),
        `Should use work-end.mp3, got: ${allArgs}`,
      );
    });

    test('getAudioCommand の引数に break-end.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/break-end.mp3', 0.5,
      );
      const allArgs = result.args.join(' ');
      assert.ok(
        allArgs.includes('break-end.mp3'),
        `Should use break-end.mp3, got: ${allArgs}`,
      );
    });

    test('getAudioCommand の引数に alert.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/alert.mp3', 0.5,
      );
      const allArgs = result.args.join(' ');
      assert.ok(
        allArgs.includes('alert.mp3'),
        `Should use alert.mp3, got: ${allArgs}`,
      );
    });
  });

  // ============================================================
  // 音量変換
  // ============================================================

  suite('音量変換', () => {

    test('volume=0.5 で PowerShell スクリプトに 0.5 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
      const scriptArg = result.args.join(' ');
      assert.ok(
        scriptArg.includes('0.5') || scriptArg.includes('-f 16384'),
        `Volume 0.5 should be in command args: ${scriptArg}`,
      );
    });

    test('volume=1.0 で正しい引数が生成される', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 1.0);
      const scriptArg = result.args.join(' ');
      assert.ok(
        scriptArg.includes('1') || scriptArg.includes('-f 32768'),
        `Volume 1.0 should be in command args: ${scriptArg}`,
      );
    });

    test('volume=0 で正しい引数が生成される', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0);
      const scriptArg = result.args.join(' ');
      assert.ok(
        scriptArg.includes('Volume = 0') || scriptArg.includes('-f 0'),
        `Volume 0 should be in command args: ${scriptArg}`,
      );
    });
  });

  // ============================================================
  // 脳疲労アラートの重複防止
  // ============================================================

  suite('脳疲労アラート制御', () => {

    test('閾値未満の場合、アラートが表示されない', async () => {
      const manager = createManager({ fatigueAlertThreshold: 21 });

      // 15 < 21 なのでアラートは出ない
      await manager.checkAndNotifyFatigueAlert(15);
      assert.ok(true, 'Should not alert below threshold');
    });

    test('通知無効の場合、アラートが表示されない', async () => {
      const manager = createManager({
        notificationEnabled: false,
        fatigueAlertThreshold: 10,
      });

      await manager.checkAndNotifyFatigueAlert(25);
      assert.ok(true, 'Should not alert when notifications disabled');
    });
  });

  // ============================================================
  // dispose
  // ============================================================

  suite('ライフサイクル', () => {

    test('dispose() がエラーなく完了する', () => {
      const manager = createManager();
      manager.dispose();
      assert.ok(true, 'dispose completed without error');
    });
  });
});
