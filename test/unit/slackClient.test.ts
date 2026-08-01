import './setup';

import * as assert from 'assert';
import { parseScopes } from '../../src/slack/slackClient';

suite('slackClient.parseScopes', () => {
  test('カンマ区切り文字列を trim して集合化する', () => {
    const s = parseScopes('dnd:write, users.profile:write ,chat:write');
    assert.ok(s.has('dnd:write'));
    assert.ok(s.has('users.profile:write'));
    assert.ok(s.has('chat:write'));
    assert.strictEqual(s.size, 3);
  });

  test('undefined / 空文字は空集合', () => {
    assert.strictEqual(parseScopes(undefined).size, 0);
    assert.strictEqual(parseScopes('').size, 0);
  });

  test('必要スコープの包含判定に使える', () => {
    const s = parseScopes('dnd:write,users.profile:write');
    const missing = ['dnd:write', 'users.profile:write'].filter((r) => !s.has(r));
    assert.strictEqual(missing.length, 0);
  });
});
