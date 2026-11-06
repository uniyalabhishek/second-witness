// Addresses derived from .env, with their balances. Never prints a key.
// node --env-file=.env spikes/arkiv/balances.mjs
import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { createPublicClient as createEthClient, formatEther, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"

const arkiv = createPublicClient({ chain: rabdi({ accessKey: "" }), transport: http() })
const eth = createEthClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") })
const hex = (k) => (k.startsWith("0x") ? k : `0x${k}`)

for (const name of ["W1_KEY", "W2_KEY", "ENS_OWNER_KEY", "CI_KEY"]) {
  const { address } = privateKeyToAccount(hex(process.env[name]))
  const [tglm, wei] = await Promise.all([arkiv.getBalance({ address }), eth.getBalance({ address })])
  console.log(`${name.padEnd(14)} ${address}  ${formatEther(tglm)} tGLM  ${formatEther(wei)} Sepolia ETH`)
}
