// Runs every script against a local anvil fork of Sepolia with impersonated accounts: nothing is signed or sent to
// the real network. Its gas figures understate live Sepolia: use simulate.mjs for those. Usage: anvil on PATH, then node ens/dry-run.mjs [--circle]
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, rmSync } from 'node:fs'
import { createPublicClient, http, keccak256, encodeAbiParameters, pad, toHex } from 'viem'
import { sepolia } from 'viem/chains'

const PORT = 8599
const RPC = `http://127.0.0.1:${PORT}`
const UPSTREAM = 'https://ethereum-sepolia-rpc.publicnode.com'
const OWNER = '0x73F73764221642767346706e8A82Cdd823eC9e24'
const CI = '0x05883068E04ccC18039A81D96AD899D7eaA6E6a2'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const dir = fileURLToPath(new URL('.', import.meta.url))
const deployment = `${dir}deployment.json`
if (existsSync(deployment)) throw new Error('ens/deployment.json exists. Dry-run only runs before the real registration.')

const upstream = createPublicClient({ chain: sepolia, transport: http(UPSTREAM) })
const forkBlock = (await upstream.getBlockNumber()) - 8n
const anvil = spawn('anvil', ['--port', PORT, '--fork-url', UPSTREAM, '--fork-block-number', forkBlock, '--chain-id', 11155111, '--hardfork', 'prague', '--block-time', 2, '--silent'].map(String), { stdio: 'ignore' })
const fork = createPublicClient({ chain: sepolia, transport: http(RPC) })
const rpc = (method, ...params) => fork.request({ method, params })
try {
  for (let i = 0; ; i++) {
    try { await fork.getBlockNumber(); break } catch (e) { if (i > 30) throw e; await new Promise((r) => setTimeout(r, 500)) }
  }
  for (const a of [OWNER, CI]) {
    await rpc('anvil_setBalance', a, toHex(10n ** 18n))
    await rpc('anvil_impersonateAccount', a)
  }
  if (process.argv.includes('--circle')) {
    // Circle's FiatToken keeps balances at mapping slot 9 (checked with a state-override balanceOf).
    const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [OWNER, 9n]))
    await rpc('anvil_setStorageAt', USDC, slot, pad(toHex(100_000_000n)))
  }
  const env = { ...process.env, SEPOLIA_RPC: RPC, ENS_FORK_IMPERSONATE: '1' }
  const steps = [
    ['register.mjs'], ['register.mjs'], ['read-roster.mjs'],
    ['set-witness.mjs', 'w1', '0x109F654eC9c3c235d2f49128f8FA373Bb3685821'],
    ['set-witness.mjs', 'w2', '0xEC6E879764725c30eca0DF033adAcDB58A05f632'],
    ['read-roster.mjs'], ['clear-witness.mjs', 'w2'], ['read-roster.mjs'],
    ['set-witness.mjs', 'w2', '0xEC6E879764725c30eca0DF033adAcDB58A05f632'],
    ['grant-release-key.mjs'], ['test-release-key.mjs', 'abc123'], ['check.mjs'],
  ]
  for (const [script, ...args] of steps) {
    console.log(`\n=== ${script} ${args.join(' ')}`)
    const { status } = spawnSync('node', [`${dir}${script}`, ...args], { env, stdio: 'inherit' })
    if (status !== 0) throw new Error(`${script} exited ${status}`)
  }
  console.log('\nDRY RUN PASSED')
} finally {
  anvil.kill()
  if (existsSync(deployment)) rmSync(deployment) // Fork addresses mean nothing on Sepolia.
}
