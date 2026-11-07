import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { Aria2Error, createAria2Client, validateHost } from '../src/rpc.js';
import type { Aria2ClientConfig, Aria2DownloadArgs, Aria2ControlArgs, Aria2StatusArgs } from '../src/rpc.js';

const GID = '0123456789abcdef';
type Request = { id: string; jsonrpc: string; method: string; params: unknown[] };
const validStatus = () => ({
  gid: GID, status: 'active', totalLength: '100', completedLength: '25',
  downloadSpeed: '10', uploadSpeed: '0', connections: '2', dir: '/remote/downloads',
  files: [{ path: '/remote/downloads/file', length: '100', completedLength: '25', uris: [{ uri: 'https://secret.invalid' }] }],
});
const reply = (res: ServerResponse, request: Request, result: unknown) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
};
async function mock(t: TestContext, handler: (request: Request, res: ServerResponse) => void,
  config: Partial<Aria2ClientConfig> = {}) {
  const requests: Request[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/jsonrpc');
    assert.match(req.headers['content-type'] ?? '', /application\/json/);
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request = JSON.parse(Buffer.concat(chunks).toString()) as Request;
      requests.push(request);
      handler(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((err) => err ? reject(err) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { requests, client: createAria2Client({ rpcHost: '127.0.0.1', rpcPort: address.port, ...config }) };
}
const isCode = (code: string) => (error: unknown) => error instanceof Aria2Error && error.code === code;

test('host and configuration validation: DNS/IPv4 only, exact integer bounds, no unknown fields', () => {
  for (const host of ['localhost', 'aria2.example.com', 'aria2.example.com.', '127.0.0.1']) assert.equal(validateHost(host), host);
  for (const host of ['', 'http://localhost', 'host/path', 'a_b', '-bad', 'bad-.com', '127.1', '256.0.0.1', '01.2.3.4', '0x7f000001', '0x7f.0.0.1', 'example.123', '::1', '[::1]', 'host:80', 'user@host']) {
    assert.throws(() => validateHost(host), isCode('INVALID_INPUT'), host);
  }
  for (const config of [
    { rpcPort: 0 }, { rpcPort: 65536 }, { rpcPort: 1.5 }, { rpcPort: '80' },
    { timeoutMs: 0 }, { timeoutMs: 60001 }, { timeoutMs: 1.5 }, { secret: '' },
    { scheme: 'https' }, { signal: {} },
  ]) {
    assert.throws(() => createAria2Client({ rpcHost: 'localhost', rpcPort: 6800, ...config } as Aria2ClientConfig), isCode('INVALID_INPUT'));
  }
  createAria2Client({ rpcHost: 'localhost', rpcPort: 1, timeoutMs: 1 });
  createAria2Client({ rpcHost: 'localhost', rpcPort: 65535, timeoutMs: 60000 });
});

test('download: optional names, secret parameter, random gid and safe options without checksum/proxy', async (t) => {
  const { client, requests } = await mock(t, (req, res) => {
    assert.equal(req.params[0], 'token:top-secret');
    const options = req.params[2] as Record<string, string>;
    reply(res, req, options.gid);
  }, { secret: 'top-secret' });
  const a = await client.download({ url: 'https://example.com/file' });
  const b = await client.download({ url: 'http://example.com/file' });
  assert.equal(a.outcome, 'ok');
  assert.match(a.gid, /^(?!0{16}$)[a-f0-9]{16}$/);
  assert.notEqual(a.gid, b.gid);
  assert.equal(requests[0].jsonrpc, '2.0');
  assert.equal(requests[0].method, 'aria2.addUri');
  assert.deepEqual(requests[0].params[1], ['https://example.com/file']);
  assert.deepEqual(requests[0].params[2], { gid: a.gid, 'allow-overwrite': 'false', 'auto-file-renaming': 'false' });
});

test('remote absolute directories, checksum algorithms and proxy inheritance overrides', async (t) => {
  const { client, requests } = await mock(t, (req, res) => reply(res, req, (req.params[1] as Record<string, string>).gid));
  const cases = [
    { directory: '/not/a/local/path', algorithm: 'sha-256', size: 64, proxy: undefined },
    { directory: 'Z:\\remote\\files', algorithm: 'sha-1', size: 40, proxy: '' },
    { directory: '\\\\aria2\\share\\files', algorithm: 'md5', size: 32, proxy: 'http://proxy.example:8080' },
  ] as const;
  for (const c of cases) {
    await client.download({ url: 'https://example.com', directory: c.directory, filename: 'my-file.bin',
      checksum: { algorithm: c.algorithm, digest: 'A'.repeat(c.size) }, proxy: c.proxy });
    const options = requests.at(-1)!.params[1] as Record<string, string>;
    assert.equal(options.dir, c.directory);
    assert.equal(options.out, 'my-file.bin');
    assert.equal(options.checksum, `${c.algorithm}=${'a'.repeat(c.size)}`);
    assert.equal(options['check-integrity'], 'true');
    if (c.proxy === undefined) assert.equal('all-proxy' in options, false);
    else {
      for (const key of ['all-proxy', 'http-proxy', 'https-proxy']) assert.equal(options[key], c.proxy);
      for (const key of ['no-proxy', 'all-proxy-user', 'all-proxy-passwd', 'http-proxy-user', 'http-proxy-passwd', 'https-proxy-user', 'https-proxy-passwd']) {
        assert.equal(options[key], '');
      }
    }
  }
});

test('invalid args reject before request: urls, paths, hashes, proxies and unknown options', async (t) => {
  const { client, requests } = await mock(t, () => assert.fail('invalid args reached HTTP'));
  const invalid = [
    { url: 'ftp://example.com' }, { url: 'https://user:pass@example.com' }, { url: 'https://@example.com' },
    { url: 'https://example.com\n' }, { url: '' }, { url: 'not-url' },
    { directory: 'relative/path' }, { directory: 'C:relative' }, { directory: '\\relative' }, { directory: '/bad\0path' },
    { filename: '../file' }, { filename: 'dir\\file' }, { filename: '..' }, { filename: '.' }, { filename: '' },
    { filename: 'C:file' }, { filename: 'bad\nname' },
    { checksum: { algorithm: 'sha256', digest: 'a'.repeat(64) } },
    { checksum: { algorithm: 'sha-256', digest: 'a'.repeat(63) } },
    { checksum: { algorithm: 'md5', digest: 'g'.repeat(32) } },
    { checksum: { algorithm: 'sha-1', digest: 'a'.repeat(40), trusted: true } },
    { proxy: 'https://proxy' }, { proxy: 'socks5://proxy' }, { proxy: 'http://user:pass@proxy' },
    { proxy: 'http://proxy/path' }, { proxy: 'http://proxy?key=secret' },
    { options: { 'allow-overwrite': 'true' } }, { gid: GID },
  ];
  for (const args of invalid) await assert.rejects(client.download({ url: 'https://example.com', ...args } as Aria2DownloadArgs), isCode('INVALID_INPUT'));
  await assert.rejects(client.status({ gid: GID, extra: 'secret' } as Aria2StatusArgs), isCode('INVALID_INPUT'));
  for (const action of ['forcePause', 'shutdown', 'toString']) {
    await assert.rejects(client.control({ gid: GID, action } as Aria2ControlArgs), isCode('INVALID_INPUT'));
  }
  for (const gid of ['0'.repeat(16), 'bad', 123]) await assert.rejects(client.status({ gid } as Aria2StatusArgs), isCode('INVALID_INPUT'));
  assert.equal(requests.length, 0);
});

test('tellStatus crops fields/files, preserves big integer byte strings and never asserts verified', async (t) => {
  const { client, requests } = await mock(t, (req, res) => reply(res, req, {
    ...validStatus(), totalLength: '18014398509481986', completedLength: '9007199254740993',
    files: Array.from({ length: 21 }, () => validStatus().files[0]),
    errorCode: '32', errorMessage: 'https://secret.invalid/path token:top-secret', extra: 'secret',
  }));
  const status = await client.status({ gid: GID.toUpperCase() });
  assert.deepEqual(requests[0].params, [GID, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'dir', 'files', 'errorCode']]);
  assert.equal(requests[0].method, 'aria2.tellStatus');
  assert.equal(status.totalBytes, '18014398509481986');
  assert.equal(status.completedBytes, '9007199254740993');
  assert.equal(status.progress, 0.5);
  assert.equal(status.files.length, 20);
  assert.equal(status.filesTruncated, true);
  assert.deepEqual(Object.keys(status.files[0]), ['path', 'length', 'completedLength']);
  assert.equal(status.errorCode, '32');
  assert.equal(status.error, 'Checksum validation failed');
  assert.equal('verified' in status, false);
  assert.doesNotMatch(JSON.stringify(status), /secret|https:/);
});

test('unknown progress, status shapes and fixed unknown-error summary', async (t) => {
  let result: unknown = { ...validStatus(), totalLength: '0', errorCode: '999', errorMessage: 'SECRET' };
  const { client } = await mock(t, (req, res) => reply(res, req, result));
  const status = await client.status({ gid: GID });
  assert.equal(status.progress, null);
  assert.equal(status.error, 'Download failed');
  for (const invalid of [null, [], { ...validStatus(), totalLength: 1 }, { ...validStatus(), downloadSpeed: '-1' },
    { ...validStatus(), gid: 'ffffffffffffffff' }, { ...validStatus(), status: 'verified' },
    { ...validStatus(), files: [{ path: '/file', length: 'bad', completedLength: '0' }] },
    { ...validStatus(), errorCode: 'SECRET' }]) {
    result = invalid;
    await assert.rejects(client.status({ gid: GID }), isCode('BAD_RESPONSE'));
  }
});

test('list reads active/waiting/stopped with compact summaries, paging and secret', async (t) => {
  const seen: { method: string; params: unknown[] }[] = [];
  const { client } = await mock(t, (req, res) => {
    seen.push({ method: req.method, params: req.params });
    const base = validStatus();
    if (req.method === 'aria2.tellActive') reply(res, req, [
      { ...base, gid: '0123456789abcdef' },
      { ...base, gid: '1123456789abcdef' },
    ]);
    else reply(res, req, [{ ...base, gid: '2123456789abcdef', status: 'complete' }]);
  }, { secret: 'top-secret' });

  const all = await client.list({ limit: 1, offset: 1 });
  assert.equal(all.state, 'all');
  assert.equal(all.limit, 1);
  assert.equal(all.offset, 1);
  assert.deepEqual(all.active?.map(task => task.gid), ['1123456789abcdef']);
  assert.deepEqual(all.waiting?.map(task => task.gid), ['2123456789abcdef']);
  assert.deepEqual(all.stopped?.map(task => task.status), ['complete']);
  assert.equal(all.waiting?.[0].file, '/remote/downloads/file');
  assert.equal('files' in all.waiting![0], false);
  assert.deepEqual(seen.map(entry => entry.method), ['aria2.tellActive', 'aria2.tellWaiting', 'aria2.tellStopped']);
  for (const entry of seen) assert.equal(entry.params[0], 'token:top-secret');
  assert.ok(Array.isArray(seen[0].params[1]));
  assert.deepEqual(seen[1].params.slice(1, 3), [1, 1]);
  assert.deepEqual(seen[2].params.slice(1, 3), [1, 1]);

  const waiting = await client.list({ state: 'waiting', limit: 5, offset: 0 });
  assert.equal(waiting.active, undefined);
  assert.equal(waiting.stopped, undefined);
  assert.deepEqual(waiting.waiting?.map(task => task.gid), ['2123456789abcdef']);

  for (const args of [{ state: 'bad' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 1.5 }, { offset: 1000001 }, { extra: 1 }]) {
    await assert.rejects(client.list(args as never), isCode('INVALID_INPUT'), JSON.stringify(args));
  }
});

test('control maps only pause/unpause/remove, returns queryable gid and never forces or deletes', async (t) => {
  const { client, requests } = await mock(t, (req, res) => reply(res, req, GID));
  for (const action of ['pause', 'resume', 'cancel'] as const) {
    assert.deepEqual(await client.control({ gid: GID, action }), { outcome: 'ok', gid: GID, action });
  }
  assert.deepEqual(requests.map((r) => r.method), ['aria2.pause', 'aria2.unpause', 'aria2.remove']);
  for (const request of requests) assert.deepEqual(request.params, [GID]);
});

test('explicit RPC errors (including unknown gid) are safe and not unknown-effect', async (t) => {
  const { client } = await mock(t, (req, res) => {
    res.end(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: 1, message: 'SECRET https://user:pass@example.com?q=TOKEN' } }));
  }, { secret: 'TOKEN' });
  for (const promise of [client.status({ gid: GID }), client.download({ url: 'https://example.com' }), client.control({ gid: GID, action: 'pause' })]) {
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Aria2Error);
      assert.equal(error.code, 'RPC_ERROR');
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /SECRET|TOKEN|user:pass|https:/);
      assert.equal('cause' in error, false);
      return true;
    });
  }
});

