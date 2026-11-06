// Shared config for the ENSv2 scripts. Addresses come from the "Sepolia (ENSv2)" table at
// https://docs.ens.domains/learn/deployments.
// Do not copy addresses or ABIs from contracts-v2 HEAD: that is a different deployment.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  createPublicClient, createWalletClient, http, parseAbi, toHex, keccak256, stringToHex,
  encodeAbiParameters, encodeFunctionData, formatUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'

export const RPC = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'

export const NAME = 'secondwitness.eth'
export const LABEL = 'secondwitness'
export const OWNER = '0x73F73764221642767346706e8A82Cdd823eC9e24'
export const ROSTER = ['w1', 'w2', 'w3', 'w4', 'w5']

export const ETH_REGISTRAR = '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3'
export const ETH_REGISTRY = '0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4'
export const RESOLVER_IMPL = '0x115eb53f0c60696633855f90b138178fb40b2b2c'
export const FACTORY = '0xda70306c98e97ece36f997a21368e53298572991'
export const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' // Circle's Sepolia USDC, needs the faucet
// The docs' MockUSDC for this deployment. The oracle accepts it and anyone can mint it. Other "MockUSDC"
// addresses (0x16f95d..., 0xd332..., 0xba11...) are rejected.
export const MOCK_USDC = '0x240b0316df57887dbbe58b586508b19e633a14aa'

// One year, so the roster outlives judging. Override with ENS_DURATION_DAYS (minimum 28).
export const DURATION = BigInt(process.env.ENS_DURATION_DAYS ?? 365) * 86400n
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ZERO_BYTES32 = `0x${'00'.repeat(32)}`
// Every role and admin nybble, as in the docs' Verifiable Factory example.
export const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n

export const registrarAbi = parseAbi([
  'function isAvailable(string label) view returns (bool)',
  'function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256)',
  'function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)',
  'function commitmentAt(bytes32 commitment) view returns (uint64)',
  'function commit(bytes32 commitment)',
  'function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)',
  'function MIN_COMMITMENT_AGE() view returns (uint64)',
  'function MAX_COMMITMENT_AGE() view returns (uint64)',
  'error NameNotAvailable(string label)',
  'error UnexpiredCommitmentExists(bytes32 commitment)',
  'error CommitmentTooNew(bytes32 commitment, uint64 validFrom, uint64 blockTimestamp)',
  'error CommitmentTooOld(bytes32 commitment, uint64 validTo, uint64 blockTimestamp)',
  'error DurationTooShort(uint64 duration, uint64 minDuration)',
  'error InvalidOwner(address owner)',
])

export const factoryAbi = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address)',
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
])

export const resolverAbi = parseAbi([
  'function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)',
  'function setAddress(bytes name, uint256 coinType, bytes addressBytes)',
  'error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)',
  'error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)',
  'error EACRootResourceNotAllowed()',
  'error EACInvalidRoleBitmap(uint256 roleBitmap)',
  'error InvalidEVMAddress(bytes addressBytes)',
])

export const registryAbi = parseAbi([
  'function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
  'function getResolver(string label) view returns (address)',
])

export const usdcAbi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

export const dns = (name) => toHex(packetToBytes(name))
export const subname = (label) => `${label}.${NAME}`

// Salt scheme from the docs: keccak256("OwnedResolver", owner, version). Stable, so resuming finds the same proxy.
export const resolverSalt = (owner, version = 0n) => BigInt(keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
  [keccak256(stringToHex('OwnedResolver')), owner, version],
)))

export const resolverInitData = (owner) => encodeFunctionData({
  abi: resolverAbi, functionName: 'initialize',
  args: [[{ account: owner, roleBitmap: ALL_ROLES }], []],
})

export const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

// Never log the key or the account object's internals. Only the address leaves this function.
export function walletFromEnv(envName, expected) {
  const key = process.env[envName]
  if (!key) throw new Error(`${envName} is not set. Run with: node --env-file=.env ens/<script>.mjs`)
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
  if (expected && account.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${envName} derives ${account.address}, expected ${expected}`)
  }
  return createWalletClient({ account, chain: sepolia, transport: http(RPC) })
}

const DEPLOYMENT = new URL('./deployment.json', import.meta.url)
export const loadDeployment = () => existsSync(DEPLOYMENT) ? JSON.parse(readFileSync(DEPLOYMENT, 'utf8')) : {}
export const saveDeployment = (d) => writeFileSync(DEPLOYMENT, `${JSON.stringify(d, null, 2)}\n`)
// Writes must target the resolver the name is configured with: records on any other resolver never resolve.
export async function liveResolver() {
  const resolver = await client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [LABEL] })
  if (resolver === ZERO_ADDRESS) throw new Error(`${NAME} has no resolver yet. Run ens/register.mjs first.`)
  return resolver
}

// Simulates first, so a doomed call reverts here with a decoded error and costs nothing.
export async function send(wallet, request) {
  const { request: req } = await client.simulateContract({ account: wallet.account, ...request })
  const hash = await wallet.writeContract(req)
  console.log(`  sent ${request.functionName}: ${hash}`)
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${request.functionName} reverted: ${hash}`)
  console.log(`  mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`)
  return receipt
}

export const usd = (v) => `${formatUnits(v, 6)} USDC`
