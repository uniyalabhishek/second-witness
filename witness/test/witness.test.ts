import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { crawl, refsFromHtml, refsFromJs } from '../src/crawl.ts';
import { planWrites, type PlanInput } from '../src/plan.ts';
import { hashCode } from '../../core/src/hash.ts';
import type { Site } from '../../core/src/types.ts';

const IMMUTABLE = /-[0-9a-f]{16}\.js$/;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ADDR = '0x1111111111111111111111111111111111111111';
const ADDR2 = '0x2222222222222222222222222222222222222222';
const path = '/c/app-0123456789abcdef.js';

const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  crawled: [{ path, hash: A, body: `x="${ADDR}"` }],
  known: new Map(),
  cachedSurface: { addrs: [], hosts: [] },
  cachedBody: () => null,
  immutable: IMMUTABLE,
  ...o,
});

test('refs: script tags, preloads, and relative paths resolve', () => {
  const html = '<script src="/a.js"></script><script defer src="b.js?x=1"></script><link rel="preload" href="/c.js" as="script">';
  assert.deepEqual(refsFromHtml(html, 'https://s.example/p/'), ['https://s.example/a.js', 'https://s.example/p/b.js?x=1', 'https://s.example/c.js']);
});

test('refs: Next manifests and webpack chunk maps', () => {
  const js = `self.__M={a:["static/chunks/one-0123456789abcdef.js"]};d.u=e=>"static/chunks/"+e+"."+{123:"abcdef0123456789",456:"fedcba9876543210"}[e]+".js"`;
  const refs = refsFromJs(js, 'https://s.example/_next/x.js', 'https://s.example');
  assert.ok(refs.includes('https://s.example/_next/static/chunks/one-0123456789abcdef.js'));
  assert.ok(refs.includes('https://s.example/_next/static/chunks/123.abcdef0123456789.js'));
  assert.ok(refs.includes('https://s.example/_next/static/chunks/456.fedcba9876543210.js'));
});

test('plan: nothing new writes nothing', () => {
  assert.deepEqual(planWrites(input({ known: new Map([[path, [A]]]) })), { obs: [], changes: [] });
});

test('plan: an empty cache is a baseline with no additions', () => {
  const { obs } = planWrites(input({ cachedSurface: null }));
  assert.deepEqual(obs[0]!.added, { addrs: [], hosts: [] });
  assert.deepEqual(obs[0]!.files, [[path, A]]);
});

test('plan: a new file naming a new address reports it', () => {
  const { obs, changes } = planWrites(input({ crawled: [{ path, hash: A, body: `"${ADDR}" "${ADDR2}" "https://new.example/x"` }], cachedSurface: { addrs: [ADDR], hosts: [] } }));
  assert.deepEqual(obs[0]!.added, { addrs: [ADDR2], hosts: ['new.example'] });
  assert.deepEqual(obs[0]!.totals, { addrs: 1, hosts: 1 });
  assert.deepEqual(changes, []);
});

test('plan: additions cap at 50 per kind and keep the true total', () => {
  const body = Array.from({ length: 60 }, (_, i) => `"0x${String(i).padStart(40, '0')}"`).join();
  const { obs } = planWrites(input({ crawled: [{ path, hash: A, body }] }));
  assert.equal(obs[0]!.added.addrs.length, 50);
  assert.equal(obs[0]!.totals.addrs, 60);
});

test('plan: a fixed-name file with a new hash records the changed region', () => {
  const { changes } = planWrites(input({ crawled: [{ path, hash: B, body: 'aaaXXbbb' }], known: new Map([[path, [A]]]), cachedBody: h => (h === A ? 'aaabbb' : null) }));
  assert.deepEqual(changes, [{ old: A, new: B, body: { path, sizes: [6, 8], region: 'XX', offset: 3 } }]);
});

test('plan: with the old file gone, the change keeps both hashes and no region', () => {
  const { changes } = planWrites(input({ crawled: [{ path, hash: B, body: 'new' }], known: new Map([[path, [A]]]) }));
  assert.equal(changes[0]!.body.region, null);
  assert.equal(changes[0]!.body.offset, null);
});

