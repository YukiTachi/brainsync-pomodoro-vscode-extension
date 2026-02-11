import * as path from 'path';
import Mocha = require('mocha');
import glob = require('glob');

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000,
  });

  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    // Use sync glob instead of callback-based
    try {
      const files = glob.sync('**/**.test.js', { cwd: testsRoot });
      files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
