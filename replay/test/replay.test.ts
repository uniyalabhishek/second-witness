import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runReplay } from '../run.ts';

const COLD = '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4';
const ALT = '0x19c6876e978d9f128147439ac4cd9ea2582cd141';
const IMPL = '0x96221423681a6d52e184d440a8efcebb105c7242';
const dir = new URL('../captures', import.meta.url).pathname;

test('committed replay output holds no full bundle', () => {
  const out = JSON.parse(readFileSync(new URL('../output.json', import.meta.url), 'utf8'));
  assert.ok(out.evidence.region.length <= 16 * 1024);
  assert.equal(out.steps.length, 7);
});

test('real Bybit captures: six identical, one altered, and the alert leads the theft by 44.7 hours', { skip: !existsSync(`${dir}/20250219172905.bin`) }, async () => {
  const out = await runReplay(dir);
  assert.equal(out.steps.filter(s => s.altered).length, 1);
  assert.equal(out.steps.filter(s => s.hash === out.evidence.cleanHash).length, 6);
  const first = out.steps.find(s => s.altered)!;
  assert.equal(first.hoursBeforeTheft, 44.7);
  assert.equal(out.evidence.bytesAdded, 1994);
  assert.deepEqual(out.steps.map(s => s.result), ['matches', 'matches', 'matches', 'matches', 'changed', 'changed', 'matches']);
});

test('real Bybit capture: the altered file as a new filename lists 5 added addresses including the cold wallet', { skip: !existsSync(`${dir}/20250219172905.bin`) }, async () => {
  const { asNewRelease } = await runReplay(dir);
  assert.equal(asNewRelease.totals.addrs, 5);
  assert.equal(asNewRelease.totals.hosts, 0);
  assert.equal(asNewRelease.knownAddrs, 72);
  for (const a of [COLD, ALT, IMPL]) assert.ok(asNewRelease.added.addrs.includes(a), a);
});
