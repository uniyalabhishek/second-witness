// P1: lets CI_KEY write only the `release` text key. node --env-file=.env ens/grant-release-key.mjs
import { encodeFunctionData, keccak256, stringToHex } from 'viem'
import { client, walletFromEnv, send, liveResolver, resolverAbi, OWNER, CI, RELEASE_KEY, ROLE_SET_TEXT } from './config.mjs'

const resolver = await liveResolver()
// Only the selector and the key matter here; the name and value are ignored.
const setter = encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: ['0x', RELEASE_KEY, ''] })
await send(walletFromEnv('ENS_OWNER_KEY', OWNER), {
  address: resolver, abi: resolverAbi, functionName: 'grantSetterRoles', args: [setter, CI],
})
const resource = BigInt(keccak256(stringToHex(RELEASE_KEY)))
const roles = (r) => client.readContract({ address: resolver, abi: resolverAbi, functionName: 'roles', args: [r, CI] })
console.log(`CI roles on "${RELEASE_KEY}": ${await roles(resource)} (16 is ROLE_SET_TEXT = ${ROLE_SET_TEXT})`)
console.log(`CI roles resolver-wide: ${await roles(0n)} (must be 0)`)
