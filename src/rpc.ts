import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export type Aria2ErrorCode = 'INVALID_INPUT' | 'RPC_ERROR' | 'HTTP_ERROR' | 'REDIRECT'
  | 'BAD_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'NETWORK' | 'TIMEOUT' | 'ABORTED';

/** Messages and enumerable fields are safe for Host display; raw remote errors are never attached. */
export class Aria2Error extends Error {
  code: Aria2ErrorCode;
  requestSent: boolean;
  constructor(code: Aria2ErrorCode, message: string, requestSent = false) {
    super(message);
    this.name = 'Aria2Error';
    this.code = code;
    this.requestSent = requestSent;
  }
}

export interface Aria2ClientConfig {
  rpcHost: string;
  rpcPort: number;
  secret?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface Aria2Checksum {
  algorithm: 'sha-256' | 'sha-1' | 'md5';
  digest: string;
}
export interface Aria2DownloadArgs {
  url: string;
  directory?: string;
  filename?: string;
  checksum?: Aria2Checksum;
  /** undefined inherits aria2 config; '' is direct; otherwise an unauthenticated HTTP proxy. */
  proxy?: string;
}
export interface Aria2StatusArgs { gid: string }
export type Aria2ControlAction = 'pause' | 'resume' | 'cancel';
export interface Aria2ControlArgs { gid: string; action: Aria2ControlAction }
export interface Aria2FileEntry { path: string; length: string; completedLength: string }
export interface Aria2StatusResult {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalBytes: string;
  completedBytes: string;
  downloadSpeed: string;
  uploadSpeed: string;
  connections: string;
  directory: string;
  files: Aria2FileEntry[];
  filesTruncated: boolean;
  /** Fraction 0..1, rounded down to four decimal places; null for unknown total size. */
  progress: number | null;
  errorCode: string;
  error: string | null;
}
export type Aria2ListState = 'active' | 'waiting' | 'stopped' | 'all';
export interface Aria2ListArgs {
  state?: Aria2ListState;
  limit?: number;
  offset?: number;
}
export interface Aria2TaskSummary {
  gid: string;
  status: Aria2StatusResult['status'];
  totalBytes: string;
  completedBytes: string;
  downloadSpeed: string;
  connections: string;
  directory: string;
  file: string | null;
  progress: number | null;
  errorCode: string;
  error: string | null;
}
export interface Aria2ListResult {
  state: Aria2ListState;
  offset: number;
  limit: number;
  active?: Aria2TaskSummary[];
  waiting?: Aria2TaskSummary[];
  stopped?: Aria2TaskSummary[];
}
export type Aria2MutateResult<T> = ({ outcome: 'ok' } & T)
  | ({ outcome: 'unknown_effect'; code: 'UNKNOWN_EFFECT'; reason: string } & T);
export type Aria2DownloadResult = Aria2MutateResult<{ gid: string }>;
export type Aria2ControlResult = Aria2MutateResult<{ gid: string; action: Aria2ControlAction }>;
export interface Aria2Client {
  version(opts?: { signal?: AbortSignal }): Promise<{ version: string }>;
  download(args: Aria2DownloadArgs, opts?: { signal?: AbortSignal }): Promise<Aria2DownloadResult>;
  status(args: Aria2StatusArgs, opts?: { signal?: AbortSignal }): Promise<Aria2StatusResult>;
  list(args: Aria2ListArgs, opts?: { signal?: AbortSignal }): Promise<Aria2ListResult>;
  control(args: Aria2ControlArgs, opts?: { signal?: AbortSignal }): Promise<Aria2ControlResult>;
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DNS_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;
const GID = /^(?!0{16}$)[a-f0-9]{16}$/i;
const DECIMAL = /^[0-9]+$/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const CHECKSUM_LENGTH = { 'sha-256': 64, 'sha-1': 40, md5: 32 } as const;
const METHODS = { pause: 'aria2.pause', resume: 'aria2.unpause', cancel: 'aria2.remove' } as const;
const STATUS_KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed',
  'uploadSpeed', 'connections', 'dir', 'files', 'errorCode'];
const STATUSES = ['active', 'waiting', 'paused', 'error', 'complete', 'removed'] as const;

function fail(code: Aria2ErrorCode, message: string): never { throw new Aria2Error(code, message); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('INVALID_INPUT', `${label}: expected a plain object`);
  }
  return value as Record<string, unknown>;
}
function fields(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  const result = object(value, label);
  if (Reflect.ownKeys(result).some((key) => typeof key !== 'string' || !allowed.includes(key))) {
    fail('INVALID_INPUT', `${label}: unknown field`);
  }
  return result;
}
function integer(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    fail('INVALID_INPUT', `${label}: expected integer 1..${max}`);
  }
  return value;
}
function lifecycle(value: unknown): AbortSignal | undefined {
  if (value !== undefined && !(value instanceof AbortSignal)) fail('INVALID_INPUT', 'signal: expected AbortSignal');
  return value as AbortSignal | undefined;
}
function gidValue(value: unknown): string {
  if (typeof value !== 'string' || !GID.test(value)) fail('INVALID_INPUT', 'gid: expected nonzero 16 hex characters');
  return value.toLowerCase();
}
function urlValue(value: unknown, proxy = false): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || CONTROL_CHARS.test(value)) {
    fail('INVALID_INPUT', `${proxy ? 'proxy' : 'url'}: invalid URL`);
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { fail('INVALID_INPUT', `${proxy ? 'proxy' : 'url'}: invalid URL`); }
  if (!(proxy ? parsed.protocol === 'http:' : ['http:', 'https:'].includes(parsed.protocol))
    || !parsed.hostname || parsed.username || parsed.password
    || value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0]?.includes('@')
    || (proxy && (parsed.pathname !== '/' || parsed.search || parsed.hash))) {
    fail('INVALID_INPUT', `${proxy ? 'proxy' : 'url'}: disallowed scheme, credentials or proxy path`);
  }
  return value;
}
function downloadOptions(args: Aria2DownloadArgs, gid: string): Record<string, string> {
  fields(args, ['url', 'directory', 'filename', 'checksum', 'proxy'], 'download args');
  const options: Record<string, string> = { gid, 'allow-overwrite': 'false', 'auto-file-renaming': 'false' };
  if (args.directory !== undefined) {
    const dir = args.directory;
    if (typeof dir !== 'string' || CONTROL_CHARS.test(dir)
      || !(dir.startsWith('/') || /^[a-z]:[\\/]/i.test(dir) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(dir))) {
      fail('INVALID_INPUT', 'directory: expected aria2-side absolute POSIX, drive or UNC path');
    }
    options.dir = dir;
  }
  if (args.filename !== undefined) {
    const name = args.filename;
    if (typeof name !== 'string' || !name || name === '.' || name === '..'
      || /[\\/:]/.test(name) || CONTROL_CHARS.test(name)) {
      fail('INVALID_INPUT', 'filename: expected pure file name');
    }
    options.out = name;
  }
  if (args.checksum !== undefined) {
    const checksum = fields(args.checksum, ['algorithm', 'digest'], 'checksum');
    const algorithm = checksum.algorithm;
    if (algorithm !== 'sha-256' && algorithm !== 'sha-1' && algorithm !== 'md5') {
      fail('INVALID_INPUT', 'checksum.algorithm: expected sha-256, sha-1 or md5');
    }
    if (typeof checksum.digest !== 'string' || checksum.digest.length !== CHECKSUM_LENGTH[algorithm]
      || !/^[a-f0-9]+$/i.test(checksum.digest)) {
      fail('INVALID_INPUT', 'checksum.digest: invalid hex length or characters');
    }
    options.checksum = `${algorithm}=${checksum.digest.toLowerCase()}`;
    options['check-integrity'] = 'true';
  }
  if (args.proxy !== undefined) {
    const proxy = args.proxy === '' ? '' : urlValue(args.proxy, true);
    for (const key of ['all-proxy', 'http-proxy', 'https-proxy']) options[key] = proxy;
    for (const key of ['no-proxy', 'all-proxy-user', 'all-proxy-passwd', 'http-proxy-user',
      'http-proxy-passwd', 'https-proxy-user', 'https-proxy-passwd']) options[key] = '';
  }
  return options;
}

