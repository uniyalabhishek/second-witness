import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { age, ago, esc } from '../src/format.ts';
import { render, renderUnavailable } from '../src/render.ts';
import type { ResultKind } from '../../core/src/types.ts';
import { A1, A2, FILE, NOW, TAB_HASH, WIT_HASH, allStates, attached, evidence, release, verdict } from './fixtures.ts';

// Safe{Wallet} is a product name, not a claim.
const BANNED = /\b(safe(?!\{Wallet\})|hacked|secure|verified|protected|trusted|malicious|attack)\b/i;
const XSS = '<img src=x onerror=alert(1)>';
const html = (name: string) => render(allStates()[name]!, NOW);
const text = (h: string) => h.replace(/<[^>]*>/g, '');

test('ago and age at unit boundaries, with singulars', () => {
  const cases: [number, string][] = [
    [0, '0 seconds'], [1, '1 second'], [12, '12 seconds'], [59, '59 seconds'],
    [60, '1 minute'], [119, '1 minute'], [120, '2 minutes'], [3599, '59 minutes'],
    [3600, '1 hour'], [7199, '1 hour'], [86399, '23 hours'],
    [86400, '1 day'], [172799, '1 day'], [259200, '3 days'],
  ];
  for (const [s, want] of cases) {
    assert.equal(ago(s), `${want} ago`);
    assert.equal(age(s), `${want} old`);
  }
  assert.equal(ago(-5), '0 seconds ago');
  assert.equal(ago(12.9), '12 seconds ago');
});

test('esc covers all five HTML characters', () => {
  assert.equal(esc(`<a href="x" id='y'>&`), '&lt;a href=&quot;x&quot; id=&#39;y&#39;&gt;&amp;');
});

const SIGNS: Record<ResultKind, [string, string]> = {
  matches: ['=', 'Same code'], changed: ['≠', "Don't sign"], notSeen: ['?', 'Not seen'],
  newRelease: ['+', 'New release'], partial: ['≈', 'Partial'], cantCheck: ['∅', "Can't check"],
};

test('every result renders with its word and sign', () => {
  const byName: Record<string, ResultKind> = {
    matches: 'matches', 'changed, tab differs': 'changed', 'not seen': 'notSeen',
    'new release': 'newRelease', 'partial, uncompared': 'partial', "can't check, stale": 'cantCheck',
  };
  for (const [name, kind] of Object.entries(byName)) {
    const [sign, word] = SIGNS[kind];
    assert.match(html(name), new RegExp(`<h1 class="result-head"><span class="result-sign" aria-hidden="true">${sign.replace(/[?+]/, '\\$&')}</span><span>${word}</span></h1>`), name);
  }
});

