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

test('refs: a webpack chunk map with named chunks, as Aave ships it', () => {
  const js = `c.u=e=>"static/chunks/"+(({4299:"9d008a28",5724:"datadogRecorder"})[e]||e)+"."+({11:"8e516a837047fdb7",4299:"56b92f6be25b7ed8",5724:"1d6ebbfdbf858c6d"})[e]+".js"`;
  const refs = refsFromJs(js, 'https://s.example/_next/x.js', 'https://s.example');
  assert.ok(refs.includes('https://s.example/_next/static/chunks/11.8e516a837047fdb7.js'));
  assert.ok(refs.includes('https://s.example/_next/static/chunks/9d008a28.56b92f6be25b7ed8.js'));
  assert.ok(refs.includes('https://s.example/_next/static/chunks/datadogRecorder.1d6ebbfdbf858c6d.js'));
});

test('refs: a bare path in a script can be relative to the file or to the root, as Vite ships it', () => {
  const refs = refsFromJs(`__vite__mapDeps=["assets/Row-DwcB3nrZ.js"]`, 'https://s.example/assets/main.js', 'https://s.example');
  assert.ok(refs.includes('https://s.example/assets/Row-DwcB3nrZ.js'));
  assert.ok(refs.includes('https://s.example/assets/assets/Row-DwcB3nrZ.js'));
});

