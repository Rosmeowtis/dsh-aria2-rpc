import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { Aria2Error, createAria2Client } from './rpc.js';

/** Called only behind DSH's authenticated Connection route; never persists drafts. */
export async function testConnection(request: Request, resolveSecret: (ref: string) => Promise<string | undefined>, lifetime: AbortSignal): Promise<Response> {
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
    if (Object.keys(data).some(key => !['rpcHost', 'rpcPort', 'rpcTimeoutMs', 'rpcSecretRef', 'secret'].includes(key))) {
      throw new Aria2Error('INVALID_INPUT', 'Unknown connection setting');
    }
    if (typeof data.rpcSecretRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(data.rpcSecretRef)) {
      throw new Aria2Error('INVALID_INPUT', 'Invalid credential reference');
    }
    if (data.secret !== undefined && (typeof data.secret !== 'string' || !data.secret || data.secret.length > 4096)) {
      throw new Aria2Error('INVALID_INPUT', 'Invalid secret');
    }
    const config = { rpcHost: data.rpcHost as string, rpcPort: data.rpcPort as number, timeoutMs: data.rpcTimeoutMs as number, signal: AbortSignal.any([request.signal, lifetime]) };
    // Validate host/port/timeouts before accessing a credential or sending anything.
    createAria2Client(config);
    const secret = data.secret as string | undefined ?? await resolveSecret(credentialRef(data.rpcSecretRef));
    const result = await createAria2Client({ ...config, secret }).version();
    return respond({ ok: true, ...result });
  } catch (error) {
    return respond({ ok: false, code: error instanceof Aria2Error ? error.code : 'CREDENTIAL_ERROR' }, error instanceof Aria2Error && error.code === 'INVALID_INPUT' ? 400 : 200);
  }
}
