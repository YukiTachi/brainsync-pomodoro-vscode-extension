import './setup';

import * as assert from 'assert';
import { _setConfig, _resetConfig, _getLastCreatedPanel, Uri } from './mocks/vscode';
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

/**
 * NotificationManager を作成して Webview HTML を取得するヘルパー
 */
function getWebviewHtml(): string {
  _resetConfig();
  _setConfig({
    notificationEnabled: true,
    soundEnabled: true,
    soundVolume: 50,
    soundFile: 'bell',
    fatigueAlertEnabled: true,
    fatigueAlertThreshold: 21,
  });

  const extensionUri = Uri.file('/mock/extension') as any;
  const manager = new NotificationManager(
    createMockStorage(),
    createMockCallbacks(),
    extensionUri,
  );

  // 通知を呼んで Webview を生成させる
  manager.notifyBreakComplete();

  const panel = _getLastCreatedPanel();
  assert.ok(panel, 'Webview panel should be created');

  return panel!.webview.html;
}

// ============================================================
// テストスイート
// ============================================================

suite('Webview HTML/JS Validation Tests', () => {

  let html: string;

  suiteSetup(() => {
    html = getWebviewHtml();
  });

  suiteTeardown(() => {
    _resetConfig();
  });

  // ============================================================
  // HTML 構造
  // ============================================================

  suite('HTML 構造', () => {

    test('DOCTYPE 宣言がある', () => {
      assert.ok(html.includes('<!DOCTYPE html>'), 'Should have DOCTYPE declaration');
    });

    test('lang 属性が ja に設定されている', () => {
      assert.ok(html.includes('lang="ja"'), 'Should have lang="ja"');
    });

    test('charset が UTF-8 に設定されている', () => {
      assert.ok(html.includes('charset="UTF-8"'), 'Should have UTF-8 charset');
    });

    test('タイトルが設定されている', () => {
      assert.match(html, /<title>.*BrainSync.*<\/title>/i, 'Should have BrainSync in title');
    });
  });

  // ============================================================
  // Content Security Policy
  // ============================================================

  suite('Content Security Policy', () => {

    test('CSP meta タグが存在する', () => {
      assert.ok(
        html.includes('Content-Security-Policy'),
        'Should have CSP meta tag',
      );
    });

    test('default-src が none に設定されている', () => {
      assert.ok(
        html.includes("default-src 'none'"),
        'default-src should be none',
      );
    });

    test('media-src が設定されている', () => {
      assert.ok(
        html.includes('media-src'),
        'Should have media-src directive for audio playback',
      );
    });

    test('connect-src が設定されている（fetch API 用）', () => {
      assert.ok(
        html.includes('connect-src'),
        'Should have connect-src directive for fetch API',
      );
    });

    test('script-src にインラインスクリプトが許可されている', () => {
      assert.ok(
        html.includes("script-src 'unsafe-inline'"),
        'Should allow inline scripts',
      );
    });

    test('外部スクリプト・スタイルのソースが許可されていない', () => {
      // http:// や https:// のスクリプトソースがないことを確認
      const scriptSrcMatch = html.match(/script-src[^;]*/);
      assert.ok(scriptSrcMatch, 'script-src should exist');
      assert.ok(
        !scriptSrcMatch![0].includes('https://'),
        'Should not allow external script sources',
      );
    });
  });

  // ============================================================
  // UI 要素
  // ============================================================

  suite('UI 要素', () => {

    test('ステータス表示要素が存在する', () => {
      assert.ok(html.includes('id="status"'), 'Should have status element');
    });

    test('手動再生ボタンが存在する', () => {
      assert.ok(html.includes('id="playBtn"'), 'Should have play button');
    });

    test('再生ボタンが初期状態で非表示', () => {
      assert.ok(
        html.includes('display: none'),
        'Play button should be hidden by default',
      );
    });

    test('初期ステータスメッセージが適切', () => {
      assert.ok(
        html.includes('サウンドプレーヤー準備完了'),
        'Should show ready status message',
      );
    });
  });

  // ============================================================
  // JavaScript - Web Audio API
  // ============================================================

  suite('JavaScript - Web Audio API', () => {

    test('AudioContext が使用されている', () => {
      assert.ok(
        html.includes('AudioContext'),
        'Should use AudioContext for audio playback',
      );
    });

    test('decodeAudioData が使用されている', () => {
      assert.ok(
        html.includes('decodeAudioData'),
        'Should use decodeAudioData for MP3 decoding',
      );
    });

    test('GainNode でボリューム制御している', () => {
      assert.ok(
        html.includes('createGain') || html.includes('GainNode'),
        'Should use GainNode for volume control',
      );
    });

    test('gain.value に volume が設定される', () => {
      assert.ok(
        html.includes('gainNode.gain.value'),
        'Should set gainNode.gain.value for volume',
      );
    });

    test('createBufferSource が使用されている', () => {
      assert.ok(
        html.includes('createBufferSource'),
        'Should use createBufferSource for audio playback',
      );
    });

    test('AudioContext の suspended 状態を処理する', () => {
      assert.ok(
        html.includes("ctx.state === 'suspended'") || html.includes('ctx.state'),
        'Should handle AudioContext suspended state',
      );
    });

    test('AudioContext.resume() が呼ばれる', () => {
      assert.ok(
        html.includes('ctx.resume()'),
        'Should call resume() on suspended AudioContext',
      );
    });
  });

  // ============================================================
  // JavaScript - フォールバック
  // ============================================================

  suite('JavaScript - フォールバック機構', () => {

    test('HTML5 Audio フォールバックが存在する', () => {
      assert.ok(
        html.includes('new Audio('),
        'Should have HTML5 Audio fallback',
      );
    });

    test('Audio.play() の Promise エラーハンドリングがある', () => {
      assert.ok(
        html.includes('.play().catch'),
        'Should handle Audio.play() promise rejection',
      );
    });

    test('手動再生ボタンのクリックハンドラがある', () => {
      assert.ok(
        html.includes("getElementById('playBtn').addEventListener('click'"),
        'Should have click handler for manual play button',
      );
    });

    test('自動再生ブロック時にボタンが表示される', () => {
      assert.ok(
        html.includes("playBtn').style.display = 'inline-block'") ||
        html.includes("playBtn').style.display = \"inline-block\""),
        'Should show play button when autoplay is blocked',
      );
    });
  });

  // ============================================================
  // JavaScript - メッセージプロトコル
  // ============================================================

  suite('JavaScript - メッセージプロトコル', () => {

    test('acquireVsCodeApi が呼ばれている', () => {
      assert.ok(
        html.includes('acquireVsCodeApi()'),
        'Should call acquireVsCodeApi()',
      );
    });

    test('ready メッセージが送信される', () => {
      assert.ok(
        html.includes("postMessage({ command: 'ready' })") ||
        html.includes('postMessage({command:\'ready\'})'),
        'Should send ready message on initialization',
      );
    });

    test('message イベントリスナーが登録されている', () => {
      assert.ok(
        html.includes("addEventListener('message'"),
        'Should listen for message events',
      );
    });

    test('playSound コマンドのハンドラがある', () => {
      assert.ok(
        html.includes("message.command === 'playSound'"),
        'Should handle playSound command',
      );
    });

    test('fetch API で音声ファイルを取得する', () => {
      assert.ok(
        html.includes('fetch(url)') || html.includes('fetch('),
        'Should use fetch API to load audio file',
      );
    });
  });

  // ============================================================
  // JavaScript - エラーハンドリング
  // ============================================================

  suite('JavaScript - エラーハンドリング', () => {

    test('Web Audio API 再生失敗時の catch がある', () => {
      assert.ok(
        html.includes('AudioContext play failed') ||
        html.includes('catch (err)'),
        'Should catch Web Audio API errors',
      );
    });

    test('HTML5 Audio 再生失敗時の catch がある', () => {
      assert.ok(
        html.includes('Audio element play also failed') ||
        html.includes('Audio element creation failed'),
        'Should catch HTML5 Audio errors',
      );
    });

    test('再生失敗時にユーザーへフィードバックがある', () => {
      assert.ok(
        html.includes('自動再生がブロックされました') ||
        html.includes('ボタンをクリック'),
        'Should show user feedback on autoplay block',
      );
    });
  });

  // ============================================================
  // JavaScript - 再生状態表示
  // ============================================================

  suite('JavaScript - 再生状態表示', () => {

    test('再生中のステータスが表示される', () => {
      assert.ok(
        html.includes('サウンド再生中'),
        'Should show playing status',
      );
    });

    test('再生完了後にステータスがリセットされる', () => {
      assert.ok(
        html.includes('source.onended'),
        'Should handle source.onended event to reset status',
      );
    });

    test('Web Audio API 再生完了時に soundComplete メッセージが送信される', () => {
      assert.ok(
        html.includes("postMessage({ command: 'soundComplete' })"),
        'Should send soundComplete message when Web Audio source ends',
      );
    });

    test('HTML5 Audio 再生完了時に soundComplete メッセージが送信される', () => {
      assert.ok(
        html.includes('audio.onended'),
        'Should handle audio.onended event for HTML5 Audio fallback',
      );
    });
  });
});