test('every reason renders its copy', () => {
  assert.match(html("can't check, not listed"), /isn't on the witness list/);
  assert.match(html("can't check, stale"), /need to be under 1 hour old/);
  assert.match(html("can't check, roster"), /can't be read right now/);
  assert.match(html("can't check, roster"), /data-copy="secondwitness\.eth"/);
  assert.match(html("can't check, no records"), /haven't reached this browser/);
  for (const name of ["can't check, stale", "can't check, roster", "can't check, no records"]) assert.match(html(name), /data-action="finish"/);
});

test('idle states', () => {
  assert.match(html('idle'), /Check before signing/);
  assert.match(html('idle'), /Check the code in this tab against what everyone else got\./);
  assert.match(html('idle'), /Witness records updated 6 minutes ago\./);
  assert.match(html('idle, records unread'), /have not been read yet/);
  const after = html('idle, after Finish');
  assert.match(text(after), /Last check: =Matches, 4 minutes ago\. Code loaded since then was not compared\./);
  const unlisted = html('idle, unlisted');
  assert.match(unlisted, /Can't check/);
  assert.match(unlisted, /The debugger was not attached\./);
  assert.doesNotMatch(unlisted, /<button/);
});

test('checking shows real counts', () => {
  const h = html('checking');
  assert.match(h, /Hashing 31 of 54 scripts/);
  assert.match(h, /Started 1 second ago\./);
  assert.match(h, /data-action="finish"/);
});

test('real values appear', () => {
  const m = render(attached(verdict({ witnessCount: 3, newestFileAgeSeconds: 7200, filesCompared: 41 })), NOW);
  assert.match(m, /This tab is running what everyone else got\. Newest file 2 hours old\./);
  assert.match(m, /41 files from 56 scripts/);
  assert.match(m, /Updated 12 seconds ago\./);
  assert.doesNotMatch(m, /compares code only|says nothing about/);

  assert.doesNotMatch(m, /browser extension/);
  assert.match(html('matches, with a wallet installed'), /2 from browser extensions, not compared\./);
  assert.match(html('matches, with one extension script'), /1 from a browser extension, not compared\./);
  // An unpacked popup is read from disk on open, while the worker can still be an older build.
  const olderWorker = { ...verdict() } as Partial<ReturnType<typeof verdict>>;
  delete olderWorker.extensionScripts;
  assert.doesNotMatch(render(attached(olderWorker as ReturnType<typeof verdict>), NOW), /NaN/);

  // Witnesses never record another host, so the wait-a-few-minutes line would be false for one.
  const notSeen = (over: Parameters<typeof verdict>[0]) => text(render(attached(verdict({ result: 'notSeen', ...over })), NOW));
  const files = notSeen({ notSeen: ['/a.js'] });
  assert.match(files, /^.*Don't sign yet\. Two witnesses have not recorded this code\. New files usually clear within 30 minutes\. This updates on its own, no reload needed\./);
  const oneHost = notSeen({ unknownHosts: ['a.example'] });
  assert.match(oneHost, /A script here comes from a host not on this site's list\. Check it before signing\. Witnesses only record the site's own files, so this stays until the list is updated\./);
  assert.doesNotMatch(oneHost, /clear within|no reload/);
  assert.match(notSeen({ unknownHosts: ['a.example', 'b.example'] }), /Scripts here come from 2 hosts not on this site's list\. Check them before signing\./);
  const both = notSeen({ notSeen: ['/a.js'], unknownHosts: ['a.example'] });
  assert.match(both, /Don't sign yet\..*New files usually clear within 30 minutes\. A host not on this site's list stays until the list is updated\./);
  assert.doesNotMatch(both, /no reload/);

  const c = html('changed, tab differs');
  assert.match(c, /data-copy="\/_next\/static\/chunks\/pages\/_app-52c9031bfa03da47\.js"/);
  assert.ok(c.includes(TAB_HASH.slice(0, 24)) && c.includes(WIT_HASH.slice(-8)));
  assert.match(c, /This tab is running different code from what everyone else got\./);
  assert.match(c, /Tell the other signers\. Check again from another device\./);
  assert.doesNotMatch(c, /who made it/);
  assert.match(c, /1,994 bytes larger in this tab/);
  assert.match(c, /block 4,218,077/);
  assert.match(c, /<pre class="region popup-region"/);

  const two = html('changed, two versions, no region');
  assert.match(two, /This file's name promises fixed content, and this tab is running a changed version\./);
  assert.match(two, /Witnesses kept no changed region for this file\./);
  assert.doesNotMatch(two, /<pre/);

  const orig = html('changed, tab holds the original');
  assert.match(orig, /This file's name promises fixed content, and witnesses recorded a changed version in the last 72 hours\. This tab has the original, but the site has served different code\./);

  const p = html('partial, uncompared');
  assert.match(p, /14 files match 2 witnesses\. Other code is running here/);
  for (const s of ['13 inline scripts', '2 eval scripts', '1 WebAssembly module', '1 frame or worker', 'Scripts from 2 listed hosts', 'www.googletagmanager.com']) assert.ok(p.includes(s), s);
  assert.match(html('partial, witnesses behind'), /Fewer than 2 witnesses checked this site in the last hour\./);
  assert.doesNotMatch(html('matches'), /Before/);
});

test('release lists URL addresses first, then the rest, then totals', () => {
  const h = html('new release');
  const url = h.indexOf("Added, and in this tab's URL");
  const also = h.indexOf('Also added, 13 addresses');
  assert.ok(url > -1 && also > url);
  assert.ok(h.indexOf(A1) > url && h.indexOf(A1) < also);
  assert.ok(h.indexOf(A2) > also);
  assert.match(h, /and 12 more/);
  assert.match(h, /Added, 1 host/);
  assert.match(h, /added addresses and a host in the last 72 hours\. Check what it added before signing\./);
  assert.match(h, /5 hours ago, seen by 2 witnesses/);
});

test('code with nothing added says so and when it clears', () => {
  const h = text(html('new code, nothing added'));
  assert.match(h, /Witnesses first saw this code 10 minutes ago, and it added no addresses or hosts\. This clears after an hour\./);
  assert.doesNotMatch(h, /0 address|Check what it added/);
});

test('one witness with another version is named, and is not called uncompared code', () => {
  const h = html('partial, one witness differs');
  assert.match(h, /One witness recorded a different version of a file whose name promises fixed content\./);
  assert.doesNotMatch(h, /Other code is running here/);
  assert.ok(h.includes(`data-copy="${FILE}"`));
  // It also has to surface when something worse heads the popup, and from a worker built before the field existed.
  assert.match(render(attached(verdict({ result: 'notSeen', notSeen: ['/a.js'], disputed: [FILE] })), NOW), /<dt>Also<\/dt>/);
  const older = { ...verdict({ result: 'partial' }) } as Partial<ReturnType<typeof verdict>>;
  delete older.disputed;
  assert.doesNotMatch(render(attached(older as ReturnType<typeof verdict>), NOW), /undefined|NaN/);
});

test('no release means no release section', () => {
  const h = html('matches');
  for (const s of ['Released', 'Added,', 'Also added', 'and in this tab']) assert.ok(!h.includes(s), s);
});

test('every other amber reason follows under the worst result', () => {
  const ns = html('not seen, also partial');
  const word = ns.indexOf('<span>Not seen</span>');
  const alsoRow = ns.indexOf('<dt>Also</dt>');
  assert.ok(word > -1 && alsoRow > word);
  assert.match(ns.slice(alsoRow), /Partial/);
  assert.match(ns.slice(alsoRow), /13 inline scripts/);

  const all = render(attached(verdict({ result: 'changed', changed: [{ path: FILE, tabHash: TAB_HASH, witnessedHashes: [WIT_HASH] }], notSeen: ['/x.js'], release, uncompared: { inline: 1, eval: 0, wasm: 0, thirdParty: [], frames: 0 } })), NOW);
  assert.equal(all.split('<dt>Also</dt>').length - 1, 3);
  assert.equal(render(attached(verdict()), NOW).split('<dt>Also</dt>').length - 1, 0);
  assert.equal(html("can't check, stale").split('<dt>Also</dt>').length - 1, 0);
});

test('a Matches popup has no fill and no go signal', () => {
  assert.doesNotMatch(html('matches'), /data-result="changed"/);
});

test('hostile path, host and region render as text', () => {
  const hostile = `/${XSS}.js`;
  const samples = [
    attached(verdict({ result: 'changed', changed: [{ path: hostile, tabHash: XSS, witnessedHashes: [XSS + '2'], evidence: evidence({ region: XSS }) }] }), XSS),
    attached(verdict({ result: 'notSeen', notSeen: [hostile], unknownHosts: [XSS] }), XSS),
    attached(verdict({ result: 'newRelease', release: { ...release, addrs: [{ value: XSS, inTabUrl: true }, { value: `"${XSS}`, inTabUrl: false }], hosts: [{ value: XSS, inTabUrl: false }] } }), XSS),
    attached(verdict({ result: 'partial', uncompared: { inline: 0, eval: 0, wasm: 0, frames: 0, thirdParty: [{ host: XSS, scripts: 1 }] } }), XSS),
    { phase: 'idle', host: XSS, listed: false, catalogueAgeSeconds: null } as const,
    { phase: 'checking', host: XSS, hashed: 0, total: 1, startedAt: NOW, catalogueAgeSeconds: 1 } as const,
  ];
  for (const s of samples) {
    const h = render(s, NOW);
    assert.doesNotMatch(h, /<img/i);
    assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  }
  const region = render(samples[0]!, NOW);
  assert.ok(region.includes(`<pre class="region popup-region" tabindex="0">&lt;img`));
  // A quote can't break out of the copy attribute.
  assert.doesNotMatch(render(samples[2]!, NOW), /data-copy="""/);
});

test('an unknown last-check result never reads as a real word', () => {
  const h = render({ phase: 'idle', host: 'x', listed: true, catalogueAgeSeconds: 1, lastCheck: { result: 'nope' as ResultKind, finishedAt: NOW } }, NOW);
  assert.match(h, /data-result="cant-check"/);
});

test('long values stay whole in the HTML', () => {
  const long = `/${'a'.repeat(400)}/${'b'.repeat(200)}.js`;
  const h = render(attached(verdict({ result: 'notSeen', notSeen: [long], unknownHosts: [`${'c'.repeat(300)}.example`] })), NOW);
  const head = h.match(/<span class="value-head">([^<]*)<\/span><span class="value-tail">([^<]*)<\/span>/)!;
  assert.equal(head[1]! + head[2]!, long);
  assert.ok(head[2]!.length <= 28, 'tail stays short enough for the popup');
  assert.ok(h.includes(`data-copy="${long}"`));
  assert.ok(h.includes(`${'c'.repeat(292)}`));
});

test('banned words appear in no state and no source string', () => {
  for (const [name, state] of Object.entries(allStates())) assert.doesNotMatch(render(state, NOW), BANNED, name);
  assert.doesNotMatch(renderUnavailable(), BANNED);
  for (const f of ['render.ts', 'format.ts', 'popup.ts', 'popup.html']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), BANNED, f);
  }
});

test('a failed attach says nothing was compared and offers the button again', () => {
  const html = render({ phase: 'idle', host: 'example.org', listed: true, catalogueAgeSeconds: 10, attachFailed: true }, NOW);
  assert.match(html, /nothing was compared/);
  assert.match(html, /data-action="start"/);
});
