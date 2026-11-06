// One real verdict shape per popup state. Hosts here carry no copy words, so the banned-word check stays exact.
import type { ChangeRecord, Verdict } from '../../core/src/types.ts';
import type { PopupState } from '../src/state.ts';

export const NOW = 1_800_000_000_000;
export const A1 = '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4';
export const A2 = '0x19c6876e978d9f128147439ac4cd9ea2582cd141';
export const FILE = '/_next/static/chunks/pages/_app-52c9031bfa03da47.js';
export const TAB_HASH = 'fbd5e3eb17ef62f2ecf7890108a3af9b2c41d7e05a96b38c17f0e24d6ab85c13';
export const WIT_HASH = 'b93eeeb2063e69101c78eb218991c82f70d3a1fe45c28b96e01d7a34cf6b92e8';

export const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  result: 'matches',
  witnessCount: 2,
  newestFileAgeSeconds: 3 * 86400,
  filesCompared: 54,
  changed: [],
  notSeen: [],
  disputed: [],
  unknownHosts: [],
  uncompared: { inline: 0, eval: 0, wasm: 0, thirdParty: [], frames: 0 },
  extensionScripts: 0,
  freshWitnesses: 2,
  lastCheckedSeconds: 480,
  ...over,
});

export const evidence = (over: Partial<ChangeRecord> = {}): ChangeRecord => ({
  witness: '0x01',
  site: 'swap.cow.fi',
  createdAtBlock: 4218077,
  path: FILE,
  oldHash: WIT_HASH,
  newHash: TAB_HASH,
  sizes: [3744304, 3746298],
  region: 'recipient:"0x96221423681a6d52e184d440a8efcebb105c7242",amount:',
  offset: 1061348,
  ...over,
});

export const attached = (v: Verdict, host = 'swap.cow.fi'): PopupState => ({ phase: 'attached', host, verdict: v, scriptsSeen: 56, updatedAt: NOW - 12_000 });

export const release = {
  ageSeconds: 5 * 3600,
  addrs: [{ value: A1, inTabUrl: true }, { value: A2, inTabUrl: false }],
  hosts: [{ value: 'relay-metrics.example', inTabUrl: false }],
  totals: { addrs: 14, hosts: 1 },
};

const third = { inline: 13, eval: 2, wasm: 1, frames: 1, thirdParty: [{ host: 'www.googletagmanager.com', scripts: 4 }, { host: 'widget.intercom.io', scripts: 1 }] };

/** Named samples of every state the popup can be in. */
export function allStates(host = 'swap.cow.fi'): Record<string, PopupState> {
  const a = (v: Partial<Verdict>) => attached(verdict(v), host);
  const cant = (reason: Verdict['cantCheckReason']) => a({ result: 'cantCheck', cantCheckReason: reason, witnessCount: 0, newestFileAgeSeconds: null, filesCompared: 0, freshWitnesses: 0, lastCheckedSeconds: null });
  return {
    idle: { phase: 'idle', host, listed: true, catalogueAgeSeconds: 360 },
    'idle, records unread': { phase: 'idle', host, listed: true, catalogueAgeSeconds: null },
    'idle, after Finish': { phase: 'idle', host, listed: true, catalogueAgeSeconds: 360, lastCheck: { result: 'matches', finishedAt: NOW - 240_000 } },
    'idle, unlisted': { phase: 'idle', host: 'www.example-dapp.xyz', listed: false, catalogueAgeSeconds: 360 },
    checking: { phase: 'checking', host, hashed: 31, total: 54, startedAt: NOW - 1000, catalogueAgeSeconds: 360 },
    matches: a({}),
    'matches, with a wallet installed': a({ extensionScripts: 2 }),
    'matches, with one extension script': a({ extensionScripts: 1 }),
    'changed, tab differs': a({ result: 'changed', changed: [{ path: FILE, tabHash: TAB_HASH, witnessedHashes: [WIT_HASH], evidence: evidence() }] }),
    'changed, two versions, no region': a({ result: 'changed', changed: [{ path: FILE, tabHash: TAB_HASH, witnessedHashes: [TAB_HASH, WIT_HASH], evidence: evidence({ region: null }) }] }),
    'changed, tab holds the original': a({ result: 'changed', changed: [{ path: FILE, tabHash: WIT_HASH, witnessedHashes: [WIT_HASH, TAB_HASH], original: true, evidence: evidence() }] }),
    'new code, nothing added': a({ result: 'newRelease', release: { ageSeconds: 600, addrs: [], hosts: [], totals: { addrs: 0, hosts: 0 } } }),
    'partial, one witness differs': a({ result: 'partial', disputed: [FILE] }),
    'not seen': a({ result: 'notSeen', notSeen: ['/_next/static/chunks/pages/transactions/queue-9ab40d17c26e5f83.js'], unknownHosts: ['metrics.cdn-relay-network-eu-west.example'] }),
    'new release': a({ result: 'newRelease', release }),
    'partial, uncompared': a({ result: 'partial', witnessCount: 2, filesCompared: 14, uncompared: third }),
    'partial, witnesses behind': a({ result: 'partial', freshWitnesses: 1, lastCheckedSeconds: 2280 }),
    'not seen, also partial': a({ result: 'notSeen', notSeen: ['/assets/late-4af8.js'], uncompared: { ...third, eval: 0, wasm: 0, thirdParty: [] } }),
    'new release, also partial': a({ result: 'newRelease', release: { ...release, addrs: [], totals: { addrs: 0, hosts: 1 } }, uncompared: { ...third, eval: 0, wasm: 0, frames: 0, thirdParty: [] } }),
    "can't check, not listed": cant('siteNotListed'),
    "can't check, stale": cant('catalogueStale'),
    "can't check, roster": cant('noRoster'),
    "can't check, no records": cant('noCatalogue'),
  };
}
