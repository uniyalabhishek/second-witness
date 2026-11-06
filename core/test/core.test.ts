import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashCode } from '../src/hash.ts';
import { surface, addedTo, changedRegion, addressesInUrl } from '../src/surface.ts';
import { classify } from '../src/classify.ts';
import { verdict, compareFile } from '../src/verdict.ts';
import {
  acceptObservation,
  acceptChange,
  acceptStatus,
  encodeBody,
  decodeBody,
  type RawEntity,
} from '../src/entities.ts';
import type { Catalogue, ParsedScript, Site } from '../src/types.ts';

const W1 = '0x109f654ec9c3c235d2f49128f8fa373bb3685821';
const W2 = '0xec6e879764725c30eca0df033adacdb58a05f632';
const STRANGER = '0x0000000000000000000000000000000000000bad';
const HEAD = 1_000_000;
const NOW = 1_800_000_000_000;

const site: Site = {
  id: 'app.example',
  origins: ['https://app.example'],
  immutable: '/chunks/.*[-.][0-9a-f]{16}\\.js$',
  thirdParty: ['cdn.listed.example'],
  seeds: [],
};

const hA = 'a'.repeat(64);
const hB = 'b'.repeat(64);
const hC = 'c'.repeat(64);
const PINNED = '/chunks/app-0123456789abcdef.js';
const LOOSE = '/loose.js';

const file = (path: string, hash: string): ParsedScript => ({
  url: `https://app.example${path}`,
  isolated: false,
  hasSourceURL: false,
  startLine: 0,
  startColumn: 0,
  hash,
});

const obs = (witness: string, files: [string, string][], ageBlocks = 5000, added = { addrs: [] as string[], hosts: [] as string[] }) => ({
  witness,
  site: site.id,
  createdAtBlock: HEAD - ageBlocks,
  files,
  added,
  addedTotals: { addrs: added.addrs.length, hosts: added.hosts.length },
});

const statusFresh = (witness: string) => ({ witness, updatedAtBlock: HEAD - 10, ok: [site.id] });

const catalogue = (o: Partial<Catalogue> = {}): Catalogue => ({
  fetchedAt: NOW,
  headBlock: HEAD,
  headTime: NOW / 1000,
  roster: [{ label: 'w1', address: W1 }, { label: 'w2', address: W2 }],
  observations: [obs(W1, [[PINNED, hA]]), obs(W2, [[PINNED, hA]])],
  changes: [],
  statuses: [statusFresh(W1), statusFresh(W2)],
  ...o,
});

const run = (scripts: ParsedScript[], cat: Catalogue | null = catalogue(), s: Site | null = site, tabUrl = 'https://app.example/', frames = 0) =>
  verdict({ scripts, catalogue: cat, site: s, tabUrl, crossOriginFrames: frames, now: NOW });

