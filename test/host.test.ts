import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { apply, Config } from '../src/index.js';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

// Exercise the actual registered definitions without mounting or changing a profile.
function mount(mode = 'read-only', plan = false, config: Record<string, unknown> = {}) {
  const definitions = new Map<string, ToolDefinition>();
  let credentialAccesses = 0;
  const disposers: (() => void)[] = [];
  const agent = { id: 'test', session: {}, ctx: { get: () => ({ get: () => ({ active: plan }) }) } };
  const ctx = {
    fiber: {},
    inject: (keys: string[], callback: (ctx: unknown) => void) => {
      // The plugin stores its RPC secret in its own configuration, never in the credential store.
      assert.ok(!keys.includes('credentials'), 'the plugin must not inject the credential service');
      if (keys.includes('connection')) callback({
        effect: (fn: () => () => void) => { disposers.push(fn()); },
        connection: { fetch: { register: (route: { path: string; methods: string[]; fetch: (request: Request) => Promise<Response> }) => {
          assert.equal(route.path, '/api/aria2-rpc.test');
          assert.deepEqual(route.methods, ['POST']);
        } } },
      });
      if (keys.includes('settings')) callback({
        effect: (fn: () => () => void) => { disposers.push(fn()); },
        settings: { configure: () => () => {} },
      });
    },
    effect: (fn: () => () => void) => { disposers.push(fn()); },
    tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; } },
    agents: { get: () => agent },
    sandboxPolicy: { resolve: () => ({ mode }) },
  };
  Object.defineProperty(ctx, 'credentials', { get: () => { credentialAccesses++; throw new Error('credential store accessed'); } });
  apply(ctx as unknown as Context, Config(config));
  return { definitions, credentialAccesses: () => credentialAccesses, dispose: () => { for (const dispose of disposers.reverse()) dispose(); } };
}

const tellStatus = (gid: string) => ({
  jsonrpc: '2.0', result: {
    gid, status: 'active', totalLength: '10', completedLength: '5', downloadSpeed: '0', uploadSpeed: '0',
    connections: '1', dir: '/downloads', files: [], errorCode: '0',
  },
});

test('four exact tool names and lifecycle cleanup', () => {
  const plugin = mount();
  assert.deepEqual([...plugin.definitions.keys()], ['aria2_download', 'aria2_status', 'aria2_list', 'aria2_control']);
  for (const name of ['aria2_status', 'aria2_list']) assert.equal(plugin.definitions.get(name)?.isConcurrencySafe?.({}), true);
  assert.equal(plugin.definitions.get('aria2_download')?.isConcurrencySafe?.({}), undefined);
  plugin.dispose();
  assert.equal(plugin.definitions.size, 0);
});

test('read-only and plan mode block mutations before RPC', async () => {
  for (const [mode, plan] of [['read-only', false], ['workspace-write', false], ['danger-full-access', true]] as const) {
    const plugin = mount(mode, plan);
    for (const name of ['aria2_download', 'aria2_control']) {
      const result = await plugin.definitions.get(name)!.execute({}, { agent: { id: 'test' }, signal: new AbortController().signal } as never);
      assert.equal((result as { error: { code: string } }).error.code, 'PERMISSION_DENIED');
    }
    assert.equal(plugin.credentialAccesses(), 0);
    plugin.dispose();
  }
});

