/**
 * package.json の %key% と package.nls*.json の整合性テスト
 *
 * vscode モック不要の純 Node テスト。キー不一致は「%command.startTimer%」が
 * マーケットプレースやコマンドパレットに生表示される事故に直結するため、
 * ここで機械的に検出する（docs/marketplace-l10n-plan.md §8）。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// コンパイル後は out/test/unit/nls.test.js から実行されるため、3 階層上がリポジトリ root
const ROOT = path.resolve(__dirname, '../../..');

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

/**
 * VS Code / vsce と同じく「値全体が %key% に一致する文字列」だけをキーとして扱う。
 * 「サウンド音量（%）」のように値の途中に % を含む文字列はキーではない。
 * 生テキストへの非 anchored 正規表現ではなく、JSON を再帰走査して値単位で判定する。
 */
const NLS_KEY = /^%([A-Za-z0-9._-]+)%$/;

function collectNlsKeys(node: unknown, out: Set<string>): void {
  if (typeof node === 'string') {
    const m = NLS_KEY.exec(node);
    if (m) { out.add(m[1]); }
  } else if (Array.isArray(node)) {
    node.forEach((v) => collectNlsKeys(v, out));
  } else if (node && typeof node === 'object') {
    Object.values(node as Record<string, unknown>).forEach((v) => collectNlsKeys(v, out));
  }
}

/**
 * 日本語（ひらがな・カタカナ・漢字）と全角記号・全角英数の検出。
 * バックスラッシュのエスケープに頼らずコードポイントから組み立てることで、
 * レビューで範囲が読め、エディタの正規化でも壊れない。
 */
const JA_RANGES: Array<[number, number]> = [
  [0x3000, 0x303f], // CJK 記号・句読点（「」、。 など）
  [0x3040, 0x30ff], // ひらがな・カタカナ
  [0x4e00, 0x9faf], // CJK 統合漢字
  [0xff00, 0xffef], // 全角英数・全角括弧（（）：！ など）
];
const JA = new RegExp(
  '[' + JA_RANGES.map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']',
);

suite('package.nls 整合性', () => {
  const pkg = readJson('package.json');
  const en = readJson('package.nls.json') as Record<string, string>;
  const ja = readJson('package.nls.ja.json') as Record<string, string>;

  const referenced = new Set<string>();
  collectNlsKeys(pkg, referenced);

  test('package.json が参照する %key% が 1 つ以上ある', () => {
    assert.ok(referenced.size > 0, 'no %key% references found in package.json');
  });

  test('参照される全キーが package.nls.json（英語）に存在する', () => {
    const missing = [...referenced].filter((k) => !(k in en));
    assert.deepStrictEqual(missing, [], `missing in package.nls.json: ${missing.join(', ')}`);
  });

  test('参照される全キーが package.nls.ja.json（日本語）に存在する', () => {
    const missing = [...referenced].filter((k) => !(k in ja));
    assert.deepStrictEqual(missing, [], `missing in package.nls.ja.json: ${missing.join(', ')}`);
  });

  test('package.nls.json に未参照の余分なキーが無い', () => {
    const extra = Object.keys(en).filter((k) => !referenced.has(k));
    assert.deepStrictEqual(extra, [], `unreferenced keys in package.nls.json: ${extra.join(', ')}`);
  });

  test('package.nls.ja.json に未参照の余分なキーが無い', () => {
    const extra = Object.keys(ja).filter((k) => !referenced.has(k));
    assert.deepStrictEqual(extra, [], `unreferenced keys in package.nls.ja.json: ${extra.join(', ')}`);
  });

  test('英語・日本語のキー集合が一致する', () => {
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(ja).sort());
  });

  test('両ファイルの全値が空文字でない', () => {
    for (const [file, dict] of [['package.nls.json', en], ['package.nls.ja.json', ja]] as const) {
      const empty = Object.entries(dict).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
      assert.deepStrictEqual(empty, [], `empty values in ${file}: ${empty.map(([k]) => k).join(', ')}`);
    }
  });

  test('英語側（package.nls.json）に日本語・全角文字が残っていない', () => {
    // ja は現行値のコピーなので、en へのコピペ漏れが最も起きやすい事故
    const leaked = Object.entries(en).filter(([, v]) => JA.test(v));
    assert.deepStrictEqual(
      leaked.map(([k]) => k),
      [],
      `Japanese/full-width characters found in package.nls.json: ${leaked.map(([k, v]) => `${k}=${v}`).join(' | ')}`,
    );
  });
});
