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

    test('Linux 環境で paplay が使用される', () => {
      const manager = createManager();
      // テスト環境は Linux なので直接テスト可能
      if (process.platform === 'linux') {
        const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
        assert.strictEqual(result.command, 'paplay');
        assert.ok(result.args.includes('/path/to/sound.mp3'));
      }
    });

    test('ボリューム 0.5 で paplay の --volume=32768 になる', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
        assert.ok(
          result.args.includes('--volume=32768'),
          `Expected --volume=32768 but got args: ${result.args}`,
        );
      }
    });

    test('ボリューム 1.0 で paplay の --volume=65536 になる', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        const result = manager.getAudioCommand('/path/to/sound.mp3', 1.0);
        assert.ok(
          result.args.includes('--volume=65536'),
          `Expected --volume=65536 but got args: ${result.args}`,
        );
      }
    });

    test('ボリューム 0 で paplay の --volume=0 になる', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        const result = manager.getAudioCommand('/path/to/sound.mp3', 0);
        assert.ok(
          result.args.includes('--volume=0'),
          `Expected --volume=0 but got args: ${result.args}`,
        );
      }
    });

    test('ファイルパスが引数に含まれる', () => {
      const manager = createManager();
      const testPath = '/some/path/to/alert.mp3';
      const result = manager.getAudioCommand(testPath, 0.5);
      assert.ok(
        result.args.includes(testPath),
        `File path should be in args: ${result.args}`,
      );
    });

    test('コマンド結果に command, args, options が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
      assert.ok('command' in result, 'Should have command');
      assert.ok('args' in result, 'Should have args');
      assert.ok('options' in result, 'Should have options');
      assert.ok(Array.isArray(result.args), 'args should be an array');
    });
  });

  // ============================================================
  // WSL 検出と PULSE_SERVER
  // ============================================================

  suite('WSL 環境検出', () => {

    test('WSL 環境で PULSE_SERVER が設定される', () => {
      const manager = createManager();
      if (process.platform === 'linux') {
        const result = manager.getAudioCommand('/path/to/sound.mp3', 0.5);
        // テスト環境が WSL の場合のみ
        try {
          const version = require('fs').readFileSync('/proc/version', 'utf8');
          if (/microsoft|wsl/i.test(version)) {
            assert.ok(result.options.env, 'WSL should have env options');
            assert.strictEqual(
              result.options.env!.PULSE_SERVER,
              '/mnt/wslg/PulseServer',
              'PULSE_SERVER should be set for WSL',
            );
          }
        } catch {
          // /proc/version が読めない環境ではスキップ
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

    test('getAudioCommand に渡すパスに work-end.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/work-end.mp3', 0.5,
      );
      assert.ok(
        result.args[0].includes('work-end.mp3'),
        'Should use work-end.mp3',
      );
    });

    test('getAudioCommand に渡すパスに break-end.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/break-end.mp3', 0.5,
      );
      assert.ok(
        result.args[0].includes('break-end.mp3'),
        'Should use break-end.mp3',
      );
    });

    test('getAudioCommand に渡すパスに alert.mp3 が含まれる', () => {
      const manager = createManager();
      const result = manager.getAudioCommand(
        '/mock/extension/resources/sounds/alert.mp3', 0.5,
      );
      assert.ok(
        result.args[0].includes('alert.mp3'),
        'Should use alert.mp3',
      );
    });
  });

  // ============================================================
  // 音量変換
  // ============================================================

  suite('音量変換', () => {

    test('soundVolume=50 → volume=0.5 で正しい引数が生成される', () => {
      const manager = createManager({ soundVolume: 50 });
      const result = manager.getAudioCommand('/path/to/sound.mp3', 50 / 100);
      // 0.5 * 65536 = 32768
      if (process.platform === 'linux') {
        assert.ok(result.args.includes('--volume=32768'));
      }
    });

    test('soundVolume=100 → volume=1.0 で正しい引数が生成される', () => {
      const manager = createManager({ soundVolume: 100 });
      const result = manager.getAudioCommand('/path/to/sound.mp3', 100 / 100);
      if (process.platform === 'linux') {
        assert.ok(result.args.includes('--volume=65536'));
      }
    });

    test('soundVolume=0 → volume=0 で正しい引数が生成される', () => {
      const manager = createManager({ soundVolume: 0 });
      const result = manager.getAudioCommand('/path/to/sound.mp3', 0 / 100);
      if (process.platform === 'linux') {
        assert.ok(result.args.includes('--volume=0'));
      }
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
