import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { bytesToHex } from 'viem';
import { acceptObservation, encodeBody } from '../../core/src/entities.ts';
import { fetchCatalogue, rowToEntity } from '../src/index.ts';

const WITNESS = '0x109f654ec9c3c235d2f49128f8fa373bb3685821';
const HASH = 'a'.repeat(64);
const hex = (v: unknown) => bytesToHex(encodeBody(v));

function row(over: Record<string, unknown> = {}) {
  return {
    $key: '0x01',
    $creator: '0x109F654eC9c3c235d2f49128f8FA373Bb3685821',
    $createdAt: 10n,
    $updatedAt: 10n,
    $creationFlags: { readonly: true, permissionlessExtension: false, raw: 1 },
    $attributes: {
      'arkiv.schema': { type: 'str', value: 'sw.obs.v2' },
      site: { type: 'str', value: 'demo' },
      observedAt: { type: 'u64', value: 5n },
      body: { type: 'bytes', value: hex({ files: [['/a.js', HASH]], added: { addrs: [], hosts: [] }, totals: { addrs: 0, hosts: 0 } }) },
    },
    ...over,
  };
}

test('a good row becomes an accepted observation, with a checksummed creator lowercased', () => {
  const entity = rowToEntity(row())!;
  assert.equal(entity.creator, WITNESS);
  assert.equal(entity.createdAtBlock, 10);
  assert.equal(entity.attrs.site, 'demo');
  assert.equal(entity.attrs.body, undefined);
  const obs = acceptObservation(entity, new Set([WITNESS]));
  assert.deepEqual(obs?.files, [['/a.js', HASH]]);
});

test('an edited record is rejected after mapping', () => {
  const entity = rowToEntity(row({ $updatedAt: 11n }))!;
  assert.equal(acceptObservation(entity, new Set([WITNESS])), null);
});

test('a non-readonly record is rejected after mapping', () => {
  const entity = rowToEntity(row({ $creationFlags: { readonly: false, raw: 0 } }))!;
  assert.equal(acceptObservation(entity, new Set([WITNESS])), null);
});

test('a record from outside the roster is rejected', () => {
  assert.equal(acceptObservation(rowToEntity(row())!, new Set(['0x' + '1'.repeat(40)])), null);
});

test('malformed rows return null or fail acceptance without throwing', () => {
  assert.equal(rowToEntity({}), null);
  assert.equal(rowToEntity(row({ $attributes: undefined })), null);
  assert.equal(rowToEntity(row({ $creator: 7 })), null);
  const roster = new Set([WITNESS]);
  for (const value of ['0xzz', 'nope', 42, null, '0x', hex('a string'), hex({ files: 'x' })]) {
    const attrs = { site: { value: 'demo' }, body: { value } };
    const entity = rowToEntity(row({ $attributes: attrs }));
    if (entity) assert.equal(acceptObservation(entity, roster), null, String(value));
  }
});

test('block and time come from the same block, so a lagging query can not make an old heartbeat look new', async () => {
  // Queries answer from block 100 while the chain is at block 200, at time 1000.
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const { id, method } = JSON.parse(body);
      const result = method === 'arkiv_query' ? { data: [], blockNumber: '0x64' } : { number: '0xc8', timestamp: '0x3e8', hash: `0x${'1'.repeat(64)}`, transactions: [] };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address() as { port: number };
    const c = await fetchCatalogue(`http://127.0.0.1:${port}`, [{ label: 'w1', address: WITNESS }], 0);
    assert.equal(c.headBlock, 200);
    assert.equal(c.headTime, 1000);
  } finally {
    server.close();
  }
});