test('bad id/envelope/result, redirect, HTTP error and streamed oversize preserve mutation gid', async (t) => {
  let mode = '';
  let redirects = 0;
  const { client, requests } = await mock(t, (req, res) => {
    if (mode === 'oversize') { res.write(' '.repeat(600000)); res.end(' '.repeat(600000)); }
    else if (mode === 'redirect') { redirects++; res.writeHead(302, { location: '/jsonrpc' }); res.end(); }
    else if (mode === 'http') { res.writeHead(500); res.end('SECRET'); }
    else if (mode === 'id') res.end(JSON.stringify({ jsonrpc: '2.0', id: 123, result: GID }));
    else if (mode === 'json') res.end('not json SECRET');
    else if (mode === 'envelope') res.end(JSON.stringify({ id: req.id, result: GID }));
    else if (mode === 'both') res.end(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: GID, error: { code: 1, message: 'secret' } }));
    else reply(res, req, { unexpected: 'SECRET' });
  });
  for (const [name, code] of [['oversize', 'RESPONSE_TOO_LARGE'], ['redirect', 'REDIRECT'], ['http', 'HTTP_ERROR'],
    ['id', 'BAD_RESPONSE'], ['json', 'BAD_RESPONSE'], ['envelope', 'BAD_RESPONSE'], ['both', 'BAD_RESPONSE'], ['result', 'BAD_RESPONSE']]) {
    mode = name;
    const download = await client.download({ url: 'https://example.com' });
    assert.equal(download.outcome, 'unknown_effect');
    if (download.outcome === 'unknown_effect') { assert.equal(download.code, 'UNKNOWN_EFFECT'); assert.equal(download.reason, code); }
    assert.equal(download.gid, (requests.at(-1)!.params[1] as Record<string, string>).gid);
    const control = await client.control({ gid: GID, action: 'cancel' });
    assert.equal(control.outcome, 'unknown_effect');
    assert.equal(control.gid, GID);
    await assert.rejects(client.status({ gid: GID }), isCode(code));
  }
  assert.equal(redirects, 3); // no redirect following, no automatic retry
  assert.equal(requests.length, 24);
});