async function responseText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        fail('RESPONSE_TOO_LARGE', 'aria2 response exceeds 1 MiB');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length).toString('utf8');
}
function remoteString(value: unknown, decimal = false): string {
  if (typeof value !== 'string' || (decimal && !DECIMAL.test(value))) {
    fail('BAD_RESPONSE', 'aria2 returned invalid status fields');
  }
  return value;
}
function statusResult(value: unknown, gid: string): Aria2StatusResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BAD_RESPONSE', 'aria2 status is not an object');
  const r = value as Record<string, unknown>;
  if (r.gid !== gid || !STATUSES.includes(r.status as Aria2StatusResult['status']) || !Array.isArray(r.files)) {
    fail('BAD_RESPONSE', 'aria2 returned invalid status fields');
  }
  const totalBytes = remoteString(r.totalLength, true);
  const completedBytes = remoteString(r.completedLength, true);
  const errorCode = r.errorCode === undefined ? '0' : remoteString(r.errorCode, true);
  const total = BigInt(totalBytes);
  const completed = BigInt(completedBytes);
  const progress = total === 0n ? null : Number((completed > total ? total : completed) * 10000n / total) / 10000;
  return {
    gid, status: r.status as Aria2StatusResult['status'], totalBytes, completedBytes,
    downloadSpeed: remoteString(r.downloadSpeed, true), uploadSpeed: remoteString(r.uploadSpeed, true),
    connections: remoteString(r.connections, true), directory: remoteString(r.dir),
    files: r.files.slice(0, 20).map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('BAD_RESPONSE', 'aria2 returned invalid file fields');
      const f = entry as Record<string, unknown>;
      return { path: remoteString(f.path), length: remoteString(f.length, true),
        completedLength: remoteString(f.completedLength, true) };
    }),
    filesTruncated: r.files.length > 20, progress, errorCode,
    error: errorCode === '0' ? null : errorCode === '32' ? 'Checksum validation failed'
      : errorCode === '3' ? 'Resource not found' : errorCode === '9' ? 'Insufficient disk space'
      : errorCode === '13' ? 'File already exists' : 'Download failed',
  };
}
function taskSummary(status: Aria2StatusResult): Aria2TaskSummary {
  return {
    gid: status.gid, status: status.status, totalBytes: status.totalBytes, completedBytes: status.completedBytes,
    downloadSpeed: status.downloadSpeed, connections: status.connections, directory: status.directory,
    file: status.files[0]?.path ?? null, progress: status.progress, errorCode: status.errorCode, error: status.error,
  };
}
function listItem(value: unknown): Aria2StatusResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BAD_RESPONSE', 'aria2 returned an invalid task entry');
  const gid = (value as Record<string, unknown>).gid;
  return statusResult(value, gidValue(gid));
}
function listItems(value: unknown): Aria2StatusResult[] {
  if (!Array.isArray(value)) fail('BAD_RESPONSE', 'aria2 returned an invalid task list');
  return value.map(listItem);
}
function offsetValue(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    fail('INVALID_INPUT', 'offset: expected integer 0..1000000');
  }
  return value;
}

