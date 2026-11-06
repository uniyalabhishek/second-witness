import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema"
import { eq, or } from "@arkiv-network/sdk/query"
import { addr } from "@arkiv-network/sdk/schema"
import { http } from "viem"
const c = createPublicClient({ chain: rabdi({ accessKey: "" }), transport: http() })
const k = "0x7b9b94166dbb272fa3eb06dcf6d34affce13e2728d20f1cb2969cbda8978c4c6"
const S = defineSchema("afr.batch.v1", { epoch_id: u64(), frame: bytes(), agent_key: str() })
const e = await c.getEntity(k, S)
console.log("getEntity typed", Object.keys(e).join(","), e.epoch_id, e.frame.type, e.frame.value.length)
const a = "0x952dB75Bb45C1D17a1ba30B3eAAC83614cBb35aF", b = "0xEC6E879764725c30eca0DF033adAcDB58A05f632"
const p = await c.select({ $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, epoch_id: true, frame: true }).from(S).where(or(eq("$creator", addr(a)), eq("$creator", addr(b)))).limit(100).offset(0).fetch().catch(x => ({ err: x.message }))
console.log("builder", p.err ?? { rows: p.entities.length, skipped: p.skipped, block: p.blockNumber, row0keys: Object.keys(p.entities[0] ?? {}), epoch: p.entities[0]?.epoch_id })
try { await c.getEntity("0x"+"11".repeat(32)) } catch (x) { console.log("missing", x.constructor.name, x.message) }