test('timeout, lifecycle abort, pre-abort and socket failure are bounded and never leak raw errors', async (t) => {
  const { client, requests } = await mock(t, () => {}, { timeoutMs: 40 });
  const download = await client.download({ url: 'https://example.com' });
  assert.equal(download.outcome, 'unknown_effect');
  if (download.outcome === 'unknown_effect') assert.equal(download.reason, 'TIMEOUT');
  await assert.rejects(client.status({ gid: GID }), isCode('TIMEOUT'));
  assert.equal(requests.length, 2);
  const abort = new AbortController();
  const other = await mock(t, () => abort.abort(new Error('SECRET URL https://private.invalid')), { signal: abort.signal });
  const control = await other.client.control({ gid: GID, action: 'pause' });
  assert.deepEqual(control, { gid: GID, action: 'pause', outcome: 'unknown_effect', code: 'UNKNOWN_EFFECT', reason: 'ABORTED' });
  await assert.rejects(other.client.control({ gid: GID, action: 'pause' }), isCode('ABORTED'));
  assert.equal(other.requests.length, 1);
  const perCall = new AbortController();
  perCall.abort();
  await assert.rejects(client.download({ url: 'https://example.com' }, { signal: perCall.signal }), isCode('ABORTED'));
  assert.equal(requests.length, 2);
  const broken = await mock(t, (_req, res) => res.destroy(new Error('SECRET')));
  const unknown = await broken.client.download({ url: 'https://example.com' });
  assert.equal(unknown.outcome, 'unknown_effect');
  if (unknown.outcome === 'unknown_effect') assert.equal(unknown.reason, 'NETWORK');
  assert.doesNotMatch(JSON.stringify(unknown), /SECRET|https:/);
});

test('body-stream timeout is classified and per-call abort applies after dispatch', async (t) => {
  const streaming = await mock(t, (_req, res) => { res.writeHead(200); res.write('{'); }, { timeoutMs: 100 });
  const download = await streaming.client.download({ url: 'https://example.com' });
  assert.equal(download.outcome, 'unknown_effect');
  if (download.outcome === 'unknown_effect') assert.equal(download.reason, 'TIMEOUT');
  await assert.rejects(streaming.client.status({ gid: GID }), isCode('TIMEOUT'));
  const controller = new AbortController();
  const aborting = await mock(t, () => controller.abort(new Error('SECRET')));
  const result = await aborting.client.download({ url: 'https://example.com' }, { signal: controller.signal });
  assert.equal(result.outcome, 'unknown_effect');
  if (result.outcome === 'unknown_effect') assert.equal(result.reason, 'ABORTED');
  assert.equal(aborting.requests.length, 1);
});