// hashCode ------------------------------------------------------------------
test('hashCode is the full SHA-256 of the UTF-8 source', async () => {
  assert.equal(await hashCode(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await hashCode('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('hashCode encodes as UTF-8, not latin1', async () => {
  assert.equal(await hashCode('é'), '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
});

// surface -------------------------------------------------------------------
test('surface lowercases addresses and hosts, and removes duplicates', () => {
  const s = surface('x="0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";y="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";u="https://API.Example.com/x";w="wss://rpc.example.org"');
  assert.deepEqual(s.addrs, ['0xabcdefabcdefabcdefabcdefabcdefabcdefabcd']);
  assert.deepEqual(s.hosts, ['api.example.com', 'rpc.example.org']);
});

test('surface ignores longer hex strings such as 32-byte values', () => {
  assert.deepEqual(surface(`"0x${'a'.repeat(64)}"`).addrs, []);
});

test('addedTo returns only what the known set lacks, capped with totals', () => {
  const r = addedTo({ addrs: ['0x1', '0x2'], hosts: ['a.com'] }, { addrs: ['0x1'], hosts: [] }, 50);
  assert.deepEqual(r.added, { addrs: ['0x2'], hosts: ['a.com'] });
  assert.deepEqual(r.totals, { addrs: 1, hosts: 1 });
  const big = addedTo({ addrs: Array.from({ length: 60 }, (_, i) => `0x${i}`), hosts: [] }, { addrs: [], hosts: [] }, 50);
  assert.equal(big.added.addrs.length, 50);
  assert.equal(big.totals.addrs, 60);
});

test('changedRegion trims common prefix and suffix and caps the size', () => {
  assert.deepEqual(changedRegion('aaaXbbb', 'aaaYYYbbb', 100), { offset: 3, region: 'YYY' });
  const r = changedRegion('aa', `a${'z'.repeat(50)}a`, 10);
  assert.equal(r.region.length, 10);
  assert.equal(r.offset, 1);
});

test('changedRegion on identical strings is empty', () => {
  assert.deepEqual(changedRegion('same', 'same', 100), { offset: 4, region: '' });
});

test('addressesInUrl finds the Safe address in a Safe URL', () => {
  const a = '0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4';
  assert.deepEqual(addressesInUrl(`https://app.safe.global/home?safe=eth:${a}`), [a.toLowerCase()]);
  assert.deepEqual(addressesInUrl('not a url'), []);
});

// classify ------------------------------------------------------------------
const base: ParsedScript = { url: 'https://app.example/a.js', isolated: false, hasSourceURL: false, startLine: 0, startColumn: 0 };

test('classify: a script in an isolated world belongs to another extension', () => {
  assert.deepEqual(classify({ ...base, isolated: true }, site), { kind: 'ignored' });
});

test('classify: a real extension script in the main world is ignored', () => {
  assert.deepEqual(classify({ ...base, url: 'chrome-extension://abc/inpage.js' }, site), { kind: 'ignored' });
});

test('classify: a page cannot hide code by labelling it with an extension URL', () => {
  const c = classify({ ...base, url: 'chrome-extension://abc/x.js', hasSourceURL: true }, site);
  assert.deepEqual(c, { kind: 'uncompared', reason: 'eval' });
});

test('classify: a sourceURL pointing at a real first-party file is never trusted', () => {
  const c = classify({ ...base, url: `https://app.example${PINNED}`, hasSourceURL: true }, site);
  assert.deepEqual(c, { kind: 'uncompared', reason: 'eval' });
});

test('classify: a first-party file cannot hide behind a sourceURL label', () => {
  const c = classify({ ...base, url: 'x.js', hasSourceURL: true, embedderName: `https://app.example${PINNED}` }, site);
  assert.deepEqual(c, { kind: 'file', path: PINNED });
});

test('classify: code built at runtime has no embedder name, whatever it calls itself', () => {
  for (const url of ['', 'x.js', `https://app.example${PINNED}`, 'chrome-extension://abc/x.js']) {
    assert.deepEqual(classify({ ...base, url, hasSourceURL: url !== '', embedderName: '' }, site), { kind: 'uncompared', reason: 'eval' });
  }
});

test('classify: a labelled inline script stays inline, and a labelled third-party file keeps its real host', () => {
  const inline = classify({ ...base, url: 'label.js', hasSourceURL: true, embedderName: 'https://app.example/', startLine: 4, startColumn: 8 }, site);
  assert.deepEqual(inline, { kind: 'uncompared', reason: 'inline' });
  const third = classify({ ...base, url: 'label.js', hasSourceURL: true, embedderName: 'https://evil.example/x.js' }, site);
  assert.deepEqual(third, { kind: 'thirdParty', host: 'evil.example', listed: false });
});

test('classify: empty URL is eval', () => {
  assert.deepEqual(classify({ ...base, url: '' }, site), { kind: 'uncompared', reason: 'eval' });
});

test('classify: inline scripts are recognised by their offset, even after an SPA navigation', () => {
  const c = classify({ ...base, url: 'https://app.example/old-route', startLine: 4, startColumn: 12 }, site);
  assert.deepEqual(c, { kind: 'uncompared', reason: 'inline' });
  const c2 = classify({ ...base, url: 'https://app.example/', startLine: 0, startColumn: 8 }, site);
  assert.deepEqual(c2, { kind: 'uncompared', reason: 'inline' });
});

test('classify: WebAssembly is uncompared', () => {
  assert.deepEqual(classify({ ...base, language: 'WebAssembly' }, site), { kind: 'uncompared', reason: 'wasm' });
});

test('classify: third-party scripts carry their host and whether it is listed', () => {
  assert.deepEqual(classify({ ...base, url: 'https://cdn.listed.example/x.js' }, site), { kind: 'thirdParty', host: 'cdn.listed.example', listed: true });
  assert.deepEqual(classify({ ...base, url: 'https://evil.example/x.js' }, site), { kind: 'thirdParty', host: 'evil.example', listed: false });
});

test('classify: a first-party file is keyed by pathname with the query dropped', () => {
  assert.deepEqual(classify({ ...base, url: 'https://app.example/a.js?v=2#f' }, site), { kind: 'file', path: '/a.js' });
});

test('classify: an unparseable URL can never become a file', () => {
  assert.deepEqual(classify({ ...base, url: 'webpack://x y' }, site), { kind: 'uncompared', reason: 'eval' });
  assert.deepEqual(classify({ ...base, url: 'blob:https://app.example/uuid' }, site), { kind: 'uncompared', reason: 'eval' });
  assert.deepEqual(classify({ ...base, url: 'data:text/javascript,1' }, site), { kind: 'uncompared', reason: 'eval' });
  assert.deepEqual(classify({ ...base, url: ':::' }, site), { kind: 'uncompared', reason: 'eval' });
});

// compareFile ---------------------------------------------------------------
const versionsOf = (...hashes: string[]) => new Map(hashes.map((h, i) => [h, { witnesses: 2, firstSeenBlock: i + 1 }]));
const RECENT_FROM = 1;

test('compareFile follows the PRD table', () => {
  const imm = new RegExp(site.immutable);
  assert.equal(compareFile(PINNED, hA, versionsOf(hA), imm, RECENT_FROM), 'matches');
  assert.equal(compareFile(PINNED, hB, versionsOf(hA), imm, RECENT_FROM), 'changed');
  assert.equal(compareFile(PINNED, hA, versionsOf(hA, hB), imm, RECENT_FROM), 'changed');
  assert.equal(compareFile(PINNED, hA, versionsOf(), imm, RECENT_FROM), 'notSeen');
  assert.equal(compareFile(LOOSE, hB, versionsOf(hA), imm, RECENT_FROM), 'notSeen');
  assert.equal(compareFile(LOOSE, hA, versionsOf(hA, hB), imm, RECENT_FROM), 'matches');
});

// verdict -------------------------------------------------------------------
test('Matches: every script compared, two witnesses, two fresh', () => {
  const v = run([file(PINNED, hA)]);
  assert.equal(v.result, 'matches');
  assert.equal(v.witnessCount, 2);
  assert.equal(v.filesCompared, 1);
  assert.equal(v.newestFileAgeSeconds, 10_000);
});

test('Changed: tab differs from what witnesses saw (served only to this user)', () => {
  const v = run([file(PINNED, hB)]);
  assert.equal(v.result, 'changed');
  assert.deepEqual(v.changed[0]?.witnessedHashes, [hA]);
  assert.equal(v.changed[0]?.tabHash, hB);
});

test('Changed: witnesses saw two versions at one fixed path, even if the tab has the clean one (Bybit)', () => {
  const v = run([file(PINNED, hA)], catalogue({
    observations: [obs(W1, [[PINNED, hA]]), obs(W2, [[PINNED, hA]]), obs(W1, [[PINNED, hB]], 100), obs(W2, [[PINNED, hB]], 100)],
    changes: [{ witness: W1, site: site.id, createdAtBlock: HEAD - 100, path: PINNED, oldHash: hA, newHash: hB, sizes: [10, 12], region: 'xx', offset: 3 }],
  }));
  assert.equal(v.result, 'changed');
  assert.equal(v.changed[0]?.evidence?.region, 'xx');
});

test('Changed: an altered file labelled with sourceURL still reads Changed', () => {
  const v = run([{ ...file(PINNED, hC), url: 'x.js', hasSourceURL: true, embedderName: `https://app.example${PINNED}` }]);
  assert.equal(v.result, 'changed');
});

test('Changed: a change record is evidence only if this tab holds one side of it', () => {
  const change = { witness: W1, site: site.id, createdAtBlock: HEAD - 100, path: PINNED, oldHash: hA, newHash: hB, sizes: [10, 12] as [number, number], region: 'xx', offset: 0 };
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]]), obs(W2, [[PINNED, hA]]), obs(W1, [[PINNED, hB]], 100), obs(W2, [[PINNED, hB]], 100)], changes: [change] });
  const v = run([file(PINNED, hC)], c);
  assert.equal(v.result, 'changed');
  assert.equal(v.changed[0]?.evidence, undefined);
  assert.equal(run([file(PINNED, hA)], c).changed[0]?.evidence?.region, 'xx');
});

