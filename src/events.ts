import { createAria2Client } from './rpc.js';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'aria2-rpc': { kind: 'aria2-rpc' };
  }
}

export interface CompletionNotice {
  gid: string;
  failed: boolean;
}

/** Parse one aria2 WebSocket notification; ignore everything else without throwing. */
export function parseAria2Notification(data: unknown): CompletionNotice | undefined {
  if (typeof data !== 'string' || data.length > 4096) return undefined;
  let payload: unknown;
  try { payload = JSON.parse(data); } catch { return undefined; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const p = payload as Record<string, unknown>;
  if (p.jsonrpc !== '2.0' || (p.method !== 'aria2.onDownloadComplete' && p.method !== 'aria2.onDownloadError')) return undefined;
  if (!Array.isArray(p.params) || p.params.length !== 1) return undefined;
  const param = p.params[0];
  if (!param || typeof param !== 'object' || Array.isArray(param)) return undefined;
  const gid = (param as Record<string, unknown>).gid;
  if (typeof gid !== 'string' || !/^(?!0{16}$)[a-f0-9]{16}$/i.test(gid)) return undefined;
  return { gid: gid.toLowerCase(), failed: p.method === 'aria2.onDownloadError' };
}

interface Socket {
  close(): void;
  send(data: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Keep one WebSocket open for aria2 completion/error notifications.
 * ponytail: config changes need a plugin reload; reconnect uses the latest host/port.
 */
export function startAria2Events(options: {
  endpoint: () => { host: string; port: number };
  onNotice: (notice: CompletionNotice) => void;
  signal: AbortSignal;
  createSocket?: (url: string) => Socket;
}): void {
  const connectSocket = options.createSocket ?? ((url: string) => new (globalThis as unknown as { WebSocket: new (url: string) => Socket }).WebSocket(url));
  let socket: Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(connect, 5000);
  };
  const connect = (): void => {
    if (stopped || options.signal.aborted) return;
    try {
      const { host, port } = options.endpoint();
      const next = connectSocket(`ws://${host}:${port}/jsonrpc`);
      socket = next;
      // aria2 starts pushing notifications only after this subscription call.
      next.onopen = () => {
        try { next.send(JSON.stringify({ jsonrpc: '2.0', id: 'aria2-rpc', method: 'system.listNotifications' })); } catch { /* close follows */ }
      };
      next.onmessage = (event) => {
        const notice = parseAria2Notification(event.data);
        if (notice) options.onNotice(notice);
      };
      next.onclose = () => { if (!stopped) schedule(); };
      next.onerror = () => { try { next.close(); } catch { /* close follows */ } };
    } catch {
      schedule();
    }
  };
  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try { socket?.close(); } catch { /* already gone */ }
  };
  options.signal.addEventListener('abort', stop, { once: true });
  connect();
}

/** Build one concise, bounded notification after fetching best-effort task details. */
export async function describeCompletion(notice: CompletionNotice, config: { host: string; port: number; timeoutMs: number; secret?: string; signal: AbortSignal }): Promise<string> {
  const prefix = notice.failed ? '[aria2] 下载失败' : '[aria2] 下载完成';
  let detail = '';
  try {
    const client = createAria2Client({ rpcHost: config.host, rpcPort: config.port, timeoutMs: config.timeoutMs, secret: config.secret, signal: config.signal });
    const status = await client.status({ gid: notice.gid });
    const file = status.files[0]?.path ?? status.directory;
    detail = notice.failed
      ? `\n文件：${file}\n错误：${status.errorCode} ${status.error ?? ''}`.trimEnd()
      : `\n文件：${file}\n大小：${status.totalBytes} 字节`;
  } catch { /* the event still matters without task details */ }
  return `${prefix}：${notice.gid}${detail}`;
}