function mutationFailure<T>(error: unknown, data: T): Aria2MutateResult<T> {
  if (error instanceof Aria2Error && error.requestSent && error.code !== 'RPC_ERROR') {
    return { ...data, outcome: 'unknown_effect', code: 'UNKNOWN_EFFECT', reason: error.code };
  }
  throw error;
}

export function validateHost(host: unknown): string {
  if (typeof host !== 'string' || (!isIP(host) && (!DNS_NAME.test(host) || /^[0-9.]+$/.test(host))) || isIP(host) === 6) {
    fail('INVALID_INPUT', 'rpcHost: expected DNS name or IPv4 (no scheme, port, path or IPv6)');
  }
  // URL parsing must not reinterpret DNS-looking input as a legacy numeric IPv4 address.
  try {
    if (new URL(`http://${host}/`).hostname !== host.toLowerCase()) throw new Error();
  } catch { fail('INVALID_INPUT', 'rpcHost: unsupported DNS name or IPv4 spelling'); }
  return host;
}

export function createAria2Client(config: Aria2ClientConfig): Aria2Client {
  fields(config, ['rpcHost', 'rpcPort', 'secret', 'timeoutMs', 'signal'], 'config');
  const host = validateHost(config.rpcHost);
  const port = integer(config.rpcPort, 'rpcPort', 65535);
  const timeoutMs = config.timeoutMs === undefined ? 10000 : integer(config.timeoutMs, 'timeoutMs', 60000);
  if (config.secret !== undefined && (typeof config.secret !== 'string' || !config.secret)) {
    fail('INVALID_INPUT', 'secret: expected non-empty string');
  }
  const secret = config.secret;
  const clientSignal = lifecycle(config.signal);
  const endpoint = `http://${host}:${port}/jsonrpc`;

  function signalFor(opts?: { signal?: AbortSignal }): AbortSignal | undefined {
    if (opts === undefined) return undefined;
    return lifecycle(fields(opts, ['signal'], 'request options').signal);
  }
  async function rpc(method: string, params: unknown[], callSignal?: AbortSignal): Promise<unknown> {
    if (clientSignal?.aborted || callSignal?.aborted) fail('ABORTED', 'aria2 request aborted before sending');
    const id = randomUUID();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([timeout, ...[clientSignal, callSignal].filter((s): s is AbortSignal => !!s)]);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: secret === undefined ? params : [`token:${secret}`, ...params] }),
        redirect: 'manual', signal,
      });
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        fail('REDIRECT', 'aria2 endpoint redirect rejected');
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        fail('HTTP_ERROR', `aria2 endpoint returned HTTP ${response.status}`);
      }
      const text = await responseText(response);
      let payload: unknown;
      try { payload = JSON.parse(text); } catch { fail('BAD_RESPONSE', 'aria2 returned invalid JSON'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('BAD_RESPONSE', 'aria2 returned invalid JSON-RPC envelope');
      const p = payload as Record<string, unknown>;
      const hasResult = Object.hasOwn(p, 'result');
      const hasError = Object.hasOwn(p, 'error');
      if (p.jsonrpc !== '2.0' || p.id !== id || hasResult === hasError) fail('BAD_RESPONSE', 'aria2 returned invalid JSON-RPC envelope or id');
      if (hasError) {
        if (!p.error || typeof p.error !== 'object' || Array.isArray(p.error)
          || !Number.isInteger((p.error as Record<string, unknown>).code)
          || typeof (p.error as Record<string, unknown>).message !== 'string') {
          fail('BAD_RESPONSE', 'aria2 returned malformed RPC error');
        }
        fail('RPC_ERROR', 'aria2 rejected the request (task may not exist or RPC authorization failed)');
      }
      return p.result;
    } catch (error) {
      if (error instanceof Aria2Error) { error.requestSent = true; throw error; }
      const code = timeout.aborted ? 'TIMEOUT' : signal.aborted ? 'ABORTED' : 'NETWORK';
      throw new Aria2Error(code, `aria2 request ${code.toLowerCase()}`, true);
    }
  }
  return {
    async version(opts) {
      const result = await rpc('aria2.getVersion', [], signalFor(opts));
      const version = result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>).version : undefined;
      if (typeof version !== 'string' || !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$/.test(version) || version.length > 64) {
        fail('BAD_RESPONSE', 'aria2 returned invalid version information');
      }
      return { version };
    },
    async download(args, opts) {
      const gid = (() => { let value: string; do { value = randomBytes(8).toString('hex'); } while (!GID.test(value)); return value; })();
      const options = downloadOptions(args, gid);
      const url = urlValue(args.url);
      const signal = signalFor(opts);
      try {
        const result = await rpc('aria2.addUri', [[url], options], signal);
        if (result !== gid) throw new Aria2Error('BAD_RESPONSE', 'aria2 returned an unexpected download gid', true);
        return { outcome: 'ok', gid };
      } catch (error) { return mutationFailure(error, { gid }); }
    },
    async status(args, opts) {
      const gid = gidValue(fields(args, ['gid'], 'status args').gid);
      return statusResult(await rpc('aria2.tellStatus', [gid, STATUS_KEYS], signalFor(opts)), gid);
    },
    async list(args, opts) {
      const a = fields(args, ['state', 'limit', 'offset'], 'list args');
      const state = a.state === undefined ? 'all' : a.state;
      if (state !== 'active' && state !== 'waiting' && state !== 'stopped' && state !== 'all') {
        fail('INVALID_INPUT', 'state: expected active, waiting, stopped or all');
      }
      const limit = a.limit === undefined ? 20 : integer(a.limit, 'limit', 100);
      const offset = offsetValue(a.offset);
      const signal = signalFor(opts);
      const result: Aria2ListResult = { state, offset, limit };
      if (state === 'active' || state === 'all') {
        const active = listItems(await rpc('aria2.tellActive', [STATUS_KEYS], signal)).map(taskSummary);
        result.active = active.slice(offset, offset + limit);
      }
      if (state === 'waiting' || state === 'all') {
        result.waiting = listItems(await rpc('aria2.tellWaiting', [offset, limit, STATUS_KEYS], signal)).map(taskSummary);
      }
      if (state === 'stopped' || state === 'all') {
        result.stopped = listItems(await rpc('aria2.tellStopped', [offset, limit, STATUS_KEYS], signal)).map(taskSummary);
      }
      return result;
    },
    async control(args, opts) {
      const a = fields(args, ['gid', 'action'], 'control args');
      const gid = gidValue(a.gid);
      const action = a.action;
      if (action !== 'pause' && action !== 'resume' && action !== 'cancel') fail('INVALID_INPUT', 'action: expected pause, resume or cancel');
      const signal = signalFor(opts);
      try {
        const result = await rpc(METHODS[action], [gid], signal);
        if (result !== gid) throw new Aria2Error('BAD_RESPONSE', 'aria2 returned an unexpected control gid', true);
        return { outcome: 'ok', gid, action };
      } catch (error) { return mutationFailure(error, { gid, action }); }
    },
  };
}
