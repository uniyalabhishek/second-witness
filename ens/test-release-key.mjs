// P1 proof: CI_KEY sets `release`, then every other write reverts. Each attempt is simulated, so reverts cost nothing.
// node --env-file=.env ens/test-release-key.mjs [hash]
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { client, walletFromEnv, send, liveResolver, resolverAbi, dns, subname, NAME, CI, RELEASE_KEY, ROLE_SET_TEXT } from './config.mjs'

const wallet = walletFromEnv('CI_KEY', CI)
const resolver = await liveResolver()
const value = process.argv[2] ?? `test-${Date.now()}`
const name = dns(NAME)

console.log(`Setting ${RELEASE_KEY} = ${value}`)
await send(wallet, { address: resolver, abi: resolverAbi, functionName: 'setText', args: [name, RELEASE_KEY, value] })
const read = await client.getEnsText({ name: NAME, key: RELEASE_KEY })
if (read !== value) throw new Error(`Read back ${read}`)
console.log(`Read through the Universal Resolver: ${read}`)

const attempts = [
  ['setText other key', 'setText', [name, 'description', 'x']],
  ['setAddress on w1', 'setAddress', [dns(subname('w1')), 60n, CI]],
  ['grantRootRoles to itself', 'grantRootRoles', [ROLE_SET_TEXT, CI]],
]
let failed = false
for (const [label, functionName, args] of attempts) {
  try {
    await client.simulateContract({ account: wallet.account, address: resolver, abi: resolverAbi, functionName, args })
    console.log(`FAIL ${label}: did not revert`)
    failed = true
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null
    const error = revert?.data?.errorName ?? revert?.signature ?? e.shortMessage
    console.log(`OK   ${label}: reverted with ${error}`)
  }
}
if (failed) process.exit(1)
