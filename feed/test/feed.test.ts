import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderFeed, renderWithoutRecords, type ReplayData } from '../src/render.ts';
import { catalogue, NOW, W1, W2 } from './fixtures.ts';

const replay = JSON.parse(readFileSync(new URL('../../replay/output.json', import.meta.url), 'utf8')) as ReplayData;
// Safe{Wallet} is a product name, not a claim.
const BANNED = /\b(safe(?!\{Wallet\})|hacked|secure|verified|protected|trusted|malicious|attack)\b/i;
const XSS = '<img src=x onerror=alert(1)>';
const feed = (c = catalogue()) => renderFeed({ catalogue: c, replay, now: NOW });
/** The Bybit region is third-party evidence, so it alone is out of scope for the word check. */
const noEvidence = (h: string) => h.replace(/<pre class="region replay-region"[\s\S]*?<\/pre>/, '');

test('sections are in order and Runs on is gone', () => {
  const h = feed();
  const at = ['id="witnesses"', 'id="sites"', 'id="changes"', 'id="replay"'].map(s => h.indexOf(s));
  assert.ok(at.every((v, i) => v > -1 && (i === 0 || v > at[i - 1]!)), String(at));
  assert.ok(!h.includes('Runs on'));
});

test('witnesses show roster values and real ages', () => {
  const h = feed();
  assert.match(h, /w1\.secondwitness\.eth/);
  assert.ok(h.includes(`data-copy="${W1}"`) && h.includes(`data-copy="${W2}"`));
  assert.match(h, /<td class="feed-right num">4 minutes ago<\/td>/);
});

test('sites count files across witnesses and need two for a version', () => {
  const h = feed();
  const swap = h.match(/<tr><td class="mono"[^>]*>swap\.cow\.fi<\/td>.*?<\/tr>/)![0];
  assert.match(swap, />3<\/td>/, 'one file seen by one witness does not count, and two change records do');
  assert.match(swap, /2 of 2/);
  assert.match(swap, /1 minute ago/);
  const lone = h.match(/<tr><td class="mono"[^>]*>revoke\.cash<\/td>.*?<\/tr>/)![0];
  assert.match(lone, />0<\/td>/);
  assert.match(lone, /0 of 2/);
  assert.match(lone, /None yet/);
});

test('changed groups records and handles a null region', () => {
  const h = feed();
  assert.match(h, /Witnessed region, 62 characters/);
  assert.match(h, /<mark>0x96221423681a6d52e184d440a8efcebb105c7242<\/mark>/);
  assert.equal(h.split('Witnesses kept no changed region for this file.').length - 1, 1);
  assert.equal(h.split('data-copy="/assets/app-3f91c2ab7d104e66.js"').length - 1, 1, 'two witnesses, one event');
  assert.match(h, /48,210 bytes/);
});

test('records from unlisted wallets are not shown', () => {
  const c = catalogue();
  c.changes[0]!.witness = '0xunlisted';
  c.changes[1]!.witness = '0xunlisted';
  assert.ok(!feed(c).includes('app-3f91c2ab7d104e66'));
});

test('a site id the code no longer lists is not shown', () => {
  const c = catalogue();
  c.observations.push({ ...c.observations[0]!, site: 'retired-demo' });
  c.changes.push({ ...c.changes[0]!, site: 'retired-demo' });
  assert.doesNotMatch(feed(c), /retired-demo/);
});

test('a site reads as its host, not its internal id', () => {
  const c = catalogue();
  c.observations.push({ ...c.observations[0]!, site: 'demo-2' });
  c.changes.push({ ...c.changes[0]!, site: 'demo-2' });
  const h = feed(c);
  assert.match(h, /<tr><td class="mono"[^>]*>second-witness.vercel.app<\/td>/);
  assert.match(h, /<span class="mono">second-witness.vercel.app<\/span>/);
  assert.doesNotMatch(h, /demo-2/);
});

