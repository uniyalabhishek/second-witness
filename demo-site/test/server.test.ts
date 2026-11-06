import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
// @ts-expect-error plain JS module
import { createDemoServer, APP_PATH, RELEASE_PATH, RECIPIENT, OTHER } from '../server.mjs';

let server: Server;
let base: string;
before(async () => {
  server = createDemoServer({ key: 'k' }).server;
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

const post = (path: string, body = '', cookie = '') =>
  fetch(base + path, { method: 'POST', body, redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } });

test('without the cookie, the app file is clean and immutable', async () => {
  const r = await fetch(base + APP_PATH);
  assert.match(r.headers.get('content-type')!, /javascript/);
  assert.match(r.headers.get('cache-control')!, /immutable/);
  assert.match(r.headers.get('cache-control')!, /private/); // Per-cookie code must never sit in a shared cache.
  const t = await r.text();
  assert.ok(t.includes(RECIPIENT));
  assert.ok(!t.includes(OTHER));
});

test('with the cookie, the same path serves altered code', async () => {
  const cookie = (await post('/control/target')).headers.get('set-cookie')!.split(';')[0]!;
  const t = await (await fetch(base + APP_PATH, { headers: { cookie } })).text();
  assert.ok(t.includes(OTHER));
  assert.ok(!t.includes(RECIPIENT));
});

test('cleaning clears the cookie, and the page keeps one external script so Matches is reachable', async () => {
  assert.match((await post('/control/clean')).headers.get('set-cookie')!, /Max-Age=0/);
  const html = await (await fetch(base + '/')).text();
  assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map(m => m[0]), [`<script src="${APP_PATH}">`]);
});

test('publishing needs the key, then everyone gets the renamed file, then rollback restores', async () => {
  assert.equal((await post('/control/release', 'key=wrong')).status, 403);
  assert.ok((await (await fetch(base + '/')).text()).includes(APP_PATH));
  assert.equal((await post('/control/release', 'key=k')).status, 303);
  assert.ok((await (await fetch(base + '/')).text()).includes(RELEASE_PATH));
  assert.ok((await (await fetch(base + RELEASE_PATH)).text()).includes(OTHER));
  await post('/control/rollback', 'key=k');
  assert.ok((await (await fetch(base + '/')).text()).includes(APP_PATH));
});

test('an oversized form is refused and the server stays up', async () => {
  const r = await post('/control/release', 'k'.repeat(2048));
  assert.equal(r.status, 400);
  assert.equal((await fetch(base + '/')).status, 200);
});
