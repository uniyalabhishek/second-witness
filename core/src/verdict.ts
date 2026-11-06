import { classify } from './classify.ts';
import { addressesInUrl } from './surface.ts';
import {
  BLOCK_SECONDS,
  CATALOGUE_FRESH_SECONDS,
  HEAD_AHEAD_SECONDS,
  HEAD_BEHIND_SECONDS,
  MIN_WITNESSES,
  NEW_CODE_SECONDS,
  NEW_RELEASE_SECONDS,
  WITNESS_FRESH_SECONDS,
} from './types.ts';
import type { AddedItem, Catalogue, ChangeRecord, ChangedFile, ParsedScript, Site, Verdict } from './types.ts';

export interface VersionInfo {
  witnesses: number;
  /** Block at which this version reached the witness threshold, so one stolen key can't make code look older. */
  firstSeenBlock: number;
}

type Attested = Map<string, Map<string, Map<string, number>>>;

/**
 * path -> hash -> witness -> earliest block. An observation attests its files, and a change record attests
 * both of its sides, so deleting observations alone can't erase a conflict.
 */
function attestations(catalogue: Catalogue, siteId: string): Attested {
  const roster = new Set(catalogue.roster.map(r => r.address));
  const seen: Attested = new Map();
  const add = (witness: string, path: string, hash: string, block: number) => {
    const byHash = seen.get(path) ?? new Map<string, Map<string, number>>();
    seen.set(path, byHash);
    const byWitness = byHash.get(hash) ?? new Map<string, number>();
    byHash.set(hash, byWitness);
    const prior = byWitness.get(witness);
    if (prior === undefined || block < prior) byWitness.set(witness, block);
  };
  for (const o of catalogue.observations) {
    if (o.site !== siteId || !roster.has(o.witness)) continue;
    for (const [path, hash] of o.files) add(o.witness, path, hash, o.createdAtBlock);
  }
  for (const c of catalogue.changes) {
    if (c.site !== siteId || !roster.has(c.witness)) continue;
    add(c.witness, c.path, c.oldHash, c.createdAtBlock);
    add(c.witness, c.path, c.newHash, c.createdAtBlock);
  }
  return seen;
}

/** path -> hash -> info, keeping only hashes with enough listed witnesses. */
export function indexVersions(catalogue: Catalogue, siteId: string): Map<string, Map<string, VersionInfo>> {
  return versionsFrom(attestations(catalogue, siteId));
}

function versionsFrom(seen: Attested): Map<string, Map<string, VersionInfo>> {
  const index = new Map<string, Map<string, VersionInfo>>();
  for (const [path, byHash] of seen) {
    const versions = new Map<string, VersionInfo>();
    for (const [hash, byWitness] of byHash) {
      if (byWitness.size < MIN_WITNESSES) continue;
      const blocks = [...byWitness.values()].sort((a, b) => a - b);
      versions.set(hash, { witnesses: byWitness.size, firstSeenBlock: blocks[MIN_WITNESSES - 1]! });
    }
    index.set(path, versions);
  }
  return index;
}

export type FileResult = 'matches' | 'changed' | 'notSeen';

/**
 * `versions` holds only hashes that reached the witness threshold. On a fixed-name file the first recorded
 * version is the original: a tab holding it clears once the other version has been known for 72 hours, so one
 * incident doesn't leave that file red for the life of the records. A later version never clears.
 */
export function compareFile(path: string, hash: string, versions: Map<string, VersionInfo>, immutable: RegExp, recentFromBlock: number): FileResult {
  const own = versions.get(hash);
  if (!immutable.test(path) || versions.size === 0) return own ? 'matches' : 'notSeen';
  if (!own) return 'changed';
  const others = [...versions.values()].filter(v => v !== own);
  const settled = others.every(v => v.firstSeenBlock > own.firstSeenBlock && v.firstSeenBlock < recentFromBlock);
  return settled ? 'matches' : 'changed';
}

/** A change record only explains this tab if the tab holds one side of it. */
function evidenceFor(changes: ChangeRecord[], rosterSet: Set<string>, siteId: string, path: string, tabHash: string): ChangeRecord | undefined {
  return changes
    .filter(c => c.site === siteId && c.path === path && rosterSet.has(c.witness) && (c.oldHash === tabHash || c.newHash === tabHash))
    .sort((a, b) => b.createdAtBlock - a.createdAtBlock)[0];
}