test('replay uses real values in true time order', () => {
  const h = feed();
  const body = h.slice(h.indexOf('id="replay"'));
  const dates = [...body.matchAll(/<td class="num">(\d+ \w+ 2025, \d\d:\d\d)<\/td>/g)].map(m => m[1]!);
  assert.deepEqual(dates, ['14 Feb 2025, 13:06', '14 Feb 2025, 19:07', '17 Feb 2025, 02:49', '19 Feb 2025, 11:19', '19 Feb 2025, 17:29', '21 Feb 2025, 14:13', '22 Feb 2025, 02:26', '22 Feb 2025, 17:55']);
  assert.match(body, /<strong>Theft transaction\.<\/strong> 44\.7 hours after the altered capture\./);
  assert.ok(body.includes("Don't sign"), 'the replay shows what a tab would read');
  assert.match(feed(), /What witnesses recorded for each site\./);
  assert.doesNotMatch(feed(), /independent witnesses|finding about who made it|does not show the theft would have been stopped/);
  assert.equal(body.split('class="replay-altered"').length - 1, 1);
  assert.equal(body.split('data-result="matches"').length - 1, 10, 'five rows, five axis signs');
  assert.equal(body.split('data-result="changed"').length - 1, 4, 'two rows, two axis signs');
  assert.ok(body.includes(`data-copy="${replay.path}"`));
});

test('the region is the one core computed', () => {
  const h = feed();
  assert.match(h, /Changed region: 8,845 characters, with net growth of 1,994 bytes\./);
  assert.ok(!/first place|second place|two (separate )?insertions/i.test(h));
  assert.equal(h.split('<pre class="region replay-region"').length - 1, 1);
  const pre = h.match(/<pre class="region replay-region"[^>]*>([\s\S]*?)<\/pre>/)![1]!;
  for (const a of replay.asNewRelease.added.addrs) assert.equal(pre.split(`<mark>${a}</mark>`).length - 1, 2, a);
  assert.doesNotMatch(pre.replace(/<\/?mark>/g, ''), /</);
  const decoded = pre.replace(/<\/?mark>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.equal(decoded, replay.evidence.region);
});

test('the replay says when the alert would have fired', () => {
  assert.match(feed(), /This shows when the alert would have fired: 44\.7 hours before the theft\./);
});

test('hostile records render as text', () => {
  const c = catalogue();
  c.roster[0]!.label = XSS;
  c.observations[0]!.site = XSS;
  c.changes[0]!.site = XSS;
  c.changes[0]!.path = `/${XSS}`;
  c.changes[0]!.oldHash = XSS;
  c.changes[0]!.region = XSS;
  c.changes[1]!.path = `/${XSS}`;
  c.changes[1]!.oldHash = XSS;
  c.changes[1]!.site = XSS;
  const hostileReplay: ReplayData = { ...replay, path: `/${XSS}`, evidence: { ...replay.evidence, region: `${XSS}${replay.asNewRelease.added.addrs[0]}${XSS}` } };
  const h = renderFeed({ catalogue: c, replay: hostileReplay, now: NOW });
  assert.doesNotMatch(h, /<img/i);
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(h, /&gt;<mark>0x[0-9a-f]{40}<\/mark>&lt;img/);
  assert.doesNotMatch(renderWithoutRecords(hostileReplay, XSS), /<img/i);
});

test('without records the replay still renders under one plain line', () => {
  const h = renderWithoutRecords(replay, "Witness records couldn't be read right now.");
  assert.ok(h.includes('Witness records couldn&#39;t be read right now.'));
  assert.ok(h.includes('id="replay"'));
  assert.ok(!h.includes('id="witnesses"'));
});

test('long values stay whole in the HTML', () => {
  const c = catalogue();
  const long = `/${'a'.repeat(300)}/${'b'.repeat(300)}.js`;
  c.changes[2]!.path = long;
  const h = feed(c);
  assert.ok(h.includes(`data-copy="${long}"`));
  const m = h.match(/<span class="value-head">(\/a{300}[^<]*)<\/span><span class="value-tail">([^<]*)<\/span>/)!;
  assert.equal(m[1]! + m[2]!, long);
});

test('no third-party requests in the page', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/feed.css', import.meta.url), 'utf8');
  assert.doesNotMatch(page + css, /https?:\/\//);
});

test('banned words appear nowhere outside the Bybit evidence region', () => {
  assert.doesNotMatch(noEvidence(feed()), BANNED);
  assert.doesNotMatch(noEvidence(renderWithoutRecords(replay, 'line')), BANNED);
  for (const f of ['src/render.ts', 'src/main.ts', 'index.html']) {
    assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), BANNED, f);
  }
});
