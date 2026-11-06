import type { Catalogue } from '../../core/src/types.ts';

export const NOW = 1_800_000_000_000;
export const W1 = '0x4a7f09c1e3d25b68f0a1c97e2d46b8350fe1a7c2';
export const W2 = '0xc25d81e6b04f93a7d12e6c08f5ab97341d60e8fb';
const HEAD = 4_218_077;
const none = { added: { addrs: [], hosts: [] }, addedTotals: { addrs: 0, hosts: 0 } };

/** Head block is 2 seconds old at NOW-free offset: fetchedAt equals NOW, so ages come from blocks only. */
export const catalogue = (): Catalogue => ({
  fetchedAt: NOW,
  headBlock: HEAD,
  headTime: NOW / 1000,
  roster: [{ label: 'w1', address: W1 }, { label: 'w2', address: W2 }],
  observations: [
    { witness: W1, site: 'swap.cow.fi', createdAtBlock: HEAD - 600, files: [['/static/a-AAAAAAAA.js', 'h1'], ['/static/b-BBBBBBBB.js', 'h2'], ['/static/lone.js', 'h3']], ...none },
    { witness: W2, site: 'swap.cow.fi', createdAtBlock: HEAD - 300, files: [['/static/a-AAAAAAAA.js', 'h1'], ['/static/b-BBBBBBBB.js', 'h2']], ...none },
    { witness: W1, site: 'revoke.cash', createdAtBlock: HEAD - 100, files: [['/_next/static/immutable/x.js', 'h9']], ...none },
  ],
  changes: [
    { witness: W1, site: 'swap.cow.fi', createdAtBlock: HEAD - 60, path: '/assets/app-3f91c2ab7d104e66.js', oldHash: '7c1e04d9a2b86f3350de91ac44f7b218', newHash: 'e20b6fa1794cd8530a1fe37b92c6d04e', sizes: [48210, 48210], region: 'recipient:"0x96221423681a6d52e184d440a8efcebb105c7242",amount:', offset: 100 },
    { witness: W2, site: 'swap.cow.fi', createdAtBlock: HEAD - 58, path: '/assets/app-3f91c2ab7d104e66.js', oldHash: '7c1e04d9a2b86f3350de91ac44f7b218', newHash: 'e20b6fa1794cd8530a1fe37b92c6d04e', sizes: [48210, 48210], region: null, offset: null },
    { witness: W1, site: 'revoke.cash', createdAtBlock: HEAD - 90000, path: '/_next/static/chunks/8127-a04de91f37c2b65e.js', oldHash: '0d4c8f12ba6e7395c1e04af8d2763b91', newHash: '93fa17c05e2d86b4a7013ce9f4d8b260', sizes: [10, 20], region: null, offset: null },
  ],
  statuses: [
    { witness: W1, updatedAtBlock: HEAD - 120, ok: ['swap.cow.fi'] },
    { witness: W2, updatedAtBlock: HEAD - 240, ok: ['swap.cow.fi'] },
  ],
});
