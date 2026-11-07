import { addedTo, changedRegion, surface } from '../../core/src/surface.ts';
import type { Surface } from '../../core/src/types.ts';
import type { CrawledFile } from './crawl.ts';

const ADDED_CAP = 50;
const REGION_CAP = 16 * 1024;
/** A 180-day create nears the 2^24 gas cap around 86 KiB once the SDK pads its estimate. */
const MAX_BODY_BYTES = 64 * 1024;

export interface ObsBody {
  files: [string, string][];
  added: Surface;
  totals: { addrs: number; hosts: number };
}

export interface ChangeBody {
  old: string;
  new: string;
  body: { path: string; sizes: [number, number]; region: string | null; offset: number | null };
}

export interface PlanInput {
  crawled: CrawledFile[];
  /** path -> hashes this witness already wrote to Arkiv. */
  known: Map<string, string[]>;
  /** Everything named by this site's cached files. Null means no cache, so this run is a baseline. */
  cachedSurface: Surface | null;
  /** Reads a cached file body by hash, if the cache still has it. */
  cachedBody: (hash: string) => string | null;
  immutable: RegExp;
}

export interface Plan {
  obs: ObsBody[];
  changes: ChangeBody[];
}

function union(items: Surface[]): Surface {
  return {
    addrs: [...new Set(items.flatMap(s => s.addrs))].sort(),
    hosts: [...new Set(items.flatMap(s => s.hosts))].sort(),
  };
}

/** Only what's new gets written. If nothing is new, the plan is empty. */
export function planWrites({ crawled, known, cachedSurface, cachedBody, immutable }: PlanInput): Plan {
  const fresh = crawled.filter(f => !known.get(f.path)?.includes(f.hash));
  if (fresh.length === 0) return { obs: [], changes: [] };

  const baseline = { added: { addrs: [], hosts: [] }, totals: { addrs: 0, hosts: 0 } };
  const { added, totals } = cachedSurface ? addedTo(union(fresh.map(f => surface(f.body))), cachedSurface, ADDED_CAP) : baseline;

  const changes: ChangeBody[] = [];
  for (const f of fresh) {
    const prior = known.get(f.path);
    if (!prior?.length || !immutable.test(f.path)) continue;
    const old = prior.at(-1)!;
    const oldBody = cachedBody(old);
    const diff = oldBody === null ? null : changedRegion(oldBody, f.body, REGION_CAP);
    changes.push({
      old,
      new: f.hash,
      body: {
        path: f.path,
        sizes: [oldBody === null ? 0 : byteLength(oldBody), byteLength(f.body)],
        region: diff?.region ?? null,
        offset: diff?.offset ?? null,
      },
    });
  }

  const obs: ObsBody[] = [];
  let current: ObsBody = { files: [], added, totals };
  let size = byteLength(JSON.stringify(current));
  for (const f of fresh) {
    const entry = byteLength(JSON.stringify([f.path, f.hash])) + 1;
    if (size + entry > MAX_BODY_BYTES && current.files.length > 0) {
      obs.push(current);
      // Every part repeats the additions: a release only speaks about a tab holding one of its files.
      current = { files: [], added, totals };
      size = byteLength(JSON.stringify(current));
    }
    current.files.push([f.path, f.hash]);
    size += entry;
  }
  obs.push(current);
  return { obs, changes };
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;
