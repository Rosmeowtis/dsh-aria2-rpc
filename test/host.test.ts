import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
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
    inject: () => {},
    effect: (fn: () => () => void) => { disposers.push(fn()); },
    tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; } },
    agents: { get: () => agent },
    sandboxPolicy: { resolve: () => ({ mode }) },
    credentials: { resolve: async () => { rpcCalls++; if (credentialAvailable) return undefined; throw new Error('not configured'); } },
  };
  apply(ctx as unknown as Context, Config({}));
  return { definitions, rpcCalls: () => rpcCalls, dispose: () => { for (const dispose of disposers.reverse()) dispose(); } };
}

test('three exact tool names and lifecycle cleanup', () => {
  const plugin = mount();
  assert.deepEqual([...plugin.definitions.keys()], ['aria2_download', 'aria2_status', 'aria2_control']);
  assert.equal(plugin.definitions.get('aria2_status')?.isConcurrencySafe?.({}), true);
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

test('credential failures are redacted, status remains available', async () => {
  const plugin = mount();
  const result = await plugin.definitions.get('aria2_status')!.execute({ gid: '1234567890abcdef' }, { signal: new AbortController().signal } as never);
  assert.equal((result as { error: { code: string } }).error.code, 'CONFIG_OR_CREDENTIAL_ERROR');
  assert.equal(plugin.rpcCalls(), 1);
  assert.doesNotMatch(JSON.stringify(result), /not configured/);
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

test('Config rejects invalid ports and reference names', () => {
  for (const value of [{ rpcPort: 0 }, { rpcPort: 65536 }, { rpcPort: 2.5 }, { rpcHost: 'https://host/path' }, { rpcSecretRef: 'A-B' }, { rpcTimeoutMs: 0 }]) {
    assert.throws(() => Config(value));
  }
});
