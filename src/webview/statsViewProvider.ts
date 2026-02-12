import * as vscode from 'vscode';
import { Statistics } from '../config';
import { formatMinutes, getFatigueLevel } from '../utils';

/**
 * 統計画面Webviewの管理
 */
export class StatsViewProvider {
  private panel: vscode.WebviewPanel | null = null;
  private extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * 統計画面を表示
   */
  show(stats: Statistics): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.updateContent(stats);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'brainSyncStats',
      'BrainSync 統計',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'openDiagnosis':
          vscode.commands.executeCommand('brainsync.openDiagnosis');
          break;
        case 'exportData':
          vscode.commands.executeCommand('brainsync.exportData');
          break;
      }
    });

    this.updateContent(stats);
  }

  /**
   * コンテンツを更新
   */
  updateContent(stats: Statistics): void {
    if (!this.panel) {return;}
    this.panel.webview.html = this.getHtml(this.panel.webview, stats);
  }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
  }

  // ============================================================
  // HTML生成
  // ============================================================

  private getHtml(webview: vscode.Webview, stats: Statistics): string {
    const fatigueLevel = getFatigueLevel(stats.today.fatigueScore);
    const weekFatigueLevel = getFatigueLevel(stats.week.fatigueScore);

    // 週間トレンドのバーチャート
    const maxSessions = Math.max(...stats.week.dailyStats.map((d) => d.sessions), 1);
    const dayNames = ['月', '火', '水', '木', '金', '土', '日'];
    const today = new Date().toISOString().split('T')[0];

    const trendBars = stats.week.dailyStats
      .map((day, i) => {
        const width = maxSessions > 0 ? Math.round((day.sessions / maxSessions) * 100) : 0;
        const isToday = day.date === today;
        const todayLabel = isToday ? ' (今日)' : '';
        return `
          <div class="trend-row">
            <span class="trend-day">${dayNames[i]}</span>
            <div class="trend-bar-container">
              <div class="trend-bar ${isToday ? 'today' : ''}" style="width: ${width}%"></div>
            </div>
            <span class="trend-count">${day.sessions}${todayLabel}</span>
          </div>`;
      })
      .join('');

    // 今日の日付表示
    const todayDate = new Date();
    const dateDisplay = `${todayDate.getMonth() + 1}月${todayDate.getDate()}日`;

    // アドバイス生成
    const advices = this.generateAdvices(stats);

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'unsafe-inline';
    img-src ${webview.cspSource} https:;
  ">
  <title>BrainSync 統計</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-sideBar-background);
      --text-primary: var(--vscode-editor-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --accent: var(--vscode-button-background);
      --green: #4CAF50;
      --yellow: #FFC107;
      --orange: #FF9800;
      --red: #F44336;
      --blue: #2196F3;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--text-primary);
      background: var(--bg-primary);
      padding: 1.5rem;
      max-width: 600px;
      margin: 0 auto;
    }

    h1 {
      font-size: 1.4rem;
      margin-bottom: 1.5rem;
      border-bottom: 2px solid var(--border);
      padding-bottom: 0.5rem;
    }

    .section {
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: var(--bg-secondary);
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    .section-title {
      font-size: 1.1rem;
      font-weight: bold;
      margin-bottom: 0.8rem;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 0.3rem 0;
    }

    .stat-label {
      color: var(--text-secondary);
    }

    .stat-value {
      font-weight: bold;
    }

    .fatigue-score {
      font-size: 1.8rem;
      font-weight: bold;
      text-align: center;
      padding: 0.5rem;
    }

    .fatigue-label {
      text-align: center;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    .advice-list {
      list-style: none;
      padding: 0;
    }

    .advice-list li {
      padding: 0.3rem 0;
      padding-left: 1.2rem;
      position: relative;
    }

    .advice-list li::before {
      content: '•';
      position: absolute;
      left: 0;
      color: var(--accent);
    }

    .trend-row {
      display: flex;
      align-items: center;
      padding: 0.25rem 0;
    }

    .trend-day {
      width: 2rem;
      font-weight: bold;
    }

    .trend-bar-container {
      flex: 1;
      height: 1.2rem;
      background: var(--bg-primary);
      border-radius: 3px;
      margin: 0 0.5rem;
      overflow: hidden;
    }

    .trend-bar {
      height: 100%;
      background: var(--blue);
      border-radius: 3px;
      transition: width 0.3s;
    }

    .trend-bar.today {
      background: var(--green);
    }

    .trend-count {
      min-width: 5rem;
      text-align: right;
      font-size: 0.9em;
    }

    .button-container {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
      flex-wrap: wrap;
    }

    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      font-family: var(--vscode-font-family);
    }

    .btn-primary {
      background: var(--accent);
      color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
      opacity: 0.9;
    }

    .btn-secondary {
      background: transparent;
      color: var(--text-primary);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      background: var(--bg-secondary);
    }

    .diagnosis-note {
      font-size: 0.85rem;
      color: var(--text-secondary);
      margin-top: 0.5rem;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <h1>🧠 BrainSync 統計</h1>

  <div class="section">
    <div class="section-title">📅 今日の記録 (${dateDisplay})</div>
    <div class="stat-row">
      <span class="stat-label">完了セット数</span>
      <span class="stat-value">${stats.today.sessions}セット</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">合計集中時間</span>
      <span class="stat-value">${formatMinutes(stats.today.totalFocusTime)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">中断回数</span>
      <span class="stat-value">${stats.today.interruptedSessions}回</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">📊 今週の記録 (${stats.week.weekStart || '--'} ～ ${stats.week.weekEnd || '--'})</div>
    <div class="stat-row">
      <span class="stat-label">完了セット数</span>
      <span class="stat-value">${stats.week.totalSessions}セット</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">合計集中時間</span>
      <span class="stat-value">${formatMinutes(stats.week.totalFocusTime)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">平均</span>
      <span class="stat-value">${stats.week.dailyAverage}セット/日</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">🧠 推定脳疲労スコア</div>
    <div class="fatigue-score" style="color: ${this.getFatigueColor(stats.today.fatigueScore)}">
      ${fatigueLevel.emoji} ${stats.today.fatigueScore}点
    </div>
    <div class="fatigue-label">${fatigueLevel.label}</div>

    <div class="diagnosis-note">
      💡 この推定は作業時間から算出した簡易的なものです。より詳しい診断で正確な状態を把握しましょう。
    </div>

    <div class="button-container">
      <button class="btn btn-primary" onclick="sendMessage('openDiagnosis')" aria-label="詳しい脳疲労診断を受ける">
        詳しい診断を受ける
      </button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">💡 アドバイス</div>
    <ul class="advice-list">
      ${advices.map((a) => `<li>${a}</li>`).join('')}
    </ul>
  </div>

  <div class="section">
    <div class="section-title">📈 週間トレンド</div>
    ${trendBars}
  </div>

  <div class="button-container">
    <button class="btn btn-secondary" onclick="sendMessage('exportData')">
      データをエクスポート
    </button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function sendMessage(command) {
      vscode.postMessage({ command });
    }
  </script>
</body>
</html>`;
  }

  private getFatigueColor(score: number): string {
    if (score <= 10) {return '#4CAF50';}
    if (score <= 20) {return '#FFC107';}
    if (score <= 30) {return '#FF9800';}
    return '#F44336';
  }

  private generateAdvices(stats: Statistics): string[] {
    const advices: string[] = [];
    const score = stats.today.fatigueScore;

    if (stats.today.sessions >= 8) {
      advices.push('今日は十分に作業しました。これ以上は控えましょう');
    }

    if (score >= 21) {
      advices.push('睡眠時間を30分延長することを推奨');
    }

    if (stats.today.interruptedSessions > stats.today.sessions * 0.3) {
      advices.push('集中力が低下気味です。環境を整えましょう');
    }

    const breakRate =
      stats.today.sessions > 0
        ? stats.today.totalBreakTime / (stats.today.sessions * 5)
        : 1;
    if (breakRate < 0.5 && stats.today.sessions > 0) {
      advices.push('こまめな休憩を取りましょう');
    }

    advices.push('こまめな水分補給を忘れずに');

    if (stats.week.totalSessions > 0) {
      const remaining = Math.max(0, 8 - stats.today.sessions);
      if (remaining > 0) {
        advices.push(`今日の推奨残りセット数: ${remaining}セット以内`);
      }
    }

    return advices.slice(0, 4); // 最大4つ
  }
}
