// Read-only: the catalogue query against live Rabdi. No key, nothing signed.
import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { http } from "viem"
const client = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http() })
const show = (v) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? `${x}n` : (typeof x === "string" && x.length > 90 ? x.slice(0, 66) + `...(${x.length} chars)` : x), 1)
const select = { $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, $attributes: true }
const first = await client.query("$key > key(0x0000000000000000000000000000000000000000000000000000000000000000)", { select: { $key: true, $creator: true, $attributes: true }, limit: 100 })
const creators = [...new Set(first.entities.map(e => e.$creator))]
const schemaOf = first.entities[0].$attributes["arkiv.schema"]?.value
console.log("creators in first page", creators, "schema", schemaOf)
const [w1, w2] = [creators[0], creators[1] ?? "0xEC6E879764725c30eca0DF033adAcDB58A05f632"]
const q = `arkiv.schema = str('${schemaOf}') AND ($creator = addr(${w1}) OR $creator = addr(${w2}))`
console.log("QUERY", q)
const t0 = performance.now()
const p1 = await client.query(q, { select, limit: 2, offset: 0, count: true })
console.log("page1", Math.round(performance.now() - t0), "ms", show({ count: p1.count, blockNumber: p1.blockNumber, skipped: p1.skipped, entities: p1.entities }))
const p2 = await client.query(q, { select: { $key: true }, limit: 2, offset: 2 })
console.log("page2 keys", show(p2.entities))
// the shape query from the task, with the witness addresses: expected empty
const empty = await client.query("arkiv.schema = str('sw.obs.v1') AND ($creator = addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821) OR $creator = addr(0xEC6E879764725c30eca0DF033adAcDB58A05f632))", { select, limit: 100, offset: 0 })
console.log("sw.obs.v1 w1/w2 rows", empty.entities.length, "at block", empty.blockNumber)
// Hunt for an entity holding a bytes attribute, and the largest available
let bytesRow, off = 0, biggest = 0, biggestRow
for (let i = 0; i < 40; i++, off += 100) {
  const r = await client.query("$key > key(0x0000000000000000000000000000000000000000000000000000000000000000)", { select: { $key: true, $attributeSchema: true, $attributes: true, $creator: true }, limit: 100, offset: off })
  if (!r.entities.length) break
  for (const e of r.entities) for (const [n, a] of Object.entries(e.$attributes)) if (a.type === "bytes") {
    bytesRow ??= { key: e.$key, name: n, a, schema: e.$attributes["arkiv.schema"]?.value, attrSchema: e.$attributeSchema }
    if (a.value.length > biggest) { biggest = a.value.length; biggestRow = { key: e.$key, name: n, schema: e.$attributes["arkiv.schema"]?.value } }
  }
}
console.log("bytes example", show(bytesRow), "biggest hex chars", biggest, biggestRow)
for (const [label, s] of [["NOT", "NOT ($creator = addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821))"], ["ne", "$creator != addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821)"], ["createdAt filter", "$createdAt > u64(1)"], ["updatedAt filter", "$updatedAt > u64(1)"]]) {
  try { const r = await client.query(s, { select: { $key: true }, limit: 1 }); console.log(label, "OK rows", r.entities.length) } catch (e) { console.log(label, "ERR", e.kind, e.shortMessage ?? e.message) }
}
console.log("timing", show(await client.getBlockTiming()))
