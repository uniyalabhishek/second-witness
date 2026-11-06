import type { ChangeRecord, Observation, WitnessStatus } from './types.ts';

/** An Arkiv entity reduced to the fields trust decisions need. The reader fills this in. */
export interface RawEntity {
  key: string;
  creator: string;
  createdAtBlock: number;
  updatedAtBlock: number;
  readonly: boolean;
  attrs: Record<string, unknown>;
  bodyBytes?: Uint8Array;
}

const HASH = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HOST = /^[a-z0-9][a-z0-9.-]*$/;
const MAX_FILES = 5000;
const MAX_ADDED = 50;

export function encodeBody(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

export function decodeBody(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

const isPath = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && p.length <= 2048;
const isHash = (h: unknown): h is string => typeof h === 'string' && HASH.test(h);
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function body(raw: RawEntity): Record<string, unknown> | null {
  if (!raw.bodyBytes) return null;
  try {
    const b = decodeBody(raw.bodyBytes);
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Observations and changes must be write-once from a listed witness, or they don't count. */
function creatorIfWriteOnce(raw: RawEntity, roster: Set<string>): string | null {
  const creator = raw.creator.toLowerCase();
  if (!roster.has(creator)) return null;
  if (!raw.readonly || raw.updatedAtBlock !== raw.createdAtBlock) return null;
  return creator;
}

export function acceptObservation(raw: RawEntity, roster: Set<string>): Observation | null {
  const witness = creatorIfWriteOnce(raw, roster);
  const site = raw.attrs.site;
  const b = body(raw);
  if (!witness || typeof site !== 'string' || !b) return null;

  const { files, added, totals } = b as { files?: unknown; added?: { addrs?: unknown; hosts?: unknown }; totals?: { addrs?: unknown; hosts?: unknown } };
  if (!Array.isArray(files) || files.length > MAX_FILES) return null;
  for (const f of files) if (!Array.isArray(f) || f.length !== 2 || !isPath(f[0]) || !isHash(f[1])) return null;

  const addrs = added?.addrs;
  const hosts = added?.hosts;
  if (!Array.isArray(addrs) || !Array.isArray(hosts) || addrs.length > MAX_ADDED || hosts.length > MAX_ADDED) return null;
  if (!addrs.every(a => typeof a === 'string' && ADDRESS.test(a))) return null;
  if (!hosts.every(h => typeof h === 'string' && HOST.test(h))) return null;

  return {
    witness,
    site,
    createdAtBlock: raw.createdAtBlock,
    files: files as [string, string][],
    added: { addrs: addrs as string[], hosts: hosts as string[] },
    addedTotals: {
      addrs: isCount(totals?.addrs) ? totals.addrs : addrs.length,
      hosts: isCount(totals?.hosts) ? totals.hosts : hosts.length,
    },
  };
}

export function acceptChange(raw: RawEntity, roster: Set<string>): ChangeRecord | null {
  const witness = creatorIfWriteOnce(raw, roster);
  const { site, old: oldHash, new: newHash } = raw.attrs;
  const b = body(raw);
  if (!witness || typeof site !== 'string' || !isHash(oldHash) || !isHash(newHash) || !b) return null;

  const { path, sizes, region, offset } = b;
  if (!isPath(path) || !Array.isArray(sizes) || sizes.length !== 2 || !sizes.every(isCount)) return null;
  if (region !== null && typeof region !== 'string') return null;
  if (offset !== null && !isCount(offset)) return null;

  return {
    witness,
    site,
    createdAtBlock: raw.createdAtBlock,
    path,
    oldHash,
    newHash,
    sizes: sizes as [number, number],
    region: region as string | null,
    offset: offset as number | null,
  };
}

/** Status is patched every run, so it's the one record allowed to change. */
export function acceptStatus(raw: RawEntity, roster: Set<string>): WitnessStatus | null {
  const witness = raw.creator.toLowerCase();
  const b = body(raw);
  if (!roster.has(witness) || !b) return null;
  const { ok } = b;
  if (!Array.isArray(ok) || !ok.every(s => typeof s === 'string')) return null;
  return { witness, updatedAtBlock: raw.updatedAtBlock, ok: ok as string[] };
}
