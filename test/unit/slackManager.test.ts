import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig, _resetCommands } from './mocks/vscode';
import { SlackManager, SLACK_TOKEN_KEY } from '../../src/slack/slackManager';
import { SlackClient, SlackResponse } from '../../src/slack/slackClient';

// ============================================================
// テストダブル
// ============================================================

/** インメモリの SecretStorage */
class MemorySecretStorage {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.map.get(key); }
  async store(key: string, value: string): Promise<void> { this.map.set(key, value); }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  onDidChange = () => ({ dispose() {} });
}

/** 呼び出しを記録し、method ごとに応答を差し込めるスパイ SlackClient */
class SpySlackClient implements SlackClient {
  calls: { method: string; params: Record<string, string | number> }[] = [];
  private responses = new Map<string, SlackResponse>();
  private defaultOk: SlackResponse = { ok: true };
  private gate: Promise<void> | null = null;

  setResponse(method: string, res: SlackResponse): void { this.responses.set(method, res); }
  /** 全 call を解決前にブロックさせる（再入テスト用）。release で解放。 */
  block(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((r) => { release = r; });
    return release;
  }

  async call(method: string, _token: string, params: Record<string, string | number> = {}): Promise<SlackResponse> {
    this.calls.push({ method, params });
    if (this.gate) { await this.gate; }
    return this.responses.get(method) ?? this.defaultOk;
  }

  countOf(method: string): number { return this.calls.filter((c) => c.method === method).length; }
}

const outputChannel = { appendLine: () => {}, dispose: () => {} } as any;

function setup(cfg: Record<string, any>, withToken = true) {
  _resetConfig();
  _resetCommands();
  _setConfig({ slackIntegration: true, slackSetStatus: true, slackStatusText: '集中中', slackStatusEmoji: ':tomato:', ...cfg });
  const secrets = new MemorySecretStorage();
  if (withToken) { void secrets.store(SLACK_TOKEN_KEY, 'xoxp-test'); }
  const client = new SpySlackClient();
  const mgr = new SlackManager(secrets as any, client, outputChannel);
  return { mgr, client, secrets };
}

// ============================================================
// テストスイート
// ============================================================