test('One witness alone cannot raise a false Changed, but its contrary record stops a green', () => {
  const v = run([file(PINNED, hA)], catalogue({ observations: [obs(W1, [[PINNED, hA]]), obs(W2, [[PINNED, hA]]), obs(W1, [[PINNED, hB]], 100)] }));
  assert.equal(v.result, 'partial');
  assert.deepEqual(v.disputed, [PINNED]);
});

test('One witness alone cannot make altered code match', () => {
  const v = run([file(PINNED, hC)], catalogue({ observations: [obs(W1, [[PINNED, hC]])] }));
  assert.equal(v.result, 'notSeen');
});

test('Not seen: a file with no witnesses, and the same when the roster shrinks', () => {
  assert.equal(run([file('/chunks/new-fedcba9876543210.js', hC)]).result, 'notSeen');
  const shrunk = catalogue({ roster: [{ label: 'w1', address: W1 }] });
  shrunk.observations = shrunk.observations.filter(o => o.witness === W1);
  const v = run([file(PINNED, hA)], shrunk);
  assert.equal(v.result, 'notSeen');
  assert.deepEqual(v.notSeen, [PINNED]);
});

test('Not seen: a script from a host not on the list', () => {
  const v = run([file(PINNED, hA), { ...base, url: 'https://evil.example/x.js', hash: hC }]);
  assert.equal(v.result, 'notSeen');
  assert.deepEqual(v.unknownHosts, ['evil.example']);
});

