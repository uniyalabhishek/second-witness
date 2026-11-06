// Replays the real archived captures of Safe's bundle through `core`, as text. Nothing is executed.
// Commits only hashes, timestamps, the changed region and what it added. Captures stay out of git.
// Run: node replay/fetch-captures.mjs && node replay/run.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { BLOCK_SECONDS, addedTo, changedRegion, hashCode, surface, verdict } from '../core/src/index.ts';
import type { Catalogue, Observation, Site } from '../core/src/index.ts';

const PATH = '/_next/static/chunks/pages/_app-52c9031bfa03da47.js';
const THEFT_ISO = '2025-02-21T14:13:35Z'; // Theft tx 0x46deef0f..., block 21895238, read from chain.
const CAPTURES = ['20250214130614', '20250214190721', '20250217024944', '20250219111919', '20250219172905', '20250222022646', '20250222175509'];
const W1 = '0x0000000000000000000000000000000000000001';
const W2 = '0x0000000000000000000000000000000000000002';
const SITE: Site = {
  id: 'app.safe.global',
  origins: ['https://app.safe.global'],
  immutable: '/_next/static/chunks/.*[-.][0-9a-f]{16}\\.js$',
  thirdParty: [],
  seeds: [],
};

const iso = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;

function decode(raw: Buffer): string {
  if (raw[0] === 0x1f && raw[1] === 0x8b) return gunzipSync(raw).toString('utf8');
  try {
    if (/[\x00-\x08]/.test(raw.toString('utf8', 0, 200))) return brotliDecompressSync(raw).toString('utf8');
  } catch {
    // Already plain text.
  }
  return raw.toString('utf8');
}

export interface ReplayStep {
  time: string;
  hash: string;
  bytes: number;
  altered: boolean;
  /** What a tab running this capture would read, given only what witnesses had seen by then. */
  result: string;
  hoursBeforeTheft: number;
}

export async function runReplay(dir: string) {
  const texts = CAPTURES.map(ts => decode(readFileSync(`${dir}/${ts}.bin`)));
  const hashes = await Promise.all(texts.map(hashCode));
  const counts = new Map<string, number>();
  for (const h of hashes) counts.set(h, (counts.get(h) ?? 0) + 1);
  const cleanHash = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  const alteredIdx = hashes.findIndex(h => h !== cleanHash);
  const cleanText = texts[alteredIdx - 1]!;
  const alteredText = texts[alteredIdx]!;
  const theft = Date.parse(THEFT_ISO);

  const steps: ReplayStep[] = [];
  const seen: Observation[] = [];
  CAPTURES.forEach((ts, i) => {
    const hash = hashes[i]!;
    const block = Math.floor(Date.parse(iso(ts)) / 1000 / BLOCK_SECONDS);
    // Witnesses are taken to have held the clean file before the first capture, so it isn't new code.
    const recorded = i === 0 ? block - 3600 : block;
    // Witnesses crawl what the server serves right now, and only new pairs get written.
    for (const witness of [W1, W2]) {
      if (!seen.some(o => o.witness === witness && o.files[0]![1] === hash)) {
        seen.push({ witness, site: SITE.id, createdAtBlock: recorded, files: [[PATH, hash]], added: { addrs: [], hosts: [] }, addedTotals: { addrs: 0, hosts: 0 } });
      }
    }
    const catalogue: Catalogue = {
      fetchedAt: 0,
      headBlock: block,
      headTime: 0,
      roster: [{ label: 'w1', address: W1 }, { label: 'w2', address: W2 }],
      observations: [...seen],
      changes: [],
      statuses: [{ witness: W1, updatedAtBlock: block, ok: [SITE.id] }, { witness: W2, updatedAtBlock: block, ok: [SITE.id] }],
    };
    const v = verdict({
      scripts: [{ url: `https://app.safe.global${PATH}`, isolated: false, hasSourceURL: false, startLine: 0, startColumn: 0, hash }],
      catalogue,
      site: SITE,
      tabUrl: 'https://app.safe.global/',
      crossOriginFrames: 0,
      now: 0,
    });
    const time = iso(ts);
    steps.push({
      time,
      hash,
      bytes: Buffer.byteLength(texts[i]!, 'utf8'),
      altered: hash !== cleanHash,
      result: v.result,
      hoursBeforeTheft: Number(((theft - Date.parse(time)) / 3.6e6).toFixed(1)),
    });
  });

  // The same altered code under a new filename: nothing to compare against at that path.
  const asNewRelease = addedTo(surface(alteredText), surface(cleanText), 50);
  const { offset, region } = changedRegion(cleanText, alteredText, 16 * 1024);

  return {
    source: `https://web.archive.org/web/*/https://app.safe.global${PATH}`,
    path: PATH,
    theft: { time: THEFT_ISO, tx: '0x46deef0f52e3a983b67abf4714448a41dd7ffd6d32d32da69d62081c68ad7882', block: 21895238 },
    steps,
    evidence: {
      cleanHash,
      alteredHash: hashes[alteredIdx]!,
      bytesAdded: Buffer.byteLength(alteredText, 'utf8') - Buffer.byteLength(cleanText, 'utf8'),
      offset,
      region,
    },
    asNewRelease: { added: asNewRelease.added, totals: asNewRelease.totals, knownAddrs: surface(cleanText).addrs.length },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await runReplay(new URL('./captures', import.meta.url).pathname);
  writeFileSync(new URL('./output.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  for (const s of out.steps) console.log(s.time, s.hash.slice(0, 16), String(s.bytes).padStart(8), s.result.padEnd(8), `${s.hoursBeforeTheft}h before theft`);
  console.log('bytes added', out.evidence.bytesAdded, 'at offset', out.evidence.offset, '| added addrs', out.asNewRelease.added.addrs, 'hosts', out.asNewRelease.added.hosts);
}
