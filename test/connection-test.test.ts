import test from 'node:test';
import assert from 'node:assert/strict';
import { testConnection } from '../src/connection-test.js';

const settings = { rpcHost: 'aria2.example.com', rpcPort: 6800, rpcTimeoutMs: 1000, rpcSecretRef: 'ARIA2_RPC_SECRET' };
const request = (data: unknown) => new Request('http://localhost/api/aria2-rpc.test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
});

test('connection test uses draft settings and secret without creating a download or saving', async () => {
  const previous = globalThis.fetch;
  const calls: { endpoint: string; params: unknown[]; method: string }[] = [];
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(String(options?.body));
    calls.push({ endpoint: String(url), params: payload.params, method: payload.method });
    return Response.json({ jsonrpc: '2.0', id: payload.id, result: { version: '1.37.0', enabledFeatures: ['HTTPS'] } });
  };
  let credentialReads = 0;
  const read = async () => { credentialReads++; return 'stored-secret'; };
  try {
    const response = await testConnection(request({ ...settings, rpcPort: 16800, secret: 'draft-secret' }), read, new AbortController().signal);
    assert.deepEqual(await response.json(), { ok: true, version: '1.37.0' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(credentialReads, 0);
    assert.deepEqual(calls[0], { endpoint: 'http://aria2.example.com:16800/jsonrpc', method: 'aria2.getVersion', params: ['token:draft-secret'] });
    await testConnection(request(settings), read, new AbortController().signal);
    assert.equal(credentialReads, 1);
    assert.deepEqual(calls[1].params, ['token:stored-secret']);
    await testConnection(request(settings), async () => undefined, new AbortController().signal);
    assert.deepEqual(calls[2].params, []);
    assert.ok(calls.every(call => call.method === 'aria2.getVersion'));
  } finally { globalThis.fetch = previous; }
});

test('connection test validates inputs before reading credentials or sending requests', async () => {
  let reads = 0;
  for (const input of [null, [], { ...settings, rpcHost: 'http://host/path' }, { ...settings, rpcPort: 0 }, { ...settings, rpcSecretRef: 'A-B' }, { ...settings, secret: 3 }, { ...settings, method: 'aria2.shutdown' }, { ...settings, rpcHost: 'x'.repeat(9000) }]) {
    const response = await testConnection(request(input), async () => { reads++; return undefined; }, new AbortController().signal);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: 'INVALID_INPUT' });
  }
  assert.equal(reads, 0);
});

test('connection test returns only safe failure codes for RPC, credentials and malformed replies', async () => {
  const previous = globalThis.fetch;
  try {
    for (const mode of ['rpc', 'network', 'version', 'credential']) {
      globalThis.fetch = async (_url, options) => {
        if (mode === 'network') throw new Error('private-host secret');
        const payload = JSON.parse(String(options?.body));
        return Response.json({ jsonrpc: '2.0', id: payload.id, ...(mode === 'rpc' ? { error: { code: 1, message: 'private-host secret' } } : { result: { version: 'secret\naddress' } }) });
      };
      const response = await testConnection(request(settings), async () => { if (mode === 'credential') throw new Error('secret'); return undefined; }, new AbortController().signal);
      const result = await response.json();
      assert.deepEqual(result, { ok: false, code: { rpc: 'RPC_ERROR', network: 'NETWORK', version: 'BAD_RESPONSE', credential: 'CREDENTIAL_ERROR' }[mode] });
      assert.doesNotMatch(JSON.stringify(result), /secret|private-host/);
    }
  } finally { globalThis.fetch = previous; }
});