test('Not seen: a file whose source could not be read fails closed', () => {
  const v = run([{ ...file(PINNED, hA), hash: undefined }]);
  assert.equal(v.result, 'notSeen');
});

test('New release: a release within 72 hours added an address, with the tab URL address first', () => {
  const inUrl = '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4';
  const other = '0x2222222222222222222222222222222222222222';
  const added = { addrs: [other, inUrl], hosts: ['drain.example'] };
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]], 3000, added), obs(W2, [[PINNED, hA]], 3000)] });
  const v = run([file(PINNED, hA)], c, site, `https://app.example/home?safe=eth:${inUrl}`);
  assert.equal(v.result, 'newRelease');
  assert.deepEqual(v.release?.addrs.map(a => [a.value, a.inTabUrl]), [[inUrl, true], [other, false]]);
  assert.deepEqual(v.release?.hosts.map(h => h.value), ['drain.example']);
  assert.equal(v.release?.ageSeconds, 6000);
});

test('New release: nothing compared means nothing was seen, so it reads Partial', () => {
  const added = { addrs: ['0x2222222222222222222222222222222222222222'], hosts: [] };
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]], 3000, added), obs(W2, [[PINNED, hA]], 3000)] });
  const v = run([{ ...base, url: '' }], c);
  assert.equal(v.result, 'partial');
  assert.equal(v.release, undefined);
});

test('New release clears after 72 hours', () => {
  const added = { addrs: ['0x2222222222222222222222222222222222222222'], hosts: [] };
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]], 72 * 1800 + 1, added), obs(W2, [[PINNED, hA]], 72 * 1800 + 1)] });
  assert.equal(run([file(PINNED, hA)], c).result, 'matches');
});

test('An ordinary release with no additions stays Matches, with its age shown', () => {
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]], 2000), obs(W2, [[PINNED, hA]], 2000)] });
  const v = run([file(PINNED, hA)], c);
  assert.equal(v.result, 'matches');
  assert.equal(v.newestFileAgeSeconds, 4000);
});

test('Changed beats Not seen beats New release beats Partial', () => {
  const added = { addrs: ['0x2222222222222222222222222222222222222222'], hosts: [] };
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]], 100, added), obs(W2, [[PINNED, hA]], 100)] });
  const inline: ParsedScript = { ...base, url: 'https://app.example/', startLine: 3, startColumn: 8 };
  assert.equal(run([file(PINNED, hA), inline], c).result, 'newRelease');
  assert.equal(run([file(PINNED, hA), inline, file('/chunks/n-fedcba9876543210.js', hC)], c).result, 'notSeen');
  assert.equal(run([file(PINNED, hB), inline, file('/chunks/n-fedcba9876543210.js', hC)], c).result, 'changed');
});

