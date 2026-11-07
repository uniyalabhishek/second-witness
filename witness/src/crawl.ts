import { filePath } from '../../core/src/classify.ts';
import { hashCode } from '../../core/src/hash.ts';
import type { Site } from '../../core/src/types.ts';

// A normal browser user agent on purpose: a witness that identifies itself can be served clean code.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CONCURRENCY = 12;
const TIMEOUT_MS = 15_000;
const MAX_FILES = 3000;
const MAX_ROUNDS = 5;
const RETRIES = 4;
const MAX_WAIT_SECONDS = 60;
/** A rate-limited site can't hold up the rest of the run. */
const MAX_CRAWL_MS = 3 * 60_000;

export interface CrawledFile {
  path: string;
  hash: string;
  body: string;
}

export interface CrawlResult {
  /** The home page loaded and a script it names was fetched. A seed alone doesn't count: a challenge page can sit in front of a working /sw.js. */
  ok: boolean;
  /** Nothing was cut short by a time limit or rate limit. Only a complete crawl counts as the witness being current on this site. */
  complete: boolean;
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
  const nextBase = /^.*?\/_next\//.exec(new URL(fileUrl).pathname)?.[0];
  const next = nextBase ?? '/_next/';
  const add = (ref: string) => {
    try {
      out.add(ref.startsWith('/') || ref.startsWith('http') ? new URL(ref, origin).href : new URL(ref, fileUrl).href);
      // Vite lists "assets/x.js" from the root, inside a file already under /assets/.
      if (!/^(?:\.|\/|http)/.test(ref)) out.add(new URL(ref, origin).href);
    } catch {
      // Not a URL.
    }
  };
  for (const m of js.matchAll(/["'`]((?:https?:\/\/[^"'`\s]+|[./\w@-]*[\w-]+)\.m?js)(?:\?[^"'`\s]*)?["'`]/g)) {
    // Inside a Next build, static/... belongs to the rule below. Guessing other roots only earns 404s and rate limits.
    if (nextBase && m[1]!.startsWith('static/')) continue;
    if (m[1]!.length < 200 && !/^(?:node_modules|webpack|\.\/node)/.test(m[1]!)) add(m[1]!);
  }
  for (const m of js.matchAll(/["'`](static\/[^"'`\s]+\.js)["'`]/g)) add(`${next}${m[1]}`);
  // A workbox service worker names its runtime without an extension: define(["./workbox-5ef02f26"], ...).
  for (const m of js.matchAll(/define\(\[\s*["'](\.\/[\w.-]+)["']/g)) add(`${m[1]}.js`);
  // A webpack runtime names lazy chunks by id: "chunks/" + ({id: name}[id] || id) + "." + {id: hash}[id] + ".js".
  for (const m of js.matchAll(/["'`]([\w/.-]*chunks\/)["'`]\s*\+([^;]{0,8000}?)\{((?:\s*["']?\w+["']?\s*:\s*["'][0-9a-f]{8,}["']\s*,?)+)\}\)?\s*\[\w+\]\s*\+\s*["'`]\.js["'`]/g)) {
    const prefix = m[1]!.startsWith('static') ? `${next}${m[1]}` : m[1]!;
    const names = new Map([...m[2]!.matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g)].map(n => [n[1]!, n[2]!]));
    for (const e of m[3]!.matchAll(/["']?(\w+)["']?\s*:\s*["']([0-9a-f]{8,})["']/g)) add(`${prefix}${names.get(e[1]!) ?? e[1]}.${e[2]}.js`);
  }
  return [...out];
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A CDN answers a burst with 429 and says how long to wait. Every request to that site waits, so no file drops out of the records. */
function pacedGet(deadline: number): (url: string) => Promise<Response> {
  let resumeAt = 0;
  return async url => {
    for (let attempt = 0; ; attempt++) {
      await sleep(Math.max(0, resumeAt - Date.now()));
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
      if (res.status !== 429) return res;
      const wait = 1000 * Math.min(Number(res.headers.get('retry-after')) || 5 * 2 ** attempt, MAX_WAIT_SECONDS);
      if (attempt === RETRIES || Date.now() + wait >= deadline) return res;
      await res.body?.cancel();
      resumeAt = Date.now() + wait;
    }
  };
}

/** Fetches a site's scripts outward from its HTML. Its listed origins only, and only real JS responses count. */
export async function crawl(site: Site, budgetMs = MAX_CRAWL_MS): Promise<CrawlResult> {
  const origin = site.origins[0]!;
  const deadline = Date.now() + budgetMs;
  const get = pacedGet(deadline);
  let frontier: string[];
  let fromHome: Set<string>;
  try {
    const home = await get(new URL(site.home ?? '/', origin).href);
    if (!home.ok) return { ok: false, complete: false, files: [], failed: 0 };
    const html = await home.text();
    fromHome = new Set(refsFromHtml(html, home.url));
    // Some pages list their lazy scripts inline. Fetched, but not proof the site was reached: a challenge page is inline script too.
    const inline = refsFromJs(html.replaceAll('\\u002f', '/'), home.url, new URL(home.url).origin);
    frontier = [...new Set([...fromHome, ...inline, ...site.seeds.map(s => new URL(s, origin).href)])];
  } catch {
    return { ok: false, complete: false, files: [], failed: 0 };
  }

  const seen = new Set<string>();
  const files = new Map<string, CrawledFile>();
  let failed = 0;
  let reachedFromHome = false;
  let rateLimited = false;

  for (let round = 0; round < MAX_ROUNDS && frontier.length > 0 && seen.size < MAX_FILES; round++) {
    const next = new Set<string>();
    const batch = frontier.filter(u => !seen.has(u) && site.origins.includes(new URL(u).origin));
    for (let i = 0; i < batch.length && Date.now() < deadline; i += CONCURRENCY) {
      await Promise.all(
        batch.slice(i, i + CONCURRENCY).map(async url => {
          seen.add(url);
          try {
            const res = await get(url);
            if (res.status === 429) rateLimited = true;
            const isJs = res.ok && /javascript|ecmascript/.test(res.headers.get('content-type') ?? '') && site.origins.includes(new URL(res.url).origin);
            if (!isJs) {
              await res.body?.cancel();
              return;
            }
            // text() decodes UTF-8 and drops a BOM the same way the browser does before parsing.
            const body = await res.text();
            const path = filePath(new URL(res.url), site);
            if (fromHome.has(url)) reachedFromHome = true;
            files.set(path, { path, body, hash: await hashCode(body) });
            for (const ref of refsFromJs(body, res.url, new URL(res.url).origin)) if (!seen.has(ref)) next.add(ref);
          } catch {
            failed++;
          }
        }),
      );
    }
    frontier = [...next];
  }
  return { ok: reachedFromHome, complete: Date.now() < deadline && !rateLimited, files: [...files.values()], failed };
}
