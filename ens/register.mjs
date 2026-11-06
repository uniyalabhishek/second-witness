// Idempotent and resumable: deploy resolver, commit, wait, approve, register. Rerun after any failure.
// node --env-file=.env ens/register.mjs
import { randomBytes } from 'node:crypto'
import { getAddress, labelhash, parseEventLogs, toHex } from 'viem'
import {
  client, walletFromEnv, send, OWNER, LABEL, NAME, DURATION, USDC, MOCK_USDC, FACTORY, RESOLVER_IMPL, ETH_REGISTRAR, ETH_REGISTRY,
  ZERO_ADDRESS, ZERO_BYTES32, registrarAbi, registryAbi, factoryAbi, usdcAbi, resolverSalt, resolverInitData, loadDeployment, saveDeployment, usd,
} from './config.mjs'

const wallet = walletFromEnv('ENS_OWNER_KEY', OWNER)
const deployment = loadDeployment()
const read = (functionName, args) => client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName, args })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!(await read('isAvailable', [LABEL]))) {
  const state = await client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: 'getState', args: [BigInt(labelhash(LABEL))] })
  if (state.latestOwner.toLowerCase() !== OWNER.toLowerCase()) throw new Error(`${NAME} is held by ${state.latestOwner}`)
  console.log(`${NAME} is already ours, expires ${new Date(Number(state.expiry) * 1000).toISOString()}. Nothing to do.`)
  process.exit(0)
}

// 1. Resolver proxy. The salt is fixed per owner, so a second deploy would revert: reuse the saved one.
if (deployment.resolver && await client.getCode({ address: deployment.resolver })) {
  console.log(`1. Resolver already deployed: ${deployment.resolver}`)
} else {
  console.log('1. Deploying PermissionedResolver via the factory')
  const receipt = await send(wallet, {
    address: FACTORY, abi: factoryAbi, functionName: 'deployProxy',
    args: [RESOLVER_IMPL, resolverSalt(OWNER), resolverInitData(OWNER)],
  })
  const [log] = parseEventLogs({ abi: factoryAbi, eventName: 'ProxyDeployed', logs: receipt.logs })
  deployment.resolver = getAddress(log.args.proxyAddress)
  saveDeployment(deployment)
  console.log(`  resolver ${deployment.resolver}`)
}

// 2. Commit. The secret and duration are saved because the reveal must use the same values.
deployment.secret ??= toHex(randomBytes(32))
deployment.durationSeconds ??= DURATION.toString()
saveDeployment(deployment)
const duration = BigInt(deployment.durationSeconds)
const commitment = await read('makeCommitment', [LABEL, OWNER, deployment.secret, ZERO_ADDRESS, deployment.resolver, duration, ZERO_BYTES32])
const [minAge, maxAge] = await Promise.all([read('MIN_COMMITMENT_AGE'), read('MAX_COMMITMENT_AGE')])
let committedAt = await read('commitmentAt', [commitment])
const now = async () => (await client.getBlock()).timestamp
if (committedAt === 0n || (await now()) > committedAt + maxAge) {
  console.log('2. Committing')
  await send(wallet, { address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'commit', args: [commitment] })
  committedAt = await read('commitmentAt', [commitment])
} else {
  console.log(`2. Commitment already on chain, made at ${committedAt}`)
}

// 3. Wait on chain time: simulation runs against the latest block, which can trail the wall clock.
while ((await now()) <= committedAt + minAge) {
  console.log(`3. Waiting for commitment age ${minAge}s...`)
  await sleep(6000)
}

// 4. Pay with Circle USDC if the owner has enough, otherwise mint MockUSDC.
const token = await (async () => {
  const price = await read('getRegisterPrice', [LABEL, duration, USDC])
  const balance = (address) => client.readContract({ address, abi: usdcAbi, functionName: 'balanceOf', args: [OWNER] })
  if (await balance(USDC) >= price) return USDC
  if (await balance(MOCK_USDC) < price) {
    console.log(`4a. Minting ${usd(price)} MockUSDC`)
    await send(wallet, { address: MOCK_USDC, abi: usdcAbi, functionName: 'mint', args: [OWNER, price] })
  }
  return MOCK_USDC
})()
const price = await read('getRegisterPrice', [LABEL, duration, token])
const allowance = await client.readContract({ address: token, abi: usdcAbi, functionName: 'allowance', args: [OWNER, ETH_REGISTRAR] })
if (allowance < price) {
  console.log(`4. Approving ${usd(price)} of ${token}`)
  await send(wallet, { address: token, abi: usdcAbi, functionName: 'approve', args: [ETH_REGISTRAR, price] })
} else {
  console.log('4. Allowance already set')
}

// 5. Register. No subregistry: children resolve as records on this name's resolver.
console.log(`5. Registering ${NAME}`)
await send(wallet, {
  address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'register',
  args: [LABEL, OWNER, deployment.secret, ZERO_ADDRESS, deployment.resolver, duration, token, ZERO_BYTES32],
})
deployment.registeredWith = token
delete deployment.secret // Only needed until the reveal.
saveDeployment(deployment)
console.log(`Done. ${NAME} resolver ${deployment.resolver}`)
