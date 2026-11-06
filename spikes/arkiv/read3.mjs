import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { bytes, defineSchema } from "@arkiv-network/sdk/schema"
import { custom } from "viem"
const chain = rabdi({ accessKey: "" }); const url = chain.rpcUrls.default.http[0]
const rpc = async (m, p) => { const r = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (r.error) throw new Error(`${r.error.code} ${r.error.message}`); return r.result }
const S = defineSchema("sw.gate.v1", { body: bytes() })
for (const kib of [120, 124, 126, 127, 128]) { let gas, msg
  const w = createWalletClient({ chain, account: "0x109F654eC9c3c235d2f49128f8FA373Bb3685821", transport: custom({ request: async ({ method, params }) => { if (method === "eth_estimateGas") { gas = BigInt(await rpc(method, params)); throw new Error("stop") } if (method.includes("send")) throw new Error("no send"); return rpc(method, params) } }) })
  try { await w.createEntity(S, { body: new Uint8Array(kib * 1024).map((_, i) => (i * 31 + 7) & 255) }, { expiration: ExpirationTime.fromDays(1) }) } catch (e) { msg = e.details ?? e.shortMessage ?? e.message }
  console.log(`create ${kib}KiB 1d`, gas ? `gas=${gas}` : msg) }
