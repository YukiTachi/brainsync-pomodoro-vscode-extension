import * as vscode from 'vscode';
import { TimerState } from './config';
import { formatTime } from './utils';

/**
 * ステータスバーアイテムの管理
 */
export class StatusBar {
  private item: vscode.StatusBarItem;
  private currentState: TimerState = 'idle';

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'brainsync.showQuickPick';
    this.setIdle();
    this.item.show();
  }

  /**
   * タイマーの残り時間で表示を更新
   */
  update(remainingTime: number, state: TimerState): void {
    this.currentState = state;

    switch (state) {
      case 'idle':
        this.setIdle();
        break;
      case 'working':
        this.setWorking(remainingTime);
        break;
      case 'breaking':
        this.setBreaking(remainingTime);
        break;
      case 'paused':
        this.setPaused(remainingTime);
        break;
    }
  }

  /**
   * 脳疲労アラート表示
   */
  setFatigueAlert(show: boolean): void {
    if (show) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  getState(): TimerState {
    return this.currentState;
  }

  dispose(): void {
    this.item.dispose();
  }

  // ============================================================
  // Private
  // ============================================================

  private setIdle(): void {
    this.item.text = '🧠 Ready';
    this.item.tooltip = 'BrainSync Focus Timer - クリックでメニューを開く';
    this.item.backgroundColor = undefined;
    this.item.accessibilityInformation = {
      label: 'BrainSync タイマー待機中',
      role: 'button',
    };
  }

  private setWorking(remainingTime: number): void {
    this.item.text = `🧠 ${formatTime(remainingTime)}`;
    this.item.tooltip = `作業中 - 残り ${formatTime(remainingTime)}`;
    this.item.accessibilityInformation = {
      label: `BrainSync タイマー作業中、残り${Math.ceil(remainingTime / 60)}分`,
      role: 'button',
    };
  }

  private setBreaking(remainingTime: number): void {
    this.item.text = `🧠 ${formatTime(remainingTime)}`;
    this.item.tooltip = `休憩中 - 残り ${formatTime(remainingTime)}`;
    this.item.accessibilityInformation = {
      label: `BrainSync 休憩中、残り${Math.ceil(remainingTime / 60)}分`,
      role: 'button',
    };
  }

  private setPaused(remainingTime: number): void {
    this.item.text = `🧠 ${formatTime(remainingTime)} ⏸`;
    this.item.tooltip = '一時停止中 - クリックでメニューを開く';
    this.item.backgroundColor = undefined;
    this.item.accessibilityInformation = {
      label: `BrainSync 一時停止中、残り${Math.ceil(remainingTime / 60)}分`,
      role: 'button',
    };
  }
}
