import test from 'node:test';
import assert from 'node:assert/strict';
import { TransmissionRPC } from '../lib/rpc.js';

const ok = args => Response.json({ result: 'success', arguments: args });
test('negotiates and reuses the Transmission CSRF token without changing the operation', async () => {
  const requests = [];
  const client = new TransmissionRPC('/transmission/rpc', { fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    if (requests.length === 1) return new Response('', { status: 409, headers: { 'X-Transmission-Session-Id': 'token-1' } });
    return ok({ torrents: [] });
  } });
  await client.call('torrent-stop', { ids: [1] });
  await client.call('torrent-get', { fields: ['id'] });
  assert.equal(requests.length, 3);
  assert.equal(requests[1].headers['X-Transmission-Session-Id'], 'token-1');
  assert.equal(requests[2].headers['X-Transmission-Session-Id'], 'token-1');
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[1].credentials, 'same-origin');
  assert.equal(requests[1].mode, 'same-origin');
  assert.equal(requests[1].redirect, 'error');
  assert.deepEqual(JSON.parse(requests[1].body).arguments.ids, [1]);
});
test('recovers when Transmission rotates its session token', async () => {
  let count = 0;
  const client = new TransmissionRPC('/rpc', { fetchImpl: async (_, options) => {
    count++;
    if (options.headers['X-Transmission-Session-Id'] !== 'new') return new Response('', { status: 409, headers: { 'X-Transmission-Session-Id': 'new' } });
    return ok({ version: '4.0.6' });
  } });
  client.sessionId = 'old';
  assert.deepEqual(await client.call('session-get'), { version: '4.0.6' });
  assert.equal(count, 2);
});
test('bounds CSRF retries and reports a missing token', async () => {
  let count = 0;
  const client = new TransmissionRPC('/rpc', { fetchImpl: async () => { count++; return new Response('', { status: 409, headers: { 'X-Transmission-Session-Id': 'rotating' } }); } });
  await assert.rejects(client.call('session-get'), /согласовать сессию/);
  assert.equal(count, 3);
  const missing = new TransmissionRPC('/rpc', { fetchImpl: async () => new Response('', { status: 409 }) });
  await assert.rejects(missing.call('session-get'), /не передал/);
});
test('reports authentication, host whitelist, HTTP, invalid JSON, and RPC errors', async t => {
  for (const [response, expected] of [
    [new Response('', { status: 401 }), /авторизация/],
    [new Response('', { status: 403 }), /whitelist/],
    [new Response('', { status: 404 }), /HTTP 404/],
    [new Response('<html>login</html>'), /не похож/],
    [Response.json({ result: 'invalid or corrupt torrent file' }), /invalid or corrupt/],
  ]) await t.test(String(expected), async () => {
    const client = new TransmissionRPC('/rpc', { fetchImpl: async () => response });
    await assert.rejects(client.call('torrent-add'), expected);
  });
});
test('times out without automatically repeating a destructive operation', async () => {
  let calls = 0;
  const client = new TransmissionRPC('/rpc', { timeout: 10, fetchImpl: (_, { signal }) => new Promise((_, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }) });
  await assert.rejects(client.call('torrent-remove', { ids: [1], 'delete-local-data': true }), /не ответил/);
  assert.equal(calls, 1);
});
