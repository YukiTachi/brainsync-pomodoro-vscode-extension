import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  test('拡張機能がアクティベートされる', async () => {
    // BrainSync拡張のコマンドが登録されているか確認
    const commands = await vscode.commands.getCommands(true);
    const brainSyncCommands = commands.filter((c) => c.startsWith('brainsync.'));
    assert.ok(
      brainSyncCommands.length > 0,
      'BrainSync commands should be registered'
    );
  });

  test('brainsync.startTimerコマンドが存在する', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('brainsync.startTimer'),
      'brainsync.startTimer should be registered'
    );
  });

  test('brainsync.viewStatsコマンドが存在する', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('brainsync.viewStats'),
      'brainsync.viewStats should be registered'
    );
  });

  test('brainsync.openDiagnosisコマンドが存在する', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('brainsync.openDiagnosis'),
      'brainsync.openDiagnosis should be registered'
    );
  });
});