const fileKey = (path: string, hash: string) => `${path}\n${hash}`;

/** A release only speaks about this tab if the tab holds a file from it. */
function latestRelease(catalogue: Catalogue, rosterSet: Set<string>, siteId: string, tabUrl: string, held: Set<string>): Verdict['release'] {
  const inUrl = new Set(addressesInUrl(tabUrl));
  const age = (block: number) => (catalogue.headBlock - block) * BLOCK_SECONDS;
  const recent = catalogue.observations.filter(
    o =>
      o.site === siteId &&
      rosterSet.has(o.witness) &&
      (o.added.addrs.length > 0 || o.added.hosts.length > 0) &&
      age(o.createdAtBlock) <= NEW_RELEASE_SECONDS &&
      o.files.some(([path, hash]) => held.has(fileKey(path, hash))),
  );
  if (recent.length === 0) return undefined;

  const order = (items: Set<string>): AddedItem[] =>
    [...items]
      .sort()
      .map(value => ({ value, inTabUrl: inUrl.has(value) }))
      .sort((a, b) => Number(b.inTabUrl) - Number(a.inTabUrl));

  const addrs = new Set(recent.flatMap(o => o.added.addrs));
  const hosts = new Set(recent.flatMap(o => o.added.hosts));
  return {
    ageSeconds: Math.min(...recent.map(o => age(o.createdAtBlock))),
    addrs: order(addrs),
    hosts: order(hosts),
    totals: {
      addrs: Math.max(addrs.size, ...recent.map(o => o.addedTotals.addrs)),
      hosts: Math.max(hosts.size, ...recent.map(o => o.addedTotals.hosts)),
    },
  };
}

function emptyVerdict(): Verdict {
  return {
    result: 'cantCheck',
    witnessCount: 0,
    newestFileAgeSeconds: null,
    filesCompared: 0,
    changed: [],
    notSeen: [],
    disputed: [],
    unknownHosts: [],
    uncompared: { inline: 0, eval: 0, wasm: 0, thirdParty: [], frames: 0 },
    extensionScripts: 0,
    freshWitnesses: 0,
    lastCheckedSeconds: null,
  };
}

export interface VerdictInput {
  scripts: ParsedScript[];
  catalogue: Catalogue | null;
  site: Site | null;
  tabUrl: string;
  crossOriginFrames: number;
  /** Current time in milliseconds. Passed in so this stays pure. */
  now: number;
}

