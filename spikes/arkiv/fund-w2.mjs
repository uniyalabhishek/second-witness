// Moves testnet tGLM from w1 to w2, for when the faucet's cooldown blocks a second claim.
// node --env-file=.env spikes/arkiv/fund-w2.mjs 2
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { formatEther, http, parseEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const hex = (k) => (k.startsWith("0x") ? k : `0x${k}`)
const amount = process.argv[2]
if (!amount) throw new Error("Usage: fund-w2.mjs <tGLM>")

const chain = rabdi({ accessKey: "" })
const account = privateKeyToAccount(hex(process.env.W1_KEY))
const to = privateKeyToAccount(hex(process.env.W2_KEY)).address
const wallet = createWalletClient({ chain, transport: http(), account })
const pub = createPublicClient({ chain, transport: http() })

const hash = await wallet.sendTransaction({ to, value: parseEther(amount) })
const { status } = await pub.waitForTransactionReceipt({ hash })
console.log(`tx ${hash} ${status}`)
console.log(`w1 ${formatEther(await pub.getBalance({ address: account.address }))} tGLM`)
console.log(`w2 ${formatEther(await pub.getBalance({ address: to }))} tGLM`)
