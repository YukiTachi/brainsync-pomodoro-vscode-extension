/**
 * スタンドアロン ユニットテストランナー
 * VS Code ランタイムなしで実行可能
 */
import * as path from 'path';
import Mocha = require('mocha');
import glob = require('glob');

function run(): void {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000,
  });

  const testsRoot = path.resolve(__dirname, '.');

  try {
    const files = glob.sync('**/*.test.js', { cwd: testsRoot });
    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

    mocha.run((failures: number) => {
      if (failures > 0) {
        console.error(`${failures} tests failed.`);
        process.exit(1);
      }
    });
  } catch (err) {
    console.error('Failed to run unit tests:', err);
    process.exit(1);
  }
}

run();
