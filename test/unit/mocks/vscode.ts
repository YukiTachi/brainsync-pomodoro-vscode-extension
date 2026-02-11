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
// window
// ============================================================
export const window = {
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
