import * as vscode from 'vscode';
import { TimerState } from '../config';
import { SlackClient, SlackResponse } from './slackClient';

export const SLACK_TOKEN_KEY = 'brainsync.slackToken';

/** 恒久エラー（トークン無効・権限不足）。検知したら連携を自動無効化する（§7）。 */
const PERMANENT_ERRORS = new Set([
  'invalid_auth',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'missing_scope',
]);

/**
 * 作業セッション中だけ Slack を集中モードにする（DND Snooze + 任意のステータス設定）。
 *
 * 制約と設計は docs/slack-integration-plan.md を参照。要点:
 *  - S4/レート制限: 状態遷移時のみ API を呼ぶ（単一実行 + 末尾コアレス）。
 *  - slackActive は「DND Snooze が有効か」だけを表す（§4-2a の権威ルール）。
 *  - S6: Snooze は num_minutes 後に自動解除、ステータスは status_expiration で自動クリア（安全網）。
 */
export class SlackManager {
  private slackActive = false;         // DND Snooze が有効か（中核の抑制状態のみ。§4-2a）
  private syncing = false;             // API 実行中フラグ（単一実行）
  private pending: { state: TimerState; remainingSec: number } | null = null;
  private notifiedAuthFailure = false; // 恒久エラー通知の重複防止（セッション中1回）

  constructor(
    private secrets: vscode.SecretStorage,
    private client: SlackClient,
    private outputChannel: vscode.OutputChannel,
  ) {}

  /**
   * onStateChange / 設定変更 から呼ぶ。最新の要求で上書きし、実行中なら末尾に coalesce。
   * ネットワーク遅延・遷移連打があっても最終的に最新状態へ収束する。
   */
  async syncForState(state: TimerState, remainingSec: number): Promise<void> {
    this.pending = { state, remainingSec };
    if (this.syncing) { return; }
    this.syncing = true;
    try {
      while (this.pending) {
        const req = this.pending;
        this.pending = null;
        await this.reconcile(req.state, req.remainingSec);
      }
    } finally {
      this.syncing = false;
    }
  }

  /** エスケープハッチ（disconnect / コマンド用）: slackActive を見ず無条件で解除を試みる（§7-7）。 */
  async forceClear(): Promise<void> {
    const token = await this.secrets.get(SLACK_TOKEN_KEY);
    await this.deactivate(token);
  }

  dispose(): void {
    // ベストエフォート解除。S6（Snooze の自動解除）が最終保険。
    void this.forceClear();
  }

  // ============================================================
  // Private
  // ============================================================

  private async reconcile(state: TimerState, remainingSec: number): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('brainsync');
    const enabled = cfg.get<boolean>('slackIntegration', false);
    const token = enabled ? await this.secrets.get(SLACK_TOKEN_KEY) : undefined;

    const shouldBeOn = !!token && state === 'working';
    if (shouldBeOn) {
      await this.activate(token as string, remainingSec, cfg);
    } else if (this.slackActive) {
      await this.deactivate(token);
    }
  }

  private async activate(
    token: string,
    remainingSec: number,
    cfg: vscode.WorkspaceConfiguration,
  ): Promise<void> {
    const minutes = Math.max(1, Math.ceil(remainingSec / 60));
    const r1 = await this.client.call('dnd.setSnooze', token, { num_minutes: minutes });
    // 恒久エラー時はここで打ち切り（profile.set を呼ばず二重無効化も防ぐ。§4-2 short-circuit）
    if (!(await this.check(r1))) { return; }
    this.slackActive = true;

    // ステータスは副次。成否は slackActive に影響させない（status_expiration が保険）。
    if (cfg.get<boolean>('slackSetStatus', true)) {
      const profile = JSON.stringify({
        status_text: cfg.get<string>('slackStatusText', '集中中'),
        status_emoji: cfg.get<string>('slackStatusEmoji', ':tomato:'),
        status_expiration: Math.floor(Date.now() / 1000) + remainingSec,
      });
      await this.check(await this.client.call('users.profile.set', token, { profile }));
    }
  }

  private async deactivate(token?: string): Promise<void> {
    if (!token) {
      this.slackActive = false;
      return;
    }
    // endSnooze は成否に関わらず「解除を試みた」とみなし slackActive=false に確定する。
    // 一時失敗で true のまま残すと解除が二度と走らなくなるため（未解除は S6 が保険）。
    await this.client.call('dnd.endSnooze', token);
    const profile = JSON.stringify({ status_text: '', status_emoji: '' });
    await this.client.call('users.profile.set', token, { profile });
    this.slackActive = false;
  }

  /**
   * ok を検査して true/false を返す。恒久エラーは無効化処理を await して発火。
   * 副作用（secrets.delete / config.update）が非同期のため async にしている。
   */
  private async check(res: SlackResponse): Promise<boolean> {
    if (res.ok) { return true; }
    if (res.error && PERMANENT_ERRORS.has(res.error)) {
      await this.handlePermanentError(res.error);
    } else {
      this.log(`Slack transient error: ${res.error ?? 'unknown'}`);
    }
    return false;
  }

  /**
   * 恒久エラー時の自動無効化（§7）。
   * 無効化（削除・設定OFF）は冪等なので毎回実行し、通知だけ1回に抑制する。
   */
  private async handlePermanentError(error: string): Promise<void> {
    this.slackActive = false;
    await this.secrets.delete(SLACK_TOKEN_KEY);
    await vscode.workspace
      .getConfiguration('brainsync')
      .update('slackIntegration', false, vscode.ConfigurationTarget.Global);
    this.log(`Slack integration auto-disabled due to permanent error: ${error}`);

    if (this.notifiedAuthFailure) { return; }
    this.notifiedAuthFailure = true;
    const reconnect = 'Slack連携を設定';
    const selection = await vscode.window.showWarningMessage(
      'Slack連携が無効です（トークンが無効か権限不足）。再設定してください。',
      reconnect,
    );
    if (selection === reconnect) {
      void vscode.commands.executeCommand('brainsync.connectSlack');
    }
  }

  /** connectSlack 成功時に呼ぶ。恒久エラー通知フラグをリセット。 */
  resetAuthFailureFlag(): void {
    this.notifiedAuthFailure = false;
  }

  private log(message: string): void {
    // トークンは出力しない
    this.outputChannel.appendLine(`[${new Date().toISOString()}] Slack: ${message}`);
  }
}
