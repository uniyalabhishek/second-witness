// Read-only follow-ups: named-schema read, large page timing, raw NOT, recent tx receipts, size ceiling.
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { bytes, defineSchema } from "@arkiv-network/sdk/schema"
import { custom, http } from "viem"
const chain = rabdi({ accessKey: "" })
const url = chain.rpcUrls.default.http[0]
const client = createPublicClient({ chain, transport: http() })
const raw = async (method, params) => { const t=performance.now(); const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const text = await r.text(); return { ms: Math.round(performance.now()-t), status: r.status, size: text.length, enc: r.headers.get("content-encoding"), rl: r.headers.get("ratelimit"), cost: r.headers.get("arkiv-cost"), json: JSON.parse(text) } }
const show = (v) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? `${x}n` : (typeof x === "string" && x.length > 90 ? x.slice(0, 66) + `...(${x.length} chars)` : x), 1)
const select = { $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, $attributes: true }
const c = await client.query("arkiv.schema = str('afr.batch.v1')", { select: { $creator: true }, limit: 1, count: true })
console.log("afr.batch.v1 total", c.count, c.entities[0])
const cr = c.entities[0].$creator
const q = `arkiv.schema = str('afr.batch.v1') AND ($creator = addr(${cr}) OR $creator = addr(0xEC6E879764725c30eca0DF033adAcDB58A05f632))`
const p = await client.query(q, { select, limit: 1, offset: 0, count: true })
console.log("decoded", show({ count: p.count, blockNumber: p.blockNumber, skipped: p.skipped, entities: p.entities }))
const r100 = await raw("arkiv_query", [q, { select: { key: true, creator: true, createdAt: true, updatedAt: true, creationFlags: true, attributes: true }, limit: "0x64" }])
console.log("raw 100 rows", { ms: r100.ms, bytes: r100.size, status: r100.status, enc: r100.enc, rl: r100.rl, cost: r100.cost, rows: r100.json.result?.data?.length, err: r100.json.error, cursor: !!r100.json.result?.cursor })
const rows = r100.json.result?.data ?? []
if (rows[0]) console.log("raw row keys", Object.keys(rows[0]), JSON.stringify(rows[0].attributes ?? {}, (_, x) => typeof x === "string" && x.length > 60 ? x.slice(0,40)+"..." : x).slice(0, 400))
const sizes = rows.map(e => JSON.stringify(e).length).sort((a,b)=>a-b)
console.log("row size min/median/max", sizes[0], sizes[sizes.length>>1], sizes.at(-1))
const nt = await raw("arkiv_query", ["NOT ($creator = addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821))", { select: { key: true }, limit: "0x1" }])
console.log("raw NOT", nt.status, JSON.stringify(nt.json).slice(0, 300))
const nt2 = await raw("arkiv_query", ["arkiv.schema = str('afr.batch.v1') AND NOT ($creator = addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821))", { select: { key: true }, limit: "0x1" }])
console.log("raw AND NOT", nt2.status, JSON.stringify(nt2.json).slice(0, 300))
const head = await raw("eth_getBlockByNumber", ["latest", false])
console.log("block", { baseFee: BigInt(head.json.result.baseFeePerGas ?? 0), gasLimit: BigInt(head.json.result.gasLimit), number: BigInt(head.json.result.number) })
// Real writes in recent blocks
const n = Number(BigInt(head.json.result.number)); let seen = 0
for (let b = n; b > n - 400 && seen < 12; b -= 1) {
  const bl = (await raw("eth_getBlockByNumber", ["0x" + b.toString(16), true])).json.result
  for (const t of bl.transactions) { if (t.to?.toLowerCase() !== "0x4400000000000000000000000000000000000044" || seen >= 12) continue
    const rc = (await raw("eth_getTransactionReceipt", [t.hash])).json.result
    seen++; console.log("tx", t.hash.slice(0,12), "block", b, "inputBytes", (t.input.length-2)/2, "gasUsed", BigInt(rc.gasUsed), "effGasPrice", BigInt(rc.effectiveGasPrice), "status", rc.status, "baseFee", BigInt(bl.baseFeePerGas)) }
}
// Create size ceiling at 180 days via estimate only
const rpc = async (m, p) => { const r = await raw(m, p); if (r.json.error) throw new Error(r.json.error.message); return r.json.result }
const S = defineSchema("sw.gate.v1", { body: bytes() })
for (const kib of [80, 90, 100, 110, 128]) for (const d of [180, 30]) {
  let gas, msg
  const w = createWalletClient({ chain, account: "0x109F654eC9c3c235d2f49128f8FA373Bb3685821", transport: custom({ request: async ({ method, params }) => { if (method === "eth_estimateGas") { gas = BigInt(await rpc(method, params)); throw new Error("stop") } if (method.includes("send")) throw new Error("no send"); return rpc(method, params) } }) })
  try { await w.createEntity(S, { body: new Uint8Array(kib * 1024).map((_, i) => (i * 31 + 7) & 255) }, { expiration: ExpirationTime.fromDays(d) }) } catch (e) { msg = e.shortMessage ?? e.message }
  console.log(`create ${kib}KiB ${d}d`, gas ? `gas=${gas} over2^24=${gas*125n/100n > 2n**24n}` : msg)
}
