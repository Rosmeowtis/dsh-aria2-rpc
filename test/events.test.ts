import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAria2Notification, startAria2Events } from '../src/events.js';

test('parses only aria2 completion and error notifications', () => {
  const complete = JSON.stringify({ jsonrpc: '2.0', method: 'aria2.onDownloadComplete', params: [{ gid: '0123456789ABCDEF' }] });
  const failed = JSON.stringify({ jsonrpc: '2.0', method: 'aria2.onDownloadError', params: [{ gid: 'fedcba9876543210' }] });
  assert.deepEqual(parseAria2Notification(complete), { gid: '0123456789abcdef', failed: false });
  assert.deepEqual(parseAria2Notification(failed), { gid: 'fedcba9876543210', failed: true });
  for (const invalid of [
    '', 'not json', 'null', '[]', '{"jsonrpc":"2.0","method":"aria2.onDownloadComplete"}',
    '{"jsonrpc":"2.0","method":"aria2.onDownloadComplete","params":[]}',
    '{"jsonrpc":"2.0","method":"aria2.onDownloadComplete","params":[{"gid":"bad"}]}',
    '{"jsonrpc":"2.0","method":"aria2.onDownloadComplete","params":[{"gid":"0000000000000000"}]}',
    '{"jsonrpc":"2.0","method":"aria2.onDownloadStart","params":[{"gid":"0123456789abcdef"}]}',
    '{"method":"aria2.onDownloadComplete","params":[{"gid":"0123456789abcdef"}]}',
    '{"jsonrpc":"2.0","method":"aria2.onDownloadComplete","params":[null]}',
    'x'.repeat(4097),
  ]) assert.equal(parseAria2Notification(invalid), undefined);
});

test('listener forwards notices and stops on abort', () => {
  let socket: {
    close(): void; send(data: string): void; onopen: (() => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null; onclose: (() => void) | null; onerror: (() => void) | null;
  } | undefined;
  let url = '';
  let closed = false;
  let subscribed = '';
  const notices: unknown[] = [];
  const controller = new AbortController();
  startAria2Events({
    endpoint: () => ({ host: '127.0.0.1', port: 6800 }),
    onNotice: notice => notices.push(notice),
    signal: controller.signal,
    createSocket: (target) => {
      url = target;
      socket = {
        close: () => { closed = true; }, send: (data: string) => { subscribed = data; },
        onopen: null, onmessage: null, onclose: null, onerror: null,
      };
      return socket;
    },
  });
  assert.equal(url, 'ws://127.0.0.1:6800/jsonrpc');
  socket!.onopen!();
  assert.deepEqual(JSON.parse(subscribed), { jsonrpc: '2.0', id: 'aria2-rpc', method: 'system.listNotifications' });
  socket!.onmessage!({ data: JSON.stringify({ jsonrpc: '2.0', method: 'aria2.onDownloadComplete', params: [{ gid: '0123456789abcdef' }] }) });
  socket!.onmessage!({ data: 'ignored' });
  assert.deepEqual(notices, [{ gid: '0123456789abcdef', failed: false }]);
  controller.abort();
  assert.equal(closed, true);
});