test('Partial: inline code running', () => {
  const v = run([file(PINNED, hA), { ...base, url: 'https://app.example/', startLine: 3, startColumn: 8 }]);
  assert.equal(v.result, 'partial');
  assert.equal(v.uncompared.inline, 1);
});

test('Partial: eval, wasm, listed third party and cross-origin frames each count', () => {
  const v = run([
    file(PINNED, hA),
    { ...base, url: '' },
    { ...base, language: 'WebAssembly' },
    { ...base, url: 'https://cdn.listed.example/a.js' },
    { ...base, url: 'https://cdn.listed.example/b.js' },
  ], catalogue(), site, 'https://app.example/', 2);
  assert.equal(v.result, 'partial');
  assert.deepEqual(v.uncompared, { inline: 0, eval: 1, wasm: 1, thirdParty: [{ host: 'cdn.listed.example', scripts: 2 }], frames: 2 });
});

test('Partial: a witness status over one hour old (PRD done-when 8)', () => {
  const v = run([file(PINNED, hA)], catalogue({ statuses: [statusFresh(W1), { witness: W2, updatedAtBlock: HEAD - 1801, ok: [site.id] }] }));
  assert.equal(v.result, 'partial');
  assert.equal(v.freshWitnesses, 1);
  assert.equal(v.lastCheckedSeconds, 20);
});

test('Scripts from other extensions are counted and do not change the result', () => {
  const v = run([file(PINNED, hA), { ...base, isolated: true, url: 'chrome-extension://w/content.js' }, { ...base, url: 'chrome-extension://w/inpage.js' }]);
  assert.equal(v.result, 'matches');
  assert.equal(v.extensionScripts, 2);
  assert.equal(v.filesCompared, 1);
});

test('Partial: a status ages while the catalogue sits in the browser', () => {
  const age = HEAD - 1770; // 59 minutes before the read.
  const statuses = [{ witness: W1, updatedAtBlock: age, ok: [site.id] }, { witness: W2, updatedAtBlock: age, ok: [site.id] }];
  assert.equal(run([file(PINNED, hA)], catalogue({ statuses })).result, 'matches');
  const v = run([file(PINNED, hA)], catalogue({ statuses, fetchedAt: NOW - 59 * 60 * 1000, headTime: NOW / 1000 - 59 * 60 }));
  assert.equal(v.result, 'partial');
  assert.equal(v.freshWitnesses, 0);
});

test('Partial: a witness status that does not list this site is not fresh for it', () => {
  const v = run([file(PINNED, hA)], catalogue({ statuses: [statusFresh(W1), { witness: W2, updatedAtBlock: HEAD - 10, ok: ['other.example'] }] }));
  assert.equal(v.result, 'partial');
});

test('Partial: no statuses at all reports no last-checked time', () => {
  const v = run([file(PINNED, hA)], catalogue({ statuses: [] }));
  assert.equal(v.result, 'partial');
  assert.equal(v.lastCheckedSeconds, null);
});

test('Ignored scripts never affect the result', () => {
  const v = run([file(PINNED, hA), { ...base, isolated: true, url: 'chrome-extension://w/content.js' }, { ...base, url: 'chrome-extension://w/inpage.js' }]);
  assert.equal(v.result, 'matches');
});

test('A tab with no scripts compared is never green', () => {
  const v = run([]);
  assert.equal(v.result, 'partial');
  assert.equal(v.filesCompared, 0);
});

test("Can't check: unlisted site, no catalogue, stale catalogue, no roster. Never green.", () => {
  assert.equal(run([file(PINNED, hA)], catalogue(), null).cantCheckReason, 'siteNotListed');
  assert.equal(run([file(PINNED, hA)], null).cantCheckReason, 'noCatalogue');
  const stale = run([file(PINNED, hA)], catalogue({ fetchedAt: NOW - 3_600_001 }));
  assert.equal(stale.result, 'cantCheck');
  assert.equal(stale.cantCheckReason, 'catalogueStale');
  assert.equal(run([file(PINNED, hA)], catalogue({ roster: [] })).cantCheckReason, 'noRoster');
});

test('Records from wallets not on the roster are dropped even if they reached the catalogue', () => {
  const c = catalogue({ observations: [obs(W1, [[PINNED, hC]]), obs(STRANGER, [[PINNED, hC]])] });
  assert.equal(run([file(PINNED, hC)], c).result, 'notSeen');
});

