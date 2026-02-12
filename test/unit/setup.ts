/**
 * ユニットテスト用セットアップ
 * 'vscode' モジュールの解決をモックにリダイレクトする
 */
import * as path from 'path';
const Module = require('module');

const vscodeMockPath = path.resolve(__dirname, 'mocks', 'vscode');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any,
) {
  if (request === 'vscode') {
    return require.resolve(vscodeMockPath);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
