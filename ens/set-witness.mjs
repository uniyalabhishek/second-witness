// node --env-file=.env ens/set-witness.mjs w1 0x...
import { getAddress, isAddress } from 'viem'
import { client, walletFromEnv, send, liveResolver, resolverAbi, dns, subname, OWNER } from './config.mjs'

const [label, address] = process.argv.slice(2)
if (!/^w[0-9]+$/.test(label ?? '') || !isAddress(address ?? '')) throw new Error('Usage: set-witness.mjs <w1|w2|...> <address>')
const name = subname(label)
await send(walletFromEnv('ENS_OWNER_KEY', OWNER), {
  address: await liveResolver(), abi: resolverAbi, functionName: 'setAddress', args: [dns(name), 60n, getAddress(address)],
})
console.log(`${name} now resolves to ${await client.getEnsAddress({ name })}`)
