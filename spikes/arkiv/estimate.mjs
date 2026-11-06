// Read-only: asks the node for eth_estimateGas on real SDK-encoded writes. Nothing is signed or sent.
import { createWalletClient, createPublicClient, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema"
import { custom, http } from "viem"

const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" })
const url = chain.rpcUrls.default.http[0]
const rpc = async (method, params) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
  const j = await r.json()
  if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error.data, code: j.error.code })
  return j.result
}
class Stop extends Error {}
function clientFor(address, sink) {
  return createWalletClient({
    chain, account: address,
    transport: custom({ request: async ({ method, params }) => {
      if (method === "eth_estimateGas") { sink.gas = BigInt(await rpc(method, params)); sink.dataBytes = (params[0].data ?? params[0].input).length / 2 - 1; throw new Stop("estimated") }
      if (method === "eth_sendRawTransaction" || method === "eth_sendTransaction") throw new Error("refusing to send")
      return rpc(method, params)
    } }),
  })
}
const Obs = defineSchema("sw.gate.v1", { site: str().indexed(), observedAt: u64().indexed(), body: bytes() })
const Status = defineSchema("sw.status.v1", { body: bytes() })
const w1 = "0x109F654eC9c3c235d2f49128f8FA373Bb3685821"

async function estCreate(size, days, readonly = true) {
  const sink = {}
  const c = clientFor(w1, sink)
  try {
    await c.createEntity(Obs, { site: "app.safe.global", observedAt: u64(1n), body: new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff) }, { expiration: ExpirationTime.fromDays(days), flags: { readonly } })
  } catch (e) { if (!sink.gas) return { error: e.shortMessage ?? e.message } }
  return sink
}
const gp = BigInt(await rpc("eth_gasPrice", []))
console.log("gasPrice", gp)
for (const [s, d] of [[0, 180], [1024, 180], [27 * 1024, 1], [27 * 1024, 30], [27 * 1024, 180], [64 * 1024, 180], [128 * 1024, 180]]) {
  const r = await estCreate(s, d)
  console.log(`create size=${s} days=${d}`, r.error ?? `gas=${r.gas} txData=${r.dataBytes} cost=${Number(r.gas * gp) / 1e18} tGLM`)
}
// A patch estimate needs a real patchable entity, so simulate from the owner of an existing one.
let patchable, offset = 0
for (let i = 0; i < 30 && !patchable; i++, offset += 100) {
  const q = await rpc("arkiv_query", ["$key > key(0x0000000000000000000000000000000000000000000000000000000000000000)", { select: { key: true, owner: true, creationFlags: true }, limit: "0x64", offset: "0x" + offset.toString(16) }])
  patchable = q.data.find(e => (Number(e.creationFlags?.raw ?? e.creationFlags) & 1) === 0)
  if (i === 0) console.log("sample flags shape", JSON.stringify(q.data[0]))
}
console.log("patchable sample", patchable?.key)
if (patchable) for (const size of [16, 256, 1024, 27 * 1024]) {
  const sink = {}
  try { await clientFor(patchable.owner, sink).patchEntity(Status, patchable.key, { set: { body: new Uint8Array(size).fill(7) } }) } catch (e) { if (!sink.gas) console.log("patch err", e.shortMessage ?? e.message) }
  if (sink.gas) console.log(`patch body=${size}`, `gas=${sink.gas} txData=${sink.dataBytes} cost=${Number(sink.gas * gp) / 1e18} tGLM`)
}
