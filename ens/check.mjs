// Read-only, needs no key. Prints what the owner has and exactly what is missing. node ens/check.mjs
import { labelhash } from 'viem'
import {
  client, OWNER, LABEL, NAME, USDC, MOCK_USDC, DURATION, MIN_DURATION, ETH_REGISTRAR, ETH_REGISTRY, RESOLVER_IMPL,
  FACTORY, UNIVERSAL_RESOLVER, GAS_ALL_STEPS, ETH_TO_REQUEST, registrarAbi, usdcAbi, registryAbi, usd, eth, loadDeployment,
} from './config.mjs'

for (const [label, address] of Object.entries({ ETH_REGISTRAR, ETH_REGISTRY, RESOLVER_IMPL, FACTORY, UNIVERSAL_RESOLVER, USDC, MOCK_USDC })) {
  const code = await client.getCode({ address })
  if (!code) throw new Error(`${label} ${address} has no code on Sepolia. The deployment moved: re-check the docs.`)
}
console.log('All contracts have code.')

const read = (functionName, args) => client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName, args })
const available = await read('isAvailable', [LABEL])
const ethBalance = await client.getBalance({ address: OWNER })
const balanceOf = (address) => client.readContract({ address, abi: usdcAbi, functionName: 'balanceOf', args: [OWNER] })
const [circle, mock] = await Promise.all([balanceOf(USDC), balanceOf(MOCK_USDC)])
const gasPrice = await client.getGasPrice()

console.log(`Owner ${OWNER}`)
console.log(`  ETH:           ${eth(ethBalance)}`)
console.log(`  Circle USDC:   ${usd(circle)}`)
console.log(`  MockUSDC:      ${usd(mock)} (mintable by anyone, register.mjs mints it if needed)`)
console.log(`Gas price now:   ${gasPrice} wei; the whole sequence (${GAS_ALL_STEPS} gas) costs ${eth(GAS_ALL_STEPS * gasPrice)} at this price`)
console.log(`${NAME} available: ${available}`)

if (!available) {
  const state = await client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: 'getState', args: [BigInt(labelhash(LABEL))] })
  console.log(`  held by ${state.latestOwner}, expires ${new Date(Number(state.expiry) * 1000).toISOString()}`)
  console.log(state.latestOwner.toLowerCase() === OWNER.toLowerCase() ? 'Registered by us. Nothing to fund.' : 'MISSING: the name belongs to someone else. Pick another label.')
  process.exit(0)
}

const price = await read('getRegisterPrice', [LABEL, DURATION, USDC])
const minPrice = await read('getRegisterPrice', [LABEL, MIN_DURATION, USDC])
console.log(`Price: ${usd(price)} for ${DURATION / 86400n} days; the 28-day minimum is ${usd(minPrice)}`)
console.log('Saved state:', loadDeployment())

const missingEth = ETH_TO_REQUEST > ethBalance ? ETH_TO_REQUEST - ethBalance : 0n
console.log(missingEth ? `MISSING: ${eth(missingEth)} to reach the ${eth(ETH_TO_REQUEST)} target.` : 'ETH: enough.')
console.log(circle >= price || mock >= price
  ? 'Payment token: enough.'
  : `Payment token: none needed up front. register.mjs mints ${usd(price)} MockUSDC. Using Circle USDC instead needs ${usd(price - circle)} more.`)
