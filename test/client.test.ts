import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('client bundle registers under the package name', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { name: string };
  const source = readFileSync(new URL('../../client.js', import.meta.url), 'utf8');
  // client-modules keys browser bundles by package name: a mismatched id makes the
  // loader re-execute the bundle and web boot fails with duplicate factory registration.
  assert.equal(/load\(\{\s*id:\s*'([^']+)'/.exec(source)?.[1], pkg.name);
  assert.ok(source.includes(`key: '${pkg.name}'`), 'plugins.bundle.config slot key must be the package name');
});