test('refs: Next chunks follow the base path of the file naming them', () => {
  const js = `d.u=e=>"static/chunks/"+e+"."+{557:"7b79f63051ed8817"}[e]+".js"`;
  const refs = refsFromJs(js, 'https://s.example/homepage/_next/static/chunks/webpack-1.js', 'https://s.example');
  assert.ok(refs.includes('https://s.example/homepage/_next/static/chunks/557.7b79f63051ed8817.js'));
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

test('plan: bodies split under the entity limit, with additions on every part so a tab holding any file sees them', () => {
  const crawled = Array.from({ length: 4000 }, (_, i) => ({ path: `/c/${String(i).padStart(40, '0')}.js`, hash: A, body: `"${ADDR2}"` }));
  const { obs } = planWrites(input({ crawled }));
  assert.ok(obs.length > 1);
  for (const o of obs) assert.ok(new TextEncoder().encode(JSON.stringify(o)).length <= 128 * 1024);
  assert.equal(obs.reduce((n, o) => n + o.files.length, 0), 4000);
  assert.deepEqual(obs[0]!.added.addrs, [ADDR2]);
  assert.deepEqual(obs[1]!.added.addrs, [ADDR2]);
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

test('crawl: follows scripts onto a second origin the site lists, and resolves their paths there', async () => {
  const listen = async (handler: Parameters<typeof createServer>[1]) => {
    const s = createServer(handler);
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    return { s, url: `http://127.0.0.1:${(s.address() as { port: number }).port}` };
  };
  const cdn = await listen((req, res) => {
    if (req.url === '/entry.js') res.writeHead(200, js).end('import("/chunk.js")');
    else if (req.url === '/chunk.js') res.writeHead(200, js).end('let c=1');
    else res.writeHead(404).end();
  });
  const app = await listen((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<script src="${cdn.url}/entry.js"></script>`));
  const r = await crawl({ ...fixture(), origins: [app.url, cdn.url], seeds: [] });
  app.s.close();
  cdn.s.close();
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map(f => f.path).sort(), [`/${new URL(cdn.url).host}/chunk.js`, `/${new URL(cdn.url).host}/entry.js`]);
});

test('crawl: records a path the way the browser reads it, however the URL was escaped', async () => {
  const app = createServer((req, res) => {
    if (req.url === '/') res.writeHead(200, { 'content-type': 'text/html' }).end('<script src="/c/%5Bmode%5D-1.js"></script>');
    else res.writeHead(200, js).end('let c=1');
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const r = await crawl({ ...fixture(), origins: [`http://127.0.0.1:${(app.address() as { port: number }).port}`], seeds: [] });
  app.close();
  assert.deepEqual(r.files.map(f => f.path), ['/c/[mode]-1.js']);
});

test('crawl: waits out a rate limit instead of dropping the file', async () => {
  let limited = false;
  const app = createServer((req, res) => {
    if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<script src="/a.js"></script>');
    if (!limited) {
      limited = true;
      return res.writeHead(429, { 'retry-after': '1' }).end();
    }
    res.writeHead(200, js).end('let a=1');
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const r = await crawl({ ...fixture(), origins: [`http://127.0.0.1:${(app.address() as { port: number }).port}`], seeds: [] });
  app.close();
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map(f => f.path), ['/a.js']);
});

test('crawl: follows a script list in the page itself, without counting it as reaching the site', async () => {
  const page = `<script>var f=["assets\\u002fRow-DwcB3nrZ.js"]</script>`;
  const app = createServer((req, res) => {
    if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
    res.writeHead(req.url === '/assets/Row-DwcB3nrZ.js' ? 200 : 404, js).end('let r=1');
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const r = await crawl({ ...fixture(), origins: [`http://127.0.0.1:${(app.address() as { port: number }).port}`], seeds: [] });
  app.close();
  assert.equal(r.ok, false);
  assert.deepEqual(r.files.map(f => f.path), ['/assets/Row-DwcB3nrZ.js']);
});

const serve = async (handler: Parameters<typeof createServer>[1]) => {
  const s = createServer(handler);
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  return { s, url: `http://127.0.0.1:${(s.address() as { port: number }).port}` };
};
const html = { 'content-type': 'text/html' };

test('crawl: the same path on two origins is two files', async () => {
  const cdn = await serve((_req, res) => res.writeHead(200, js).end('let cdn=1'));
  const app = await serve((req, res) => {
    if (req.url === '/') res.writeHead(200, html).end(`<script src="/x.js"></script><script src="${cdn.url}/x.js"></script>`);
    else res.writeHead(200, js).end('let app=1');
  });
  const r = await crawl({ ...fixture(), origins: [app.url, cdn.url], seeds: [] });
  app.s.close();
  cdn.s.close();
  assert.equal(r.files.length, 2);
  assert.ok(r.files.some(f => f.path === '/x.js'));
  assert.ok(r.files.some(f => f.path === `/${new URL(cdn.url).host}/x.js`));
});

test('crawl: running out of time is reached but not complete', async () => {
  const names = Array.from({ length: 13 }, (_, i) => `<script src="/${i}.js"></script>`).join('');
  const app = await serve((req, res) => {
    if (req.url === '/') return res.writeHead(200, html).end(names);
    setTimeout(() => res.writeHead(200, js).end('let s=1'), 200);
  });
  const r = await crawl({ ...fixture(), origins: [app.url], seeds: [] }, 100);
  app.s.close();
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
  assert.equal(r.files.length, 12);
});

test('crawl: a finished crawl is complete', async () => {
  const r = await crawl(fixture());
  assert.equal(r.complete, true);
});

test('crawl: a wait longer than the time left ends at once, and is not complete', async () => {
  let scripts = 0;
  const app = await serve((req, res) => {
    if (req.url === '/') return res.writeHead(200, html).end('<script src="/a.js"></script><script src="/b.js"></script>');
    if (req.url === '/a.js') return res.writeHead(200, js).end('let a=1');
    scripts++;
    res.writeHead(429, { 'retry-after': '60' }).end();
  });
  const started = Date.now();
  const r = await crawl({ ...fixture(), origins: [app.url], seeds: [] }, 3000);
  app.s.close();
  assert.ok(Date.now() - started < 2000);
  assert.equal(scripts, 1);
  assert.equal(r.complete, false);
});

test('crawl: fetches a script once when the page names it twice', async () => {
  let hits = 0;
  const app = await serve((req, res) => {
    if (req.url === '/') return res.writeHead(200, html).end('<script src="/a.js"></script><script>load("/a.js")</script>');
    hits++;
    res.writeHead(200, js).end('let a=1');
  });
  await crawl({ ...fixture(), origins: [app.url], seeds: [] });
  app.s.close();
  assert.equal(hits, 1);
});

test('crawl: an unreachable site is not ok and does not throw', async () => {
  const r = await crawl({ ...fixture(), origins: ['http://127.0.0.1:9'] });
  assert.deepEqual(r, { ok: false, complete: false, files: [], failed: 0 });
});
