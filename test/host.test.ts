import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { apply, Config } from '../src/index.js';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

// Exercise the actual registered definitions without mounting or changing a profile.
function mount(mode = 'read-only', plan = false, credentialAvailable = false) {
  const definitions = new Map<string, ToolDefinition>();
  let rpcCalls = 0;
  const disposers: (() => void)[] = [];
  const agent = { id: 'test', session: {}, ctx: { get: () => ({ get: () => ({ active: plan }) }) } };
  const ctx = {
    fiber: {},
    inject: (keys: string[], callback: (ctx: unknown) => void) => {
      if (keys.includes('connection')) callback({
        effect: (fn: () => () => void) => { disposers.push(fn()); },
        connection: { fetch: { register: (route: { path: string; methods: string[]; fetch: (request: Request) => Promise<Response> }) => {
          assert.equal(route.path, '/api/aria2-rpc.test');
          assert.deepEqual(route.methods, ['POST']);
        } } },
      });
    },
    effect: (fn: () => () => void) => { disposers.push(fn()); },
    tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; } },
    agents: { get: () => agent },
    sandboxPolicy: { resolve: () => ({ mode }) },
    credentials: { resolve: async () => { rpcCalls++; if (credentialAvailable) return undefined; throw new Error('not configured'); } },
  };
  apply(ctx as unknown as Context, Config({}));
  return { definitions, rpcCalls: () => rpcCalls, dispose: () => { for (const dispose of disposers.reverse()) dispose(); } };
}

test('four exact tool names and lifecycle cleanup', () => {
  const plugin = mount();
  assert.deepEqual([...plugin.definitions.keys()], ['aria2_download', 'aria2_status', 'aria2_list', 'aria2_control']);
  for (const name of ['aria2_status', 'aria2_list']) assert.equal(plugin.definitions.get(name)?.isConcurrencySafe?.({}), true);
  assert.equal(plugin.definitions.get('aria2_download')?.isConcurrencySafe?.({}), undefined);
  plugin.dispose();
  assert.equal(plugin.definitions.size, 0);
});

test('read-only and plan mode block mutations before credentials or RPC', async () => {
  for (const [mode, plan] of [['read-only', false], ['workspace-write', false], ['danger-full-access', true]] as const) {
    const plugin = mount(mode, plan);
    for (const name of ['aria2_download', 'aria2_control']) {
      const result = await plugin.definitions.get(name)!.execute({}, { agent: { id: 'test' }, signal: new AbortController().signal } as never);
      assert.equal((result as { error: { code: string } }).error.code, 'PERMISSION_DENIED');
    }
    assert.equal(plugin.rpcCalls(), 0);
    plugin.dispose();
  }
});

test('credential failures are redacted, status and list remain available', async () => {
  const plugin = mount();
  for (const [name, args] of [['aria2_status', { gid: '1234567890abcdef' }], ['aria2_list', {}]] as const) {
    const result = await plugin.definitions.get(name)!.execute(args, { signal: new AbortController().signal } as never);
    assert.equal((result as { error: { code: string } }).error.code, 'CONFIG_OR_CREDENTIAL_ERROR');
    assert.doesNotMatch(JSON.stringify(result), /not configured/);
  }
  assert.equal(plugin.rpcCalls(), 2);
  plugin.dispose();
});

test('cancelled mutation retains queryable gid in thrown tool failure', async () => {
  const plugin = mount('danger-full-access', false, true);
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
  for (const rpcHost of ['127.0.0.1', 'aria2.example.com', 'localhost']) {
    const values = { rpcHost, rpcPort: 6800, rpcSecretRef: 'ARIA2_RPC_SECRET', rpcTimeoutMs: 10000 };
    assert.doesNotThrow(() => browserSchema(values));
  }
  assert.throws(() => browserSchema({ rpcHost: 'http://host/path' }));
  assert.throws(() => browserSchema({ rpcPort: 0 }));
});

test('Config rejects invalid ports and reference names', () => {
  for (const value of [{ rpcPort: 0 }, { rpcPort: 65536 }, { rpcPort: 2.5 }, { rpcHost: 'https://host/path' }, { rpcSecretRef: 'A-B' }, { rpcTimeoutMs: 0 }]) {
    assert.throws(() => Config(value));
  }
});