test('the configured secret is sent as the aria2 token and the credential store is never touched', async () => {
  const previous = globalThis.fetch;
  const calls: { params: unknown[]; method: string }[] = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(String(options?.body));
    calls.push({ params: payload.params, method: payload.method });
    return Response.json({ ...tellStatus('1234567890abcdef'), id: payload.id });
  };
  try {
    const withSecret = mount('danger-full-access', false, { rpcSecret: 'config-secret' });
    const status = await withSecret.definitions.get('aria2_status')!.execute({ gid: '1234567890abcdef' }, { signal: new AbortController().signal } as never);
    assert.equal((status as { ok: boolean }).ok, true);
    assert.deepEqual(calls[0], { method: 'aria2.tellStatus', params: ['token:config-secret', '1234567890abcdef', [
      'gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'dir', 'files', 'errorCode',
    ]] });
    assert.equal(withSecret.credentialAccesses(), 0);
    withSecret.dispose();

    const withoutSecret = mount('danger-full-access', false);
    await withoutSecret.definitions.get('aria2_status')!.execute({ gid: '1234567890abcdef' }, { signal: new AbortController().signal } as never);
    assert.deepEqual(calls[1].params.slice(0, 1), ['1234567890abcdef']);
    assert.equal(withoutSecret.credentialAccesses(), 0);
    withoutSecret.dispose();

    // An empty configured value means "no token", never an empty token.
    const emptySecret = mount('danger-full-access', false, { rpcSecret: '' });
    await emptySecret.definitions.get('aria2_status')!.execute({ gid: '1234567890abcdef' }, { signal: new AbortController().signal } as never);
    assert.deepEqual(calls[2].params.slice(0, 1), ['1234567890abcdef']);
    emptySecret.dispose();
  } finally { globalThis.fetch = previous; }
});

test('RPC failures are redacted, status and list remain available', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('private endpoint'); };
  try {
    const plugin = mount();
    for (const [name, args] of [['aria2_status', { gid: '1234567890abcdef' }], ['aria2_list', {}]] as const) {
      const result = await plugin.definitions.get(name)!.execute(args, { signal: new AbortController().signal } as never);
      assert.equal((result as { error: { code: string } }).error.code, 'NETWORK');
      assert.doesNotMatch(JSON.stringify(result), /private endpoint/);
    }
    assert.equal(plugin.credentialAccesses(), 0);
    plugin.dispose();
  } finally { globalThis.fetch = previous; }
});

test('cancelled mutation retains queryable gid in thrown tool failure', async () => {
  const plugin = mount('danger-full-access', false, { rpcSecret: 'config-secret' });
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { controller.abort(); throw new Error('private endpoint'); };
  try {
    await assert.rejects(plugin.definitions.get('aria2_download')!.execute({ url: 'https://example.com/file' }, { agent: { id: 'test' }, signal: controller.signal } as never), (error: unknown) => {
      assert.ok(error instanceof Error);
      const result = JSON.parse(error.message);
      assert.equal(result.code, 'UNKNOWN_EFFECT');
      assert.match(result.gid, /^[a-f0-9]{16}$/);
      assert.doesNotMatch(error.message, /private endpoint/);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; plugin.dispose(); }
});

test('settings schema roundtrip validates in browser without Node callback closures', () => {
  const wire = JSON.parse(JSON.stringify(Config.toJSON()));
  const browserSchema = new Schema(wire);
  // The secret is a write-only field: the browser receives the slot without a default.
  const root = wire.refs[String(wire.uid)];
  assert.equal(root.dict.rpcSecretRef, undefined);
  const secret = wire.refs[String(root.dict.rpcSecret)];
  assert.equal(secret.meta.role, 'secret');
  assert.equal(secret.meta.default, undefined);
  for (const rpcHost of ['127.0.0.1', 'aria2.example.com', 'localhost']) {
    const values = { rpcHost, rpcPort: 6800, rpcTimeoutMs: 10000 };
    assert.doesNotThrow(() => browserSchema(values));
    assert.doesNotThrow(() => browserSchema({ ...values, rpcSecret: 'secret' }));
  }
  assert.throws(() => browserSchema({ rpcHost: 'http://host/path' }));
  assert.throws(() => browserSchema({ rpcPort: 0 }));
});

test('Config rejects invalid ports and the retired credential reference', () => {
  for (const value of [{ rpcPort: 0 }, { rpcPort: 65536 }, { rpcPort: 2.5 }, { rpcHost: 'https://host/path' }, { rpcSecret: 5 }, { rpcSecret: 'x'.repeat(4097) }, { rpcTimeoutMs: 0 }]) {
    assert.throws(() => Config(value as never));
  }
});
