import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
// @ts-expect-error plain JS module
import { createDemoServer, APP_PATH, RECIPIENT, OTHER } from '../server.mjs';

let server: Server;
let base: string;
before(async () => {
  server = createDemoServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

const post = (path: string) => fetch(base + path, { method: 'POST', redirect: 'manual' });

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

test('the home page says what this is, links out and runs no script', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /a button you press before you sign/);
  assert.doesNotMatch(html, /<script/);
  for (const href of ['/demo', '/extension', 'https://github.com/uniyalabhishek/second-witness']) assert.ok(html.includes(`href="${href}"`), href);
  assert.doesNotMatch(html, /\.zip/); // Clicking Extension must not start a download.
});

test('the extension page explains the install and only then offers the zip', async () => {
  const html = await (await fetch(base + '/extension')).text();
  for (const step of ['chrome://extensions', 'Developer mode', 'Load unpacked', 'href="/second-witness-extension.zip"', 'href="/demo"']) assert.ok(html.includes(step), step);
  assert.doesNotMatch(html, /<script/);
});

test('the demo page has one external script, so Same code is reachable, and its own controls', async () => {
  const html = await (await fetch(base + '/demo')).text();
  assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map(m => m[0]), [`<script src="${APP_PATH}">`]);
  assert.match(html, /A fake payment page\. Altered code changes the recipient\./);
  for (const action of ['/control/target', '/control/clean', '/control/refetch']) assert.ok(html.includes(`action="${action}"`), action);
});

test('each control returns to the demo, and cleaning clears the cookie', async () => {
  const clean = await post('/control/clean');
  assert.match(clean.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal(clean.headers.get('location'), '/demo');
  assert.equal((await post('/control/target')).headers.get('location'), '/refresh');
  assert.match(await (await fetch(base + '/refresh')).text(), /location\.replace\('\/demo'\)/);
});
