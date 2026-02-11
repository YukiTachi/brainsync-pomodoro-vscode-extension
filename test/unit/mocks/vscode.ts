/**
 * vscode モジュールのモック
 * VS Code ランタイムなしでユニットテストを実行するために使用
 */

// 設定値ストア（テストごとにリセット可能）
let configStore: Record<string, any> = {};

export function _setConfig(values: Record<string, any>): void {
  configStore = { ...values };
}

export function _resetConfig(): void {
  configStore = {};
}

// ============================================================
// Uri
// ============================================================
export class Uri {
  scheme: string;
  authority: string;
  path: string;
  fsPath: string;
  query: string;
  fragment: string;

  constructor(scheme: string, authority: string, path: string) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.fsPath = path;
    this.query = '';
    this.fragment = '';
  }

  static file(path: string): Uri {
    return new Uri('file', '', path);
  }

  static parse(value: string): Uri {
    return new Uri('https', '', value);
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    const joined = [base.path, ...pathSegments].join('/');
    return new Uri(base.scheme, base.authority, joined);
  }

  with(_change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      _change.scheme ?? this.scheme,
      _change.authority ?? this.authority,
      _change.path ?? this.path,
    );
  }

  toJSON(): any {
    return { scheme: this.scheme, authority: this.authority, path: this.path };
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

// ============================================================
// Webview / WebviewPanel
// ============================================================
export interface MockWebview {
  html: string;
  cspSource: string;
  asWebviewUri: (uri: Uri) => Uri;
  postMessage: (message: any) => void;
  onDidReceiveMessage: (listener: (message: any) => void) => { dispose: () => void };
  _listeners: Array<(message: any) => void>;
  _postedMessages: any[];
  _simulateMessage: (message: any) => void;
}

function createMockWebview(): MockWebview {
  const listeners: Array<(message: any) => void> = [];
  const postedMessages: any[] = [];

  return {
    html: '',
    cspSource: 'https://mock-csp-source.vscode-cdn.net',
    asWebviewUri: (uri: Uri) => {
      return new Uri('https', 'mock-webview', uri.path) as any;
    },
    postMessage: (message: any) => {
      postedMessages.push(message);
    },
    onDidReceiveMessage: (listener: (message: any) => void) => {
      listeners.push(listener);
      return { dispose: () => { /* noop */ } };
    },
    _listeners: listeners,
    _postedMessages: postedMessages,
    _simulateMessage: (message: any) => {
      listeners.forEach(l => l(message));
    },
  };
}

export interface MockWebviewPanel {
  webview: MockWebview;
  dispose: () => void;
  onDidDispose: (listener: () => void) => { dispose: () => void };
  _disposeListeners: Array<() => void>;
  _simulateDispose: () => void;
}

function createMockWebviewPanel(): MockWebviewPanel {
  const disposeListeners: Array<() => void> = [];
  const webview = createMockWebview();

  return {
    webview: webview as any,
    dispose: () => {
      disposeListeners.forEach(l => l());
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: () => { /* noop */ } };
    },
    _disposeListeners: disposeListeners,
    _simulateDispose: () => {
      disposeListeners.forEach(l => l());
    },
  };
}

// 最後に作成された WebviewPanel を追跡
let lastCreatedPanel: MockWebviewPanel | null = null;
export function _getLastCreatedPanel(): MockWebviewPanel | null {
  return lastCreatedPanel;
}
export function _resetLastCreatedPanel(): void {
  lastCreatedPanel = null;
}

// ============================================================
// ViewColumn
// ============================================================
export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
};

// ============================================================
// window
// ============================================================
export const window = {
  createWebviewPanel: (
    _viewType: string,
    _title: string,
    _showOptions: any,
    _options?: any,
  ): MockWebviewPanel => {
    const panel = createMockWebviewPanel();
    lastCreatedPanel = panel;
    return panel as any;
  },

  showInformationMessage: async (..._args: any[]): Promise<string | undefined> => {
    return undefined;
  },

  showWarningMessage: async (..._args: any[]): Promise<string | undefined> => {
    return undefined;
  },

  createOutputChannel: (_name: string) => ({
    appendLine: (_msg: string) => { /* noop */ },
    dispose: () => { /* noop */ },
  }),
};

// ============================================================
// workspace
// ============================================================
export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => {
      const fullKey = key;
      if (fullKey in configStore) {
        return configStore[fullKey] as T;
      }
      return defaultValue as T;
    },
  }),
};

// ============================================================
// commands
// ============================================================
export const commands = {
  executeCommand: async (_command: string, ..._args: any[]): Promise<any> => {
    // noop in tests
    return undefined;
  },
};

// ============================================================
// env
// ============================================================
export const env = {
  openExternal: (_uri: Uri) => Promise.resolve(true),
};
