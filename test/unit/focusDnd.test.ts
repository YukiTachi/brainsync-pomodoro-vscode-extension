import './setup';

import * as assert from 'assert';
import {
  _setConfig,
  _resetConfig,
  _resetCommands,
  _setExecuteCommandImpl,
  _executeCommandCalls,
} from './mocks/vscode';
import { FocusDndManager } from '../../src/focusDnd';

const DND_COMMAND = 'notifications.toggleDoNotDisturbMode';

// ============================================================
// ヘルパー
// ============================================================

function createManager(focusDoNotDisturb: boolean): FocusDndManager {
  _resetConfig();
  _resetCommands();
  _setConfig({ focusDoNotDisturb });
  const outputChannel = { appendLine: () => {}, dispose: () => {} } as any;
  return new FocusDndManager(outputChannel);
}

/** DND トグルコマンドの発行回数 */
function toggleCount(): number {
  return _executeCommandCalls.filter((c) => c.command === DND_COMMAND).length;
}

// ============================================================
// テストスイート
// ============================================================

suite('FocusDndManager Unit Tests', () => {

  teardown(() => {
    _resetConfig();
    _resetCommands();
  });

  // ----------------------------------------------------------
  // 設定 OFF
  // ----------------------------------------------------------
  suite('focusDoNotDisturb=false（無効）', () => {
    test('どの状態遷移でもトグルが呼ばれない', async () => {
      const mgr = createManager(false);
      await mgr.syncForState('working');
      await mgr.syncForState('breaking');
      await mgr.syncForState('idle');
      assert.strictEqual(toggleCount(), 0);
    });
  });

  // ----------------------------------------------------------
  // 設定 ON: 状態遷移ごとのトグル
  // ----------------------------------------------------------
  suite('focusDoNotDisturb=true（有効）', () => {
    test('idle→working で 1 回トグル（ON）', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working');
      assert.strictEqual(toggleCount(), 1);
    });

    test('working 連続では追加トグルなし（冪等）', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working');
      await mgr.syncForState('working');
      await mgr.syncForState('working');
      assert.strictEqual(toggleCount(), 1);
    });

    test('working→breaking で OFF 方向に 1 回', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working');
      await mgr.syncForState('breaking');
      assert.strictEqual(toggleCount(), 2);
    });

    test('working→paused で OFF 方向に 1 回', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working');
      await mgr.syncForState('paused');
      assert.strictEqual(toggleCount(), 2);
    });

    test('paused→working（resume）で再 ON', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working'); // ON (1)
      await mgr.syncForState('paused');  // OFF (2)
      await mgr.syncForState('working'); // ON (3)
      assert.strictEqual(toggleCount(), 3);
    });

    test('idle→working→breaking→idle の最終状態は OFF（往復で偶数回）', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working');  // ON
      await mgr.syncForState('breaking'); // OFF
      await mgr.syncForState('idle');     // 既に OFF → no-op
      assert.strictEqual(toggleCount(), 2);
    });
  });

  // ----------------------------------------------------------
  // ensureOff
  // ----------------------------------------------------------
  suite('ensureOff', () => {
    test('dndActive=true のとき 1 回トグル', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working'); // ON (1)
      await mgr.ensureOff();             // OFF (2)
      assert.strictEqual(toggleCount(), 2);
    });

    test('dndActive=false のとき no-op', async () => {
      const mgr = createManager(true);
      await mgr.ensureOff();
      assert.strictEqual(toggleCount(), 0);
    });
  });

  // ----------------------------------------------------------
  // ★再入の二重トグル防止
  // ----------------------------------------------------------
  suite('async 再入', () => {
    test('ensureOff の解決前に syncForState(idle) を割り込ませてもトグルは合計1回', async () => {
      const mgr = createManager(true);
      await mgr.syncForState('working'); // ON (toggle 1, 即時)

      // executeCommand の解決を手動制御できる deferred に差し替え
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      _setExecuteCommandImpl(async () => { await gate; });

      const before = toggleCount();
      const p = mgr.ensureOff();            // toggle(false): dndActive を即 false に確定し await で中断
      await mgr.syncForState('idle');       // 再入: dndActive===false を見て no-op であるべき
      release();                            // ensureOff の executeCommand を解決
      await p;

      // この区間で発行されたトグルは ensureOff の 1 回のみ
      assert.strictEqual(toggleCount() - before, 1);
    });
  });

  // ----------------------------------------------------------
  // forceDisable（エスケープハッチ）
  // ----------------------------------------------------------
  suite('forceDisable', () => {
    test('dndActive=false（復旧シナリオ）でもガードに弾かれずトグルが1回発行される', async () => {
      const mgr = createManager(true);
      // 内部は dndActive=false のまま（クラッシュ後に実際は DND ON という想定）
      await mgr.forceDisable();
      assert.strictEqual(toggleCount(), 1);
    });
  });

  // ----------------------------------------------------------
  // 失敗時ロールバック
  // ----------------------------------------------------------
  suite('executeCommand 失敗時ロールバック', () => {
    test('reject すると dndActive が更新前に戻り、次の同期で再度トグルを試みる', async () => {
      const mgr = createManager(true);
      _setExecuteCommandImpl(async () => { throw new Error('boom'); });

      await mgr.syncForState('working'); // toggle 試行 → reject → dndActive を false にロールバック
      await mgr.syncForState('working'); // ロールバック済みなので再度 ON を試みる

      // 両方ともトグルを発行している（＝ロールバックで dndActive が false に戻った証拠）
      assert.strictEqual(toggleCount(), 2);
    });
  });
});