suite('SlackManager Unit Tests', () => {
  teardown(() => { _resetConfig(); _resetCommands(); });

  suite('無効時', () => {
    test('slackIntegration=false ではどの遷移でも API を呼ばない', async () => {
      const { mgr, client } = setup({ slackIntegration: false });
      await mgr.syncForState('working', 1800);
      await mgr.syncForState('breaking', 300);
      assert.strictEqual(client.calls.length, 0);
    });

    test('トークン未設定では API を呼ばない', async () => {
      const { mgr, client } = setup({}, false);
      await mgr.syncForState('working', 1800);
      assert.strictEqual(client.calls.length, 0);
    });
  });

  suite('状態遷移', () => {
    test('idle→working で setSnooze(num_minutes) + profile.set', async () => {
      const { mgr, client } = setup({});
      await mgr.syncForState('working', 1800);
      assert.strictEqual(client.countOf('dnd.setSnooze'), 1);
      assert.strictEqual(client.calls[0].params.num_minutes, 30);
      assert.strictEqual(client.countOf('users.profile.set'), 1);
    });

    test('working→breaking で endSnooze + status クリア', async () => {
      const { mgr, client } = setup({});
      await mgr.syncForState('working', 1800);
      await mgr.syncForState('breaking', 300);
      assert.strictEqual(client.countOf('dnd.endSnooze'), 1);
      // profile.set は activate(1) + deactivate(1) = 2
      assert.strictEqual(client.countOf('users.profile.set'), 2);
    });

    test('working 中の再同期（設定変更経路）は status を再適用する', async () => {
      // onStateChange は working を1回しか発火しないが、Slack設定変更時は
      // 現在状態=working で再度呼ばれ、新しい status_text 等を再適用するのが正しい挙動。
      const { mgr, client } = setup({});
      await mgr.syncForState('working', 1800);
      await mgr.syncForState('working', 1700);
      assert.strictEqual(client.countOf('dnd.setSnooze'), 2);
      assert.strictEqual(client.countOf('users.profile.set'), 2);
    });

    test('paused→working（resume）で残り時間で再 Snooze', async () => {
      const { mgr, client } = setup({});
      await mgr.syncForState('working', 1800); // snooze 30
      await mgr.syncForState('paused', 900);   // endSnooze
      await mgr.syncForState('working', 900);  // snooze 15
      assert.strictEqual(client.countOf('dnd.setSnooze'), 2);
      const snoozes = client.calls.filter((c) => c.method === 'dnd.setSnooze');
      assert.strictEqual(snoozes[1].params.num_minutes, 15);
    });

    test('slackSetStatus=false では profile.set を呼ばない', async () => {
      const { mgr, client } = setup({ slackSetStatus: false });
      await mgr.syncForState('working', 1800);
      assert.strictEqual(client.countOf('dnd.setSnooze'), 1);
      assert.strictEqual(client.countOf('users.profile.set'), 0);
    });

    test('num_minutes は残り60秒未満でも 1 以上', async () => {
      const { mgr, client } = setup({});
      await mgr.syncForState('working', 30);
      assert.strictEqual(client.calls[0].params.num_minutes, 1);
    });
  });

  suite('部分成功と short-circuit', () => {
    test('setSnooze成功・profile.set失敗でも slackActive=true（breakingで解除される）', async () => {
      const { mgr, client } = setup({});
      client.setResponse('users.profile.set', { ok: false, error: 'profile_set_failed' });
      await mgr.syncForState('working', 1800);
      await mgr.syncForState('breaking', 300);
      // slackActive=true だったので endSnooze が走る
      assert.strictEqual(client.countOf('dnd.endSnooze'), 1);
    });

    test('setSnooze が恒久エラーなら profile.set を呼ばない（short-circuit）', async () => {
      const { mgr, client } = setup({});
      client.setResponse('dnd.setSnooze', { ok: false, error: 'invalid_auth' });
      await mgr.syncForState('working', 1800);
      assert.strictEqual(client.countOf('users.profile.set'), 0);
    });
  });

  suite('恒久エラーの自動無効化', () => {
    test('invalid_auth でトークン削除 + slackIntegration=false', async () => {
      const { mgr, client, secrets } = setup({});
      client.setResponse('dnd.setSnooze', { ok: false, error: 'invalid_auth' });
      await mgr.syncForState('working', 1800);
      assert.strictEqual(await secrets.get(SLACK_TOKEN_KEY), undefined, 'トークンが削除される');
      // 無効化後は次の working でも呼ばない（token 無し）
      const before = client.calls.length;
      await mgr.syncForState('working', 1800);
      assert.strictEqual(client.calls.length, before, '無効化後は API を呼ばない');
    });

    test('token_expired も恒久エラーとして無効化される', async () => {
      const { mgr, client, secrets } = setup({});
      client.setResponse('dnd.setSnooze', { ok: false, error: 'token_expired' });
      await mgr.syncForState('working', 1800);
      assert.strictEqual(await secrets.get(SLACK_TOKEN_KEY), undefined);
    });

    test('network_error（一時エラー）では無効化しない', async () => {
      const { mgr, client, secrets } = setup({});
      client.setResponse('dnd.setSnooze', { ok: false, error: 'network_error' });
      await mgr.syncForState('working', 1800);
      assert.notStrictEqual(await secrets.get(SLACK_TOKEN_KEY), undefined, 'トークンは残る');
    });
  });

  suite('deactivate のフラグ確定', () => {
    test('endSnooze がネットワーク失敗でも slackActive=false（解除ループにならない）', async () => {
      const { mgr, client } = setup({});
      await mgr.syncForState('working', 1800);
      client.setResponse('dnd.endSnooze', { ok: false, error: 'network_error' });
      await mgr.syncForState('breaking', 300); // endSnooze 失敗
      const endCount = client.countOf('dnd.endSnooze');
      await mgr.syncForState('idle', 0);       // slackActive=false なので再 endSnooze しない
      assert.strictEqual(client.countOf('dnd.endSnooze'), endCount);
    });
  });

  suite('forceClear（無条件）', () => {
    test('slackActive=false でも token があれば endSnooze + status クリア', async () => {
      const { mgr, client } = setup({});
      await mgr.forceClear(); // 一度も working になっていない = slackActive false
      assert.strictEqual(client.countOf('dnd.endSnooze'), 1);
      assert.strictEqual(client.countOf('users.profile.set'), 1);
    });
  });

  suite('async 再入（単一実行 + コアレス）', () => {
    test('working中の解決前に breaking を割り込ませても最終状態に収束', async () => {
      const { mgr, client } = setup({});
      const release = client.block();
      const p1 = mgr.syncForState('working', 1800); // block で待機
      const p2 = mgr.syncForState('breaking', 300); // pending に coalesce
      release();
      await Promise.all([p1, p2]);
      // working の activate 後、pending の breaking で deactivate される
      assert.strictEqual(client.countOf('dnd.setSnooze'), 1);
      assert.strictEqual(client.countOf('dnd.endSnooze'), 1);
    });
  });
});
