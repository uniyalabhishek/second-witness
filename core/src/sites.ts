import type { Site } from './types.ts';

/** Where the Demo Treasury is served. The one value to change when it's deployed. */
export const DEMO_ORIGIN = 'https://second-witness.vercel.app';

/** The short list. Bundled with the witness and the extension. */
export const SITES: Site[] = [
  {
    id: 'app.safe.global',
    origins: ['https://app.safe.global'],
    immutable: '/_next/static/chunks/.*[-.][0-9a-f]{16}\\.js$',
    thirdParty: [],
    seeds: ['/sw.js'],
  },
  {
    id: 'swap.cow.fi',
    origins: ['https://swap.cow.fi'],
    immutable: '^/static/.*-[A-Za-z0-9_-]{8}\\.js$',
    thirdParty: [
      'api.hypelab.com',
      'cdn.spindl.xyz',
      'challenges.cloudflare.com',
      'files.cow.fi',
      'googleads.g.doubleclick.net',
      'scripts.clarity.ms',
      'static.ads-twitter.com',
      'tag.adrsbl.io',
      'w.appzi.io',
      'www.clarity.ms',
      'www.googletagmanager.com',
      'www.redditstatic.com',
    ],
    seeds: ['/service-worker.js'],
  },
  {
    id: 'demo-2',
    origins: [DEMO_ORIGIN],
    immutable: '^/assets/app-[0-9a-f]{16}\\.js$',
    thirdParty: [],
    seeds: [],
  },
  {
    id: 'revoke.cash',
    origins: ['https://revoke.cash'],
    immutable: '^/_next/static/immutable/.*\\.js$',
    thirdParty: ['client.crisp.chat', 'static.cloudflareinsights.com'],
    // Lazy chunks named by no file the crawl can read. Hash-named, so a later deploy can read Not seen until these are updated.
    seeds: [
      '/431852cb494ae7c6/script.js',
      '/_next/static/immutable/chunks/22hbz7zx2te4s.js',
      '/_next/static/immutable/chunks/0y_ejowdfu4a4.js',
      '/_next/static/immutable/chunks/0dtsucltly3te.js',
      '/_next/static/immutable/chunks/1pw0e1rfwfz3v.js',
      '/_next/static/immutable/chunks/1s4l_7szt89w3.js',
      '/_next/static/immutable/chunks/1y0r6veetnq08.js',
    ],
  },
];

export function siteForUrl(url: string, sites: Site[] = SITES): Site | null {
  try {
    const { origin } = new URL(url);
    return sites.find(s => s.origins.includes(origin)) ?? null;
  } catch {
    return null;
  }
}
