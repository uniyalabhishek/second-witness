import type { Site } from './types.ts';

/** Where the Demo Treasury is served. The one value to change when it's deployed. */
export const DEMO_ORIGIN = 'https://second-witness.vercel.app';

// Filename shapes that carry a content hash. Only these can read Don't sign; any other file reads Not seen.
const VITE = '/assets/.*-(?=[a-z-]*[A-Z0-9_])[A-Za-z0-9_-]{8}\\.js$';
const NEXT = '/_next/static/chunks/.*[-.][0-9a-f]{16}\\.js$';
const IMMUTABLE = '^/_next/static/immutable/.*\\.js$';
const NONE = '$^';
const GTM = 'www.googletagmanager.com';
const CF_INSIGHTS = 'static.cloudflareinsights.com';

const listed = (host: string, immutable: string, thirdParty: string[] = [], cdn: string[] = []): Site => ({
  id: host,
  origins: [host, ...cdn].map(h => `https://${h}`),
  immutable,
  thirdParty,
  seeds: [],
});

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
    home: '/demo',
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
  // Each one compared in real Chrome against the crawl before listing: every file its home page loaded was found, with the same hash.
  listed('app.aave.com', NEXT, ['app.family.co', CF_INSIGHTS]),
  listed('app.uniswap.org', VITE, ['challenges.cloudflare.com', 'privy.app.uniswap.org'], ['cdn.app.uniswap.org']),
  listed('stake.lido.fi', NEXT, ['matomo.lido.fi']),
  listed('app.morpho.org', IMMUTABLE),
  listed('www.curve.finance', VITE),
  listed('app.compound.xyz', VITE, [CF_INSIGHTS]),
  listed('app.ens.domains', VITE, [CF_INSIGHTS, 'widget.intercom.io', 'edge.ens.domains']),
  listed('app.sky.money', VITE, [GTM, 'e.sky.money']),
  listed('app.spark.finance', VITE),
  listed('app.pendle.finance', VITE),
  listed('pancakeswap.finance', IMMUTABLE, [GTM]),
  listed('aerodrome.finance', VITE),
  listed('fluid.io', VITE, [GTM]),
  listed('across.to', VITE, [GTM]),
  listed('stargate.finance', NEXT),
  listed('superbridge.app', VITE),
  listed('www.tally.xyz', NEXT, ['plausible.io']),
  listed('snapshot.box', VITE),
  listed('blur.io', NEXT, [GTM]),
  listed('kamino.com', NONE, ['widget.intercom.io']),
];

export function siteForUrl(url: string, sites: Site[] = SITES): Site | null {
  try {
    const { origin } = new URL(url);
    return sites.find(s => s.origins.includes(origin)) ?? null;
  } catch {
    return null;
  }
}
