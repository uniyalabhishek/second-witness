import { hashCode } from '../../core/src/hash.ts';
import type { Site } from '../../core/src/types.ts';

// A normal browser user agent on purpose: a witness that identifies itself can be served clean code.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CONCURRENCY = 12;
const TIMEOUT_MS = 15_000;
const MAX_FILES = 3000;
const MAX_ROUNDS = 5;

export interface CrawledFile {
  path: string;
  hash: string;
  body: string;
}

export interface CrawlResult {
  /** The home page loaded and a script it names was fetched. A seed alone doesn't count: a challenge page can sit in front of a working /sw.js. */
  ok: boolean;
  files: CrawledFile[];
  failed: number;
}

export function refsFromHtml(html: string, base: string): string[] {
  const out = new Set<string>();
  const add = (ref: string) => {
    try {
      out.add(new URL(ref, base).href);
    } catch {
      // Not a URL.
    }
  };
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) add(m[1]!);
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+\.m?js[^"']*)["']/gi)) add(m[1]!);
  return [...out];
}

/** Quoted script paths, Next manifests and webpack chunk maps. */
export function refsFromJs(js: string, fileUrl: string, origin: string): string[] {
  const out = new Set<string>();
  const add = (ref: string) => {
    try {
      out.add(ref.startsWith('/') || ref.startsWith('http') ? new URL(ref, origin).href : new URL(ref, fileUrl).href);
    } catch {
      // Not a URL.
    }
  };
  for (const m of js.matchAll(/["'`]((?:https?:\/\/[^"'`\s]+|[./\w@-]*[\w-]+)\.m?js)(?:\?[^"'`\s]*)?["'`]/g)) {
    if (m[1]!.length < 200 && !/^(?:node_modules|webpack|\.\/node)/.test(m[1]!)) add(m[1]!);
  }
  for (const m of js.matchAll(/["'`](static\/[^"'`\s]+\.js)["'`]/g)) add(`/_next/${m[1]}`);
  // A workbox service worker names its runtime without an extension: define(["./workbox-5ef02f26"], ...).
  for (const m of js.matchAll(/define\(\[\s*["'](\.\/[\w.-]+)["']/g)) add(`${m[1]}.js`);
  for (const m of js.matchAll(/["'`]([\w/.-]*chunks\/)["'`]\s*\+[^;]{0,400}?\{((?:\s*["']?\w+["']?\s*:\s*["'][0-9a-f]{8,}["']\s*,?)+)\}\s*\[\w+\]\s*\+\s*["'`]\.js["'`]/g)) {
    const prefix = m[1]!.startsWith('static') ? `/_next/${m[1]}` : m[1]!;
    for (const e of m[2]!.matchAll(/["']?(\w+)["']?\s*:\s*["']([0-9a-f]{8,})["']/g)) add(`${prefix}${e[1]}.${e[2]}.js`);
  }
  return [...out];
}

async function get(url: string): Promise<Response> {
  return fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
}

/** Fetches a site's scripts outward from its HTML. Same origin only, and only real JS responses count. */
export async function crawl(site: Site): Promise<CrawlResult> {
  const origin = site.origins[0]!;
  let frontier: string[];
  let fromHome: Set<string>;
  try {
    const home = await get(new URL(site.home ?? '/', origin).href);
    if (!home.ok) return { ok: false, files: [], failed: 0 };
    fromHome = new Set(refsFromHtml(await home.text(), home.url));
    frontier = [...fromHome, ...site.seeds.map(s => new URL(s, origin).href)];
  } catch {
    return { ok: false, files: [], failed: 0 };
  }

  const seen = new Set<string>();
  const files = new Map<string, CrawledFile>();
  let failed = 0;
  let reachedFromHome = false;

  for (let round = 0; round < MAX_ROUNDS && frontier.length > 0 && seen.size < MAX_FILES; round++) {
    const next = new Set<string>();
    const batch = frontier.filter(u => !seen.has(u) && new URL(u).origin === origin);
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      await Promise.all(
        batch.slice(i, i + CONCURRENCY).map(async url => {
          seen.add(url);
          try {
            const res = await get(url);
            const isJs = res.ok && /javascript|ecmascript/.test(res.headers.get('content-type') ?? '') && new URL(res.url).origin === origin;
            if (!isJs) {
              await res.body?.cancel();
              return;
            }
            // text() decodes UTF-8 and drops a BOM the same way the browser does before parsing.
            const body = await res.text();
            const path = new URL(res.url).pathname;
            if (fromHome.has(url)) reachedFromHome = true;
            files.set(path, { path, body, hash: await hashCode(body) });
            for (const ref of refsFromJs(body, res.url, origin)) if (!seen.has(ref)) next.add(ref);
          } catch {
            failed++;
          }
        }),
      );
    }
    frontier = [...next];
  }
  return { ok: reachedFromHome, files: [...files.values()], failed };
}
