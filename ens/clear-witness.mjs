// Revokes a witness. node --env-file=.env ens/clear-witness.mjs w1
import { client, walletFromEnv, send, liveResolver, resolverAbi, dns, subname, OWNER } from './config.mjs'

const [label] = process.argv.slice(2)
if (!/^w[0-9]+$/.test(label ?? '')) throw new Error('Usage: clear-witness.mjs <w1|w2|...>')
const name = subname(label)
await send(walletFromEnv('ENS_OWNER_KEY', OWNER), {
  address: await liveResolver(), abi: resolverAbi, functionName: 'setAddress', args: [dns(name), 60n, '0x'],
})
console.log(`${name} now resolves to ${await client.getEnsAddress({ name })}`)
