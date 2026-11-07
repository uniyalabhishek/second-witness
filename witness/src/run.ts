// One witness run: node --env-file=.env witness/src/run.ts --key W1_KEY
// Stateless apart from a disk cache of file bodies. Keys are never printed.
import { createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { bytes, defineSchema, str, u64 } from '@arkiv-network/sdk/schema';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { acceptObservation, encodeBody } from '../../core/src/entities.ts';
import { SITES } from '../../core/src/sites.ts';
import { surface } from '../../core/src/surface.ts';
import { SCHEMA_CHANGE, SCHEMA_OBS, SCHEMA_STATUS, type Observation, type Site, type Surface } from '../../core/src/types.ts';
import { ARKIV_RPC, fetchEntities } from '../../reader/src/index.ts';
import { crawl, type CrawlResult } from './crawl.ts';
import { planWrites } from './plan.ts';

const Obs = defineSchema(SCHEMA_OBS, { site: str().indexed(), observedAt: u64().indexed(), body: bytes() });
const Change = defineSchema(SCHEMA_CHANGE, { site: str().indexed(), old: str(), new: str(), body: bytes() });
const Status = defineSchema(SCHEMA_STATUS, { body: bytes() });

const WRITE_ONCE = { expiration: ExpirationTime.fromDays(180), flags: { readonly: true } };

const keyName = process.argv[process.argv.indexOf('--key') + 1];
const rawKey = keyName ? process.env[keyName] : undefined;
if (!rawKey) throw new Error('Usage: node --env-file=.env witness/src/run.ts --key W1_KEY');

const account = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`);
const me = account.address.toLowerCase();
const wallet = createWalletClient({ chain: rabdi({ accessKey: '' }), transport: http(ARKIV_RPC), account });
const cacheRoot = join(fileURLToPath(new URL('../../.witness-cache/', import.meta.url)), me);

function cacheFor(site: Site) {
  const dir = join(cacheRoot, site.id);
  mkdirSync(dir, { recursive: true });
  const read = (hash: string) => {
    try {
      return readFileSync(join(dir, `${hash}.js`), 'utf8');
    } catch {
      return null;
    }
  };
  const allSurface = (): Surface | null => {
    const names = readdirSync(dir);
    if (names.length === 0) return null;
    const addrs = new Set<string>();
    const hosts = new Set<string>();
    for (const name of names) {
      const s = surface(readFileSync(join(dir, name), 'utf8'));
      s.addrs.forEach(a => addrs.add(a));
      s.hosts.forEach(h => hosts.add(h));
    }
    return { addrs: [...addrs], hosts: [...hosts] };
  };
  const save = (hash: string, body: string) => writeFileSync(join(dir, `${hash}.js`), body);
  return { read, allSurface, save };
}

function knownFor(observations: Observation[], siteId: string): Map<string, string[]> {
  const known = new Map<string, string[]>();
  for (const o of observations.filter(o => o.site === siteId).sort((a, b) => a.createdAtBlock - b.createdAtBlock)) {
    for (const [path, hash] of o.files) {
      const hashes = known.get(path) ?? [];
      if (!hashes.includes(hash)) hashes.push(hash);
      known.set(path, hashes);
    }
  }
  return known;
}

// Crawls overlap so a long list fits the job's time limit. Writes take turns: one wallet, one nonce.
const CRAWLS_AT_ONCE = 6;
let writing: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const result = writing.then(work);
  writing = result.catch(() => {});
  return result;
}

/** Returns whether this witness is current on this site: crawled to the end, with everything new written. */
async function witnessSite(site: Site, observations: Observation[]): Promise<boolean> {
  const crawled = await crawl(site);
  if (!crawled.ok) {
    console.log(`${site.id}: not reached`);
    return false;
  }
  return inTurn(() => writeSite(site, crawled, observations));
}

async function writeSite(site: Site, crawled: CrawlResult, observations: Observation[]): Promise<boolean> {
  const cache = cacheFor(site);
  const plan = planWrites({
    crawled: crawled.files,
    known: knownFor(observations, site.id),
    cachedSurface: cache.allSurface(),
    cachedBody: cache.read,
    immutable: new RegExp(site.immutable),
  });
  // Changes first: once a hash is observed, a retry no longer sees it as a change.
  for (const change of plan.changes) {
    const values = { site: site.id, old: change.old, new: change.new, body: encodeBody(change.body) };
    const { txHash } = await wallet.createEntity(Change, values, WRITE_ONCE);
    console.log(`${site.id}: ${change.body.path} changed ${txHash}`);
  }
  for (const body of plan.obs) {
    const values = { site: site.id, observedAt: u64(BigInt(Math.floor(Date.now() / 1000))), body: encodeBody(body) };
    const { txHash } = await wallet.createEntity(Obs, values, WRITE_ONCE);
    console.log(`${site.id}: observed ${body.files.length} files, +${body.totals.addrs} addresses, +${body.totals.hosts} hosts ${txHash}`);
  }
  // Only after the writes land: a failed run retries against the same cache and reports the same additions.
  for (const file of crawled.files) cache.save(file.hash, file.body);
  console.log(`${site.id}: reached ${crawled.files.length} files, ${crawled.failed} failed, ${plan.obs.length + plan.changes.length} writes${crawled.complete ? '' : ', cut short'}`);
  return crawled.complete;
}

const roster = new Set([me]);
const [ownObs, ownStatus] = await Promise.all([
  fetchEntities(ARKIV_RPC, SCHEMA_OBS, [me]),
  fetchEntities(ARKIV_RPC, SCHEMA_STATUS, [me]),
]);
const observations = ownObs.flatMap(e => acceptObservation(e, roster) ?? []);

const ok: string[] = [];
const queue = [...SITES];
await Promise.all(Array.from({ length: CRAWLS_AT_ONCE }, async () => {
  for (let site = queue.shift(); site; site = queue.shift()) {
    try {
      if (await witnessSite(site, observations)) ok.push(site.id);
    } catch (error) {
      console.log(`${site.id}: write failed: ${(error as Error).message.split('\n')[0]}`);
    }
  }
}));

const statusBody = encodeBody({ ok });
const statusKey = ownStatus[0]?.key as `0x${string}` | undefined;
if (statusKey) {
  await wallet.patchEntity(Status, statusKey, { set: { body: statusBody } });
} else {
  await wallet.createEntity(Status, { body: statusBody }, { expiration: ExpirationTime.fromDays(180) });
}
console.log(`status: ${ok.join(', ') || 'no sites reached'}`);
if (ok.length === 0) process.exitCode = 1;
