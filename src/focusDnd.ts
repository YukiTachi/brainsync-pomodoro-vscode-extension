import * as vscode from 'vscode';
import { TimerState } from './config';

/**
 * VS Code の Do Not Disturb（DND）モードを、作業セッション中だけ自動で ON にする。
 *
 * 制約（実装の前提）:
 *  - C1: トグル専用コマンド `notifications.toggleDoNotDisturbMode` しかない（ON/OFF 個別指定不可）。
 *  - C2: 現在の DND 状態を取得する公開 API も settings.json キーも存在しない（実行時状態）。
 *        → 「自分が今 ON にしているか」を内部フラグ dndActive で管理し、冪等にトグルを発行する。
 *  - C3: DND 中は info / warning のトーストが抑制される（error / modal は表示される）。
 *        → 作業完了通知（info）を出す前に ensureOff() で必ず解除する。
 *  - A1: DND の実行時状態はウィンドウのリロードで OFF にリセットされる想定。
 *        → 起動時は dndActive=false（OFF）で開始する。
 */
export class FocusDndManager {
  /** 「自分が今 DND を ON にしているか」の内部仮定（C1/C2 対策） */
  private dndActive = false;

  constructor(private outputChannel: vscode.OutputChannel) {}

  /**
   * タイマーの状態遷移ごとに呼ぶ。working なら ON、それ以外は OFF に揃える。
   * 設定 brainsync.focusDoNotDisturb が無効なときは何もしない。
   */
  async syncForState(state: TimerState): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('brainsync')
      .get<boolean>('focusDoNotDisturb', false);

    const shouldBeOn = enabled && state === 'working';
    if (shouldBeOn && !this.dndActive) {
      await this.toggle(true);
    } else if (!shouldBeOn && this.dndActive) {
      await this.toggle(false);
    }
  }

  /**
   * 明示的に OFF にする（作業完了通知を出す直前に await して呼ぶ。C3 対策）。
   * dndActive===false のときは no-op。通常運用ではこれで正しいが、
   * 内部仮定がズレた復旧用途には forceDisable() を使う。
   */
  async ensureOff(): Promise<void> {
    if (this.dndActive) {
      await this.toggle(false);
    }
  }

  /**
   * エスケープハッチ（コマンド brainsync.disableDnd 用）。
   * ensureOff のガード（dndActive===true）を通さず、無条件でトグルを 1 回発行する。
   * クラッシュ後など「実際は DND ON だが内部は dndActive=false 仮定」のズレから
   * 復旧するのが目的なので、ガード付き ensureOff では肝心の場面で no-op になり用を成さない。
   */
  async forceDisable(): Promise<void> {
    await this.toggle(false);
  }

  /**
   * 内部仮定を反映してトグルコマンドを発行する。
   * ★dndActive は await の「前」に楽観的更新する（再入競合対策）。
   *   async 化により toggle() 実行中に他の syncForState() が再入し得るため、
   *   フラグを先に確定して再入側の同期判定が古い値を読むのを防ぐ（二重トグル回避）。
   */
  private async toggle(target: boolean): Promise<void> {
    this.dndActive = target;
    try {
      await vscode.commands.executeCommand('notifications.toggleDoNotDisturbMode');
    } catch (e) {
      // 実トグルが起きていないため、楽観的更新をロールバックする。
      this.dndActive = !target;
      this.log(`DND toggle failed, rolled back: ${e}`);
      return;
    }
    this.log(`DND -> ${target ? 'ON' : 'OFF'}`);
  }

  /**
   * ベストエフォートで OFF に戻す。executeCommand は非同期で、終了シーケンスでは
   * 完了を await できない＝解除は「保証なし」。前提 A1（リロードで OFF にリセット）で救済する。
   */
  dispose(): void {
    void this.ensureOff();
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] FocusDnd: ${message}`);
  }
}