/** The worst result across the tab. Missing or stale data can never produce Matches. */
export function verdict({ scripts, catalogue, site, tabUrl, crossOriginFrames, now }: VerdictInput): Verdict {
  const v = emptyVerdict();
  v.uncompared.frames = crossOriginFrames;
  if (!site) return { ...v, cantCheckReason: 'siteNotListed' };
  if (!catalogue) return { ...v, cantCheckReason: 'noCatalogue' };
  if (catalogue.roster.length === 0) return { ...v, cantCheckReason: 'noRoster' };
  if (now - catalogue.fetchedAt > CATALOGUE_FRESH_SECONDS * 1000) return { ...v, cantCheckReason: 'catalogueStale' };
  // Ages count blocks back from the head, so a frozen or impossible head would make everything look fresh.
  const headLag = catalogue.fetchedAt / 1000 - catalogue.headTime;
  if (!(headLag <= HEAD_BEHIND_SECONDS && headLag >= -HEAD_AHEAD_SECONDS)) return { ...v, cantCheckReason: 'catalogueStale' };

  const rosterSet = new Set(catalogue.roster.map(r => r.address));
  const attested = attestations(catalogue, site.id);
  const index = versionsFrom(attested);
  const immutable = new RegExp(site.immutable);
  const recentFromBlock = catalogue.headBlock - NEW_RELEASE_SECONDS / BLOCK_SECONDS;
  const held = new Set<string>();
  const disputed = new Set<string>();
  const unknownHosts = new Set<string>();
  const thirdParty = new Map<string, number>();
  const notSeen = new Set<string>();
  const changed = new Map<string, ChangedFile>();
  const matchedVersions: VersionInfo[] = [];

  for (const script of scripts) {
    const c = classify(script, site);
    if (c.kind === 'ignored') {
      v.extensionScripts++;
      continue;
    }
    if (c.kind === 'uncompared') {
      v.uncompared[c.reason]++;
    } else if (c.kind === 'thirdParty') {
      if (c.listed) thirdParty.set(c.host, (thirdParty.get(c.host) ?? 0) + 1);
      else unknownHosts.add(c.host);
    } else {
      v.filesCompared++;
      const versions = index.get(c.path) ?? new Map<string, VersionInfo>();
      if (script.hash === undefined) {
        notSeen.add(c.path); // Couldn't read the source, so it can't count as matching.
        continue;
      }
      held.add(fileKey(c.path, script.hash));
      const result = compareFile(c.path, script.hash, versions, immutable, recentFromBlock);
      if (result === 'changed') {
        const own = versions.get(script.hash);
        changed.set(c.path, {
          path: c.path,
          tabHash: script.hash,
          witnessedHashes: [...versions.keys()],
          original: own !== undefined && [...versions.values()].every(o => o === own || o.firstSeenBlock > own.firstSeenBlock),
          evidence: evidenceFor(catalogue.changes, rosterSet, site.id, c.path, script.hash),
        });
      } else if (result === 'notSeen') {
        notSeen.add(c.path);
      } else {
        matchedVersions.push(versions.get(script.hash)!);
        // One witness can't raise red alone, but its contrary record still stops a green.
        const lone = [...(attested.get(c.path) ?? [])].some(([hash, by]) => hash !== script.hash && by.size < MIN_WITNESSES);
        if (lone && immutable.test(c.path)) disputed.add(c.path);
      }
    }
  }

  v.changed = [...changed.values()];
  v.notSeen = [...notSeen];
  v.disputed = [...disputed];
  v.unknownHosts = [...unknownHosts].sort();
  v.uncompared.thirdParty = [...thirdParty].map(([host, n]) => ({ host, scripts: n })).sort((a, b) => a.host.localeCompare(b.host));
  // Records keep ageing after they're read, and they can sit here for up to an hour during an outage.
  const sinceRead = (now - catalogue.fetchedAt) / 1000;
  if (matchedVersions.length > 0) {
    v.witnessCount = Math.min(...matchedVersions.map(m => m.witnesses));
    v.newestFileAgeSeconds = Math.min(...matchedVersions.map(m => (catalogue.headBlock - m.firstSeenBlock) * BLOCK_SECONDS)) + sinceRead;
  }
  v.release = latestRelease(catalogue, rosterSet, site.id, tabUrl, held);
  if (!v.release && v.newestFileAgeSeconds !== null && v.newestFileAgeSeconds < NEW_CODE_SECONDS) {
    v.release = { ageSeconds: v.newestFileAgeSeconds, addrs: [], hosts: [], totals: { addrs: 0, hosts: 0 } };
  }

  const latest = new Map<string, number>();
  for (const s of catalogue.statuses) {
    if (!rosterSet.has(s.witness) || !s.ok.includes(site.id)) continue;
    latest.set(s.witness, Math.max(latest.get(s.witness) ?? 0, s.updatedAtBlock));
  }
  const ages = [...latest.values()].map(block => (catalogue.headBlock - block) * BLOCK_SECONDS + sinceRead);
  v.freshWitnesses = ages.filter(a => a < WITNESS_FRESH_SECONDS).length;
  v.lastCheckedSeconds = ages.length ? Math.min(...ages) : null;

  const { inline, eval: evald, wasm, frames, thirdParty: third } = v.uncompared;
  const hasUncompared = inline + evald + wasm + frames + third.length + v.disputed.length > 0;
  if (v.changed.length > 0) v.result = 'changed';
  else if (v.notSeen.length > 0 || v.unknownHosts.length > 0) v.result = 'notSeen';
  else if (v.release && v.filesCompared > 0) v.result = 'newRelease';
  else if (hasUncompared || v.freshWitnesses < MIN_WITNESSES || v.filesCompared === 0) v.result = 'partial';
  else v.result = 'matches';
  return v;
}