// wrong results found in outside review --------------------------------------
const twoVersions = (blocksAgoA: number, blocksAgoB: number) =>
  catalogue({
    observations: [obs(W1, [[PINNED, hA]], blocksAgoA), obs(W2, [[PINNED, hA]], blocksAgoA), obs(W1, [[PINNED, hB]], blocksAgoB), obs(W2, [[PINNED, hB]], blocksAgoB)],
  });
const OVER_72_HOURS = 72 * 1800 + 1;

test('Rollback: a tab holding the first recorded version clears 72 hours after the other version appeared', () => {
  assert.equal(run([file(PINNED, hA)], twoVersions(OVER_72_HOURS + 500, OVER_72_HOURS)).result, 'matches');
});

test('Rollback: inside those 72 hours the same tab still reads Changed', () => {
  assert.equal(run([file(PINNED, hA)], twoVersions(OVER_72_HOURS + 500, 100)).result, 'changed');
});

test('Rollback: a changed file says whether this tab holds the first recorded version', () => {
  const c = twoVersions(OVER_72_HOURS + 500, 100);
  assert.equal(run([file(PINNED, hA)], c).changed[0]!.original, true);
  assert.equal(run([file(PINNED, hB)], c).changed[0]!.original, false);
  assert.equal(run([file(PINNED, hC)], c).changed[0]!.original, false);
  assert.equal(run([file(PINNED, hA)], twoVersions(100, 100)).changed[0]!.original, false, 'a tie gives neither one authority');
});

test('Rollback: the later version never clears, however old it is', () => {
  assert.equal(run([file(PINNED, hB)], twoVersions(OVER_72_HOURS * 2, OVER_72_HOURS)).result, 'changed');
});

test('Rollback: two versions first seen together give neither one authority', () => {
  assert.equal(run([file(PINNED, hA)], twoVersions(OVER_72_HOURS, OVER_72_HOURS)).result, 'changed');
});

test('New code: a version both witnesses first saw minutes ago is not green, even with nothing added', () => {
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]], 1000), obs(W2, [[PINNED, hA]], 300)] });
  const v = run([file(PINNED, hA)], c);
  assert.equal(v.result, 'newRelease');
  assert.equal(v.release?.ageSeconds, 600);
  assert.deepEqual(v.release?.totals, { addrs: 0, hosts: 0 });
});

test('New code: after an hour with nothing added it reads Matches', () => {
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]], 2000), obs(W2, [[PINNED, hA]], 1801)] });
  assert.equal(run([file(PINNED, hA)], c).result, 'matches');
});

test('Withdrawal: deleting one record of the other version cannot turn Changed green', () => {
  // One stolen key deletes w1's record of A, leaving only the altered version at two witnesses.
  const c = catalogue({ observations: [obs(W2, [[PINNED, hA]], 6000), obs(W1, [[PINNED, hB]], 5000), obs(W2, [[PINNED, hB]], 5000)] });
  const v = run([file(PINNED, hB)], c);
  assert.equal(v.result, 'partial');
  assert.deepEqual(v.disputed, [PINNED]);
});

test('Withdrawal: change records keep the conflict when the observations are gone', () => {
  const change = (witness: string) => ({ witness, site: site.id, createdAtBlock: HEAD - 5000, path: PINNED, oldHash: hA, newHash: hB, sizes: [10, 12] as [number, number], region: 'xx', offset: 0 });
  const c = catalogue({ observations: [obs(W1, [[PINNED, hB]], 5000), obs(W2, [[PINNED, hB]], 5000)], changes: [change(W1), change(W2)] });
  assert.equal(run([file(PINNED, hB)], c).result, 'changed');
});

test('Withdrawal: a witness off the roster raises no dispute', () => {
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]]), obs(W2, [[PINNED, hA]]), obs(STRANGER, [[PINNED, hB]])] });
  const v = run([file(PINNED, hA)], c);
  assert.equal(v.result, 'matches');
  assert.deepEqual(v.disputed, []);
});

test('A file whose name promises nothing can differ between witnesses without a dispute', () => {
  const c = catalogue({ observations: [obs(W1, [[LOOSE, hA]]), obs(W2, [[LOOSE, hA]]), obs(W1, [[LOOSE, hB]])] });
  assert.equal(run([file(LOOSE, hA)], c).result, 'matches');
});

