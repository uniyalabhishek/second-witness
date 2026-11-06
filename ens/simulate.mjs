// Replays the whole sequence on the real Sepolia state with eth_simulateV1: state overrides give the owner ETH,
// and nothing is signed or sent. Unlike dry-run.mjs (anvil), it uses the live chain's real gas rules.
// node ens/simulate.mjs
import { encodeFunctionData as enc, decodeFunctionResult, decodeAbiParameters, namehash, parseAbi, concat, keccak256, encodeAbiParameters, getCreate2Address, formatEther, stringToHex } from 'viem'
import {
  client, OWNER, CI, LABEL, NAME, WITNESSES, RELEASE_KEY, DURATION, MOCK_USDC, FACTORY, RESOLVER_IMPL, ETH_REGISTRAR, UNIVERSAL_RESOLVER,
  ZERO_ADDRESS, ZERO_BYTES32, factoryAbi, registrarAbi, resolverAbi, usdcAbi, resolverSalt, resolverInitData, dns, subname,
} from './config.mjs'

const urAbi = parseAbi(['function resolve(bytes name, bytes data) view returns (bytes, address)'])
const addrAbi = parseAbi(['function addr(bytes32 node) view returns (address)'])
const textAbi = parseAbi(['function text(bytes32 node, string key) view returns (string)'])
const logic = await client.readContract({ address: FACTORY, abi: parseAbi(['function proxyLogic() view returns (address)']), functionName: 'proxyLogic' })
const outer = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [OWNER, resolverSalt(OWNER)]))
const resolver = getCreate2Address({
  from: FACTORY, salt: outer,
  bytecodeHash: keccak256(concat(['0x3d604d80600a3d3981f3363d3d373d3d3d363d73', logic, '0x5af43d82803e903d91602b57fd5bf3', outer])),
})
const secret = `0x${'ab'.repeat(32)}`
const reg = (functionName, args) => client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName, args })
const commitment = await reg('makeCommitment', [LABEL, OWNER, secret, ZERO_ADDRESS, resolver, DURATION, ZERO_BYTES32])
const price = await reg('getRegisterPrice', [LABEL, DURATION, MOCK_USDC])

const tx = (from, to, abi, functionName, args) => ({ from, to, data: enc({ abi, functionName, args }) })
const res = (...a) => tx(OWNER, resolver, resolverAbi, ...a)
const readAddr = (label) => ({ to: UNIVERSAL_RESOLVER, data: enc({ abi: urAbi, functionName: 'resolve', args: [dns(subname(label)), enc({ abi: addrAbi, functionName: 'addr', args: [namehash(subname(label))] })] }) })
const readText = (key) => ({ to: UNIVERSAL_RESOLVER, data: enc({ abi: urAbi, functionName: 'resolve', args: [dns(NAME), enc({ abi: textAbi, functionName: 'text', args: [namehash(NAME), key] })] }) })
const setter = enc({ abi: resolverAbi, functionName: 'setText', args: ['0x', RELEASE_KEY, ''] })

const first = [
  ['deploy resolver', tx(OWNER, FACTORY, factoryAbi, 'deployProxy', [RESOLVER_IMPL, resolverSalt(OWNER), resolverInitData(OWNER)])],
  ['commit', tx(OWNER, ETH_REGISTRAR, registrarAbi, 'commit', [commitment])],
]
const second = [
  ['mint MockUSDC', tx(OWNER, MOCK_USDC, usdcAbi, 'mint', [OWNER, price])],
  ['approve', tx(OWNER, MOCK_USDC, usdcAbi, 'approve', [ETH_REGISTRAR, price])],
  ['register', tx(OWNER, ETH_REGISTRAR, registrarAbi, 'register', [LABEL, OWNER, secret, ZERO_ADDRESS, resolver, DURATION, MOCK_USDC, ZERO_BYTES32])],
  ['read w1 before set', readAddr('w1')],
  ['set w1', res('setAddress', [dns(subname('w1')), 60n, WITNESSES.w1])],
  ['set w2', res('setAddress', [dns(subname('w2')), 60n, WITNESSES.w2])],
  ['read w1', readAddr('w1')],
  ['clear w2', res('setAddress', [dns(subname('w2')), 60n, '0x'])],
  ['read w2 after clear', readAddr('w2')],
  ['read w3, never set', readAddr('w3')],
  ['grant release key', res('grantSetterRoles', [setter, CI])],
  ['CI sets release', tx(CI, resolver, resolverAbi, 'setText', [dns(NAME), RELEASE_KEY, 'abc123'])],
  ['read release', readText(RELEASE_KEY)],
  ['CI sets description (must revert)', tx(CI, resolver, resolverAbi, 'setText', [dns(NAME), 'description', 'x'])],
  ['owner grantRoles (must revert)', res('grantRoles', [BigInt(keccak256(stringToHex(RELEASE_KEY))), 16n, CI])],
]
const latest = await client.getBlock()
const body = {
  blockStateCalls: [
    { stateOverrides: { [OWNER]: { balance: '0xde0b6b3a7640000' }, [CI]: { balance: '0xde0b6b3a7640000' } }, calls: first.map(([, c]) => c) },
    { blockOverrides: { time: `0x${(latest.timestamp + 90n).toString(16)}` }, calls: second.map(([, c]) => c) },
  ],
  validation: false,
}
const blocks = await client.request({ method: 'eth_simulateV1', params: [body, 'latest'] })
const steps = [...first, ...second]
const results = blocks.flatMap((b) => b.calls)
let total = 0n
steps.forEach(([label, call], i) => {
  const r = results[i]
  const gas = BigInt(r.gasUsed)
  const ok = BigInt(r.status) === 1n
  if (call.from && ok) total += gas
  let out = ''
  if (!call.from && ok) {
    const [data] = decodeFunctionResult({ abi: urAbi, functionName: 'resolve', data: r.returnData })
    out = label === 'read release' ? decodeAbiParameters([{ type: 'string' }], data)[0] : decodeAbiParameters([{ type: 'address' }], data)[0]
  }
  if (!ok) out = `reverted ${r.returnData?.slice(0, 10) ?? ''} ${r.error?.message ?? ''}`
  console.log(`${label.padEnd(36)} ${ok ? 'ok ' : 'REV'} gas ${String(gas).padStart(8)} ${out}`)
})
console.log(`\nResolver would deploy at ${resolver}`)
console.log(`Gas for all successful writes: ${total}`)
console.log(`Live gas price ${await client.getGasPrice()} wei; at 1 gwei that is ${formatEther(total * 10n ** 9n)} ETH, at 20 gwei ${formatEther(total * 20n * 10n ** 9n)} ETH`)
