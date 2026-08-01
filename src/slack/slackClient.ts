import * as https from 'https';

/**
 * Slack Web API のレスポンス。
 * HTTP 200 でも ok:false を返し得るため、error を分類して扱う（S3）。
 */
export interface SlackResponse {
  ok: boolean;
  error?: string;
  /** レスポンスヘッダ（小文字キー）。x-oauth-scopes をスコープ検証に使う。 */
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Slack Web API クライアント（テスト用に注入可能）。
 */
export interface SlackClient {
  call(
    method: string,
    token: string,
    params?: Record<string, string | number>,
  ): Promise<SlackResponse>;
}

const SLACK_HOST = 'slack.com';
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Node の https を用いた依存ゼロの SlackClient 実装。
 *
 * - POST https://slack.com/api/<method>（application/x-www-form-urlencoded, Bearer token）
 * - ok:false でも reject せず結果として返す（呼び出し側が error を分類）
 * - ネットワーク例外・タイムアウトは { ok:false, error:'network_error' } に正規化
 * - トークンは一切ログに出さない
 */
export class HttpsSlackClient implements SlackClient {
  constructor(private timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  call(
    method: string,
    token: string,
    params: Record<string, string | number> = {},
  ): Promise<SlackResponse> {
    return new Promise((resolve) => {
      const body = new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      ).toString();

      const req = https.request(
        {
          host: SLACK_HOST,
          path: `/api/${method}`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === 'string') { headers[k.toLowerCase()] = v; }
              else if (Array.isArray(v)) { headers[k.toLowerCase()] = v.join(','); }
            }
            try {
              const parsed = JSON.parse(data) as SlackResponse;
              parsed.headers = headers;
              resolve(parsed);
            } catch {
              resolve({ ok: false, error: 'invalid_response', headers });
            }
          });
        },
      );

      req.on('error', () => resolve({ ok: false, error: 'network_error' }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'network_error' });
      });

      req.write(body);
      req.end();
    });
  }
}

/** x-oauth-scopes（カンマ区切り文字列）を集合にパースする。 */
export function parseScopes(headerValue: string | undefined): Set<string> {
  if (!headerValue) { return new Set(); }
  return new Set(headerValue.split(',').map((s) => s.trim()).filter(Boolean));
}