test('New release: a release this tab holds no file from says nothing about this tab', () => {
  const added = { addrs: ['0x2222222222222222222222222222222222222222'], hosts: [] };
  const other = '/chunks/other-fedcba9876543210.js';
  const c = catalogue({ observations: [obs(W1, [[PINNED, hA]]), obs(W2, [[PINNED, hA]]), obs(W1, [[other, hB]], 3000, added), obs(W2, [[other, hB]], 3000)] });
  const v = run([file(PINNED, hA)], c);
  assert.equal(v.result, 'matches');
  assert.equal(v.release, undefined);
});

test('Frozen chain: a head far behind the clock can never read as fresh', () => {
  const v = run([file(PINNED, hA)], catalogue({ headTime: NOW / 1000 - 301 }));
  assert.equal(v.result, 'cantCheck');
  assert.equal(v.cantCheckReason, 'catalogueStale');
});

test('Frozen chain: a head from the future is rejected too', () => {
  assert.equal(run([file(PINNED, hA)], catalogue({ headTime: NOW / 1000 + 61 })).cantCheckReason, 'catalogueStale');
});

test('Frozen chain: a catalogue with no head time fails closed', () => {
  const c = catalogue();
  delete (c as Partial<Catalogue>).headTime;
  assert.equal(run([file(PINNED, hA)], c).cantCheckReason, 'catalogueStale');
});

// entities ------------------------------------------------------------------
const raw =(o: Partial<RawEntity> & { body?: unknown }): RawEntity => ({
  key: '0xkey',
  creator: W1,
  createdAtBlock: 100,
  updatedAtBlock: 100,
  readonly: true,
  attrs: { site: site.id },
  bodyBytes: encodeBody(o.body ?? { files: [[PINNED, hA]], added: { addrs: [], hosts: [] }, totals: { addrs: 0, hosts: 0 } }),
  ...o,
});
const rosterSet = new Set([W1, W2]);

test('Body round-trips through bytes', () => {
  assert.deepEqual(decodeBody(encodeBody({ a: 1, b: 'é' })), { a: 1, b: 'é' });
});

test('acceptObservation takes a well-formed record from the roster', () => {
  const o = acceptObservation(raw({}), rosterSet);
  assert.equal(o?.witness, W1);
  assert.deepEqual(o?.files, [[PINNED, hA]]);
});

test('acceptObservation rejects creator case tricks by comparing lowercase', () => {
  assert.ok(acceptObservation(raw({ creator: W1.toUpperCase().replace('0X', '0x') }), rosterSet));
});

test('acceptObservation drops: stranger, edited, not readonly, bad hash, bad path, no site, garbage body', () => {
  assert.equal(acceptObservation(raw({ creator: STRANGER }), rosterSet), null);
  assert.equal(acceptObservation(raw({ updatedAtBlock: 101 }), rosterSet), null);
  assert.equal(acceptObservation(raw({ readonly: false }), rosterSet), null);
  assert.equal(acceptObservation(raw({ body: { files: [[PINNED, 'nothex']], added: { addrs: [], hosts: [] } } }), rosterSet), null);
  assert.equal(acceptObservation(raw({ body: { files: [['no-slash.js', hA]], added: { addrs: [], hosts: [] } } }), rosterSet), null);
  assert.equal(acceptObservation(raw({ attrs: {} }), rosterSet), null);
  assert.equal(acceptObservation(raw({ bodyBytes: new Uint8Array([1, 2, 3]) }), rosterSet), null);
});

test('acceptChange validates its hashes and keeps a null region', () => {
  const body = { path: PINNED, sizes: [1, 2], region: null, offset: null };
  const c = acceptChange(raw({ attrs: { site: site.id, old: hA, new: hB }, body }), rosterSet);
  assert.equal(c?.oldHash, hA);
  assert.equal(c?.region, null);
  assert.equal(acceptChange(raw({ attrs: { site: site.id, old: 'x', new: hB }, body }), rosterSet), null);
});

test('acceptStatus uses updatedAt and allows edits, because status is patched', () => {
  const s = acceptStatus(raw({ readonly: false, createdAtBlock: 1, updatedAtBlock: 99, attrs: {}, body: { ok: [site.id] } }), rosterSet);
  assert.equal(s?.updatedAtBlock, 99);
  assert.deepEqual(s?.ok, [site.id]);
  assert.equal(acceptStatus(raw({ creator: STRANGER, body: { ok: [] } }), rosterSet), null);
});
