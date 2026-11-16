import { Aria2Error, createAria2Client } from './rpc.js';

/** Called only behind DSH's authenticated Connection route; never persists drafts. */
export async function testConnection(request: Request, loadSecret: () => string | undefined, lifetime: AbortSignal): Promise<Response> {
  const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      throw new Aria2Error('INVALID_INPUT', 'Expected application/json');
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > 8192) throw new Aria2Error('INVALID_INPUT', 'Connection settings too large');
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new Aria2Error('INVALID_INPUT', 'Invalid JSON'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Aria2Error('INVALID_INPUT', 'Expected connection settings');
    const data = input as Record<string, unknown>;
    if (Object.keys(data).some(key => !['rpcHost', 'rpcPort', 'rpcTimeoutMs', 'rpcSecret'].includes(key))) {
      throw new Aria2Error('INVALID_INPUT', 'Unknown connection setting');
    }
    if (data.rpcSecret !== undefined && (typeof data.rpcSecret !== 'string' || !data.rpcSecret || data.rpcSecret.length > 4096)) {
      throw new Aria2Error('INVALID_INPUT', 'Invalid secret');
    }
    const config = { rpcHost: data.rpcHost as string, rpcPort: data.rpcPort as number, timeoutMs: data.rpcTimeoutMs as number, signal: AbortSignal.any([request.signal, lifetime]) };
    // Validate host/port/timeouts before reading the stored secret or sending anything.
    createAria2Client(config);
    const secret = (data.rpcSecret as string | undefined) ?? loadSecret();
    const result = await createAria2Client({ ...config, secret }).version();
    return respond({ ok: true, ...result });
  } catch (error) {
    return respond({ ok: false, code: error instanceof Aria2Error ? error.code : 'CONFIG_ERROR' }, error instanceof Aria2Error && error.code === 'INVALID_INPUT' ? 400 : 200);
  }
}