test('plan: a new version at a non-fixed path is not a change', () => {
  const { obs, changes } = planWrites(input({ crawled: [{ path: '/sw.js', hash: B, body: '' }], known: new Map([['/sw.js', [A]]]) }));
  assert.equal(obs[0]!.files.length, 1);
  assert.deepEqual(changes, []);
});

test('plan: bodies split under the entity limit, with additions only on the first', () => {
  const crawled = Array.from({ length: 4000 }, (_, i) => ({ path: `/c/${String(i).padStart(40, '0')}.js`, hash: A, body: `"${ADDR2}"` }));
  const { obs } = planWrites(input({ crawled }));
  assert.ok(obs.length > 1);
  for (const o of obs) assert.ok(new TextEncoder().encode(JSON.stringify(o)).length <= 128 * 1024);
  assert.equal(obs.reduce((n, o) => n + o.files.length, 0), 4000);
  assert.deepEqual(obs[0]!.added.addrs, [ADDR2]);
  assert.deepEqual(obs[1]!.added.addrs, []);
});

let server: Server;
let origin: string;
const js = { 'content-type': 'text/javascript' };
const routes: Record<string, [Record<string, string>, string, number?]> = {
  '/': [{ 'content-type': 'text/html' }, '<script src="/a.js"></script><script src="/fallback.js"></script><script src="/missing.js"></script>'],
  '/a.js': [js, '﻿import("/b.js"); fetch("https://other.example/c.js")'],
  '/b.js': [js, 'let b=1'],
  '/fallback.js': [{ 'content-type': 'text/html' }, '<!doctype html>'],
  '/seed.js': [js, 'let s=1'],
};

before(async () => {
  server = createServer((req, res) => {
    const route = routes[req.url ?? ''];
    if (!route) return res.writeHead(404).end();
    res.writeHead(route[2] ?? 200, route[0]).end(route[1]);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

const fixture = (): Site => ({ id: 'fixture', origins: [origin], immutable: 'x', thirdParty: [], seeds: ['/seed.js'] });

test('crawl: follows references and seeds, stays on one origin, ignores HTML at a JS path and 404s', async () => {
  const r = await crawl(fixture());
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map(f => f.path).sort(), ['/a.js', '/b.js', '/seed.js']);
});

test('crawl: hashes decoded text, dropping a BOM as the browser does', async () => {
  const r = await crawl(fixture());
  const a = r.files.find(f => f.path === '/a.js')!;
  assert.equal(a.body.charCodeAt(0), 'i'.charCodeAt(0));
  assert.equal(a.hash, await hashCode(a.body));
});

test('crawl: a home page with no scripts is not ok, even when a seed loads', async () => {
  const challenge = createServer((req, res) => {
    if (req.url === '/sw.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end('1');
    else res.writeHead(200, { 'content-type': 'text/html' }).end('<p>One moment.</p>');
  });
  await new Promise<void>(r => challenge.listen(0, '127.0.0.1', r));
  const r = await crawl({ ...fixture(), origins: [`http://127.0.0.1:${(challenge.address() as { port: number }).port}`], seeds: ['/sw.js'] });
  challenge.close();
  assert.equal(r.ok, false);
});

test('crawl: a site can name the page to start from', async () => {
  const shop = createServer((req, res) => {
    if (req.url === '/app') res.writeHead(200, { 'content-type': 'text/html' }).end('<script src="/a.js"></script>');
    else if (req.url === '/a.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end('1');
    else res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Welcome.</p>');
  });
  await new Promise<void>(r => shop.listen(0, '127.0.0.1', r));
  const r = await crawl({ ...fixture(), origins: [`http://127.0.0.1:${(shop.address() as { port: number }).port}`], seeds: [], home: '/app' });
  shop.close();
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map(f => f.path), ['/a.js']);
});

test('crawl: an unreachable site is not ok and does not throw', async () => {
  const r = await crawl({ ...fixture(), origins: ['http://127.0.0.1:9'] });
  assert.deepEqual(r, { ok: false, files: [], failed: 0 });
});
