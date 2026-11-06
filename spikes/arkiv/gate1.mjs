// Gate 1: Arkiv write, patch, read-back, immutability and catalogue download on Rabdi.
// Run: node --env-file=.env spikes/arkiv/gate1.mjs
// Needs W1_KEY. Exits 0 without writing if W1 has no tGLM. Keys are never printed.
// ARKIV_ACCESS_KEY is optional. Set GATE1_FORCE_LOAD=1 to write the 100 load rows below the balance floor.
import { createPublicClient, createWalletClient, EntityMutationError, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema"
import { formatEther, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const BODY_BYTES = 27 * 1024
const LOAD_ROWS = 100
const LOAD_PER_TX = 8 // about 1.2M gas each at 1 day, and one tx carries at most 2^24 gas
const LOAD_MIN_BALANCE = 150_000_000_000_000_000n // 0.15 tGLM: 100 rows at 1 day estimate at about 0.12

const key = process.env.W1_KEY
if (!key) {
  console.log("RESULT W1_KEY is not set. Run with: node --env-file=.env spikes/arkiv/gate1.mjs")
  process.exit(0)
}
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`)
const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" })
const pub = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({ chain, transport: http(), account })

const Gate = defineSchema("sw.gate.v1", { site: str().indexed(), observedAt: u64().indexed(), body: bytes() })
const Status = defineSchema("sw.gate.status.v1", { body: bytes() })

const results = []
function record(status, name, detail = "") {
  results.push({ status, name })
  console.log(`${status} ${name}${detail ? `: ${detail}` : ""}`)
}
async function step(name, fn) {
  try {
    return await fn()
  } catch (e) {
    record("FAIL", name, describe(e))
    return undefined
  }
}
function describe(e) {
  const kind = e?.constructor?.name ?? "Error"
  const hash = e?.txHash ? ` txHash=${e.txHash}` : ""
  return `${kind}: ${e?.shortMessage ?? e?.message ?? e}${hash}`
}
async function cost(label, txHash) {
  const r = await wallet.getTransactionReceipt({ hash: txHash })
  const fee = r.gasUsed * r.effectiveGasPrice
  console.log(`RESULT gas ${label}: gasUsed=${r.gasUsed} price=${r.effectiveGasPrice} wei cost=${formatEther(fee)} tGLM status=${r.status} tx=${txHash}`)
  return r
}
const pattern = (n, seed) => {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out.subarray(0, Math.min(n, 65536)))
  for (let i = 65536; i < n; i++) out[i] = (out[i - 65536] + seed) & 0xff
  return out
}
const toHex = (u8) => `0x${Buffer.from(u8).toString("hex")}`

const balance = await pub.getBalance({ address: account.address })
console.log(`RESULT w1=${account.address} balance=${formatEther(balance)} tGLM`)
if (balance === 0n) {
  console.log("RESULT w1 balance is zero: nothing written. Fund it at https://hub.arkiv.network/faucet and run again.")
  process.exit(0)
}

// 1. Create a readonly 27 KB entity.
const body = pattern(BODY_BYTES, 1)
const obs = await step("create readonly 27 KB", async () => {
  const r = await wallet.createEntity(
    Gate,
    { site: "gate1.example", observedAt: u64(BigInt(Math.floor(Date.now() / 1000))), body },
    { expiration: ExpirationTime.fromDays(180), flags: { readonly: true } },
  )
  record("PASS", "create readonly 27 KB", `key=${r.entityKey} expiresAt=${r.expiresAt}`)
  await cost("create readonly 27 KB 180d", r.txHash)
  return r
})

// 2. Create and patch a status entity.
const statusBody = new TextEncoder().encode(JSON.stringify({ ok: ["app.safe.global", "swap.cow.fi", "revoke.cash"] }))
const status = await step("create status", async () => {
  const r = await wallet.createEntity(Status, { body: statusBody }, { expiration: ExpirationTime.fromDays(180) })
  record("PASS", "create status", `key=${r.entityKey}`)
  await cost("create status 180d", r.txHash)
  return r
})
let patched = false
if (status) {
  await step("patch status", async () => {
    const r = await wallet.patchEntity(Status, status.entityKey, { set: { body: statusBody } })
    patched = true
    record("PASS", "patch status")
    await cost("patch status, same size body", r.txHash)
  })
} else record("SKIP", "patch status", "no status entity")

// 3. Read back and verify.
if (obs) {
  await step("read back readonly", async () => {
    const q = `arkiv.schema = str('sw.gate.v1') AND ($creator = addr(${account.address}))`
    const page = await pub.query(q, {
      select: { $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, $attributes: true },
      limit: 100,
    })
    const row = page.entities.find((e) => e.$key === obs.entityKey)
    if (!row) return record("FAIL", "read back readonly", `key missing from ${page.entities.length} rows`)
    const same = row.$attributes.body.value.toLowerCase() === toHex(body)
    record(same ? "PASS" : "FAIL", "bytes round-trip", `${BODY_BYTES} bytes, read back as ${row.$attributes.body.type} hex of ${row.$attributes.body.value.length} chars`)
    record(row.$creationFlags.readonly ? "PASS" : "FAIL", "readonly flag read back", JSON.stringify(row.$creationFlags))
    record(row.$updatedAt === row.$createdAt ? "PASS" : "FAIL", "$updatedAt == $createdAt on a fresh readonly", `${row.$updatedAt} vs ${row.$createdAt}`)
    record(row.$creator === account.address ? "PASS" : "FAIL", "$creator is w1", row.$creator)
  })
} else record("SKIP", "read back readonly", "no entity")
if (status && patched) {
  await step("status $updatedAt moved", async () => {
    const e = await pub.getEntity(status.entityKey, Status)
    record(e.$updatedAt > e.$createdAt ? "PASS" : "FAIL", "status $updatedAt moved after patch", `created=${e.$createdAt} updated=${e.$updatedAt}`)
  })
}

// 4. Try to edit the readonly entity, first through the SDK, then forced onto the chain.
if (obs) {
  await step("patch readonly", async () => {
    try {
      await wallet.patchEntity(Gate, obs.entityKey, { set: { site: "edited.example" } })
      record("FAIL", "patch readonly (SDK)", "the patch was ACCEPTED: readonly did not hold")
    } catch (e) {
      record("PASS", "patch readonly (SDK) rejected", describe(e))
    }
  })
  await step("patch readonly forced", async () => {
    try {
      // A set gas limit skips the SDK's estimate, so the transaction reaches a block and the chain decides.
      const r = await wallet.patchEntity(Gate, obs.entityKey, { set: { site: "edited.example" } }, { gas: 300_000n })
      await cost("patch readonly forced", r.txHash)
      record("FAIL", "patch readonly (forced tx)", "the patch was ACCEPTED: readonly did not hold")
    } catch (e) {
      record(e instanceof EntityMutationError ? "PASS" : "FAIL", "patch readonly (forced tx) reverted", describe(e))
      if (e?.txHash) await cost("reverted patch", e.txHash)
    }
    const after = await pub.getEntity(obs.entityKey, Gate)
    record(after.site.value === "gate1.example" ? "PASS" : "FAIL", "readonly value unchanged", after.site.value)
  })

  // 5. Does extending a readonly entity move $updatedAt? The PRD trust rule rejects records where it moved.
  await step("extend readonly", async () => {
    const before = await pub.getEntity(obs.entityKey, Gate)
    const r = await wallet.extendEntity({ entityKey: obs.entityKey, expiration: ExpirationTime.fromDays(181) })
    await cost("extend readonly", r.txHash)
    const after = await pub.getEntity(obs.entityKey, Gate)
    console.log(`RESULT extend readonly: $updatedAt ${before.$updatedAt} -> ${after.$updatedAt}, $expiresAt ${before.$expiresAt} -> ${after.$expiresAt}, moved=${after.$updatedAt !== before.$updatedAt}`)
    record("PASS", "extend readonly accepted")
  })

  // 6. Delete it.
  await step("delete readonly", async () => {
    const r = await wallet.deleteEntity({ entityKey: obs.entityKey })
    await cost("delete readonly", r.txHash)
    record("RESULT", "delete readonly succeeded, readonly does not stop the owner deleting")
    try {
      await pub.getEntity(obs.entityKey, Gate)
      record("FAIL", "deleted entity is gone", "getEntity still returned it")
    } catch (e) {
      record("PASS", "deleted entity is gone", e?.constructor?.name)
    }
  })
} else {
  record("SKIP", "patch, extend and delete readonly", "no entity")
}

// 7. Catalogue download: 100 rows with bodies, written with a 1 day lifetime to keep the cost down.
const loadWhere = `arkiv.schema = str('sw.gate.v1') AND site = str('gate1.load') AND $creator = addr(${account.address})`
const loadSelect = { $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, $attributes: true }
await step("load rows", async () => {
  const have = await pub.query(loadWhere, { select: { $key: true }, limit: 1, count: true })
  const missing = LOAD_ROWS - Number(have.count)
  const now = await pub.getBalance({ address: account.address })
  console.log(`RESULT load rows: have=${have.count} missing=${Math.max(missing, 0)}`)
  if (missing <= 0) return
  if (now < LOAD_MIN_BALANCE && !process.env.GATE1_FORCE_LOAD) {
    console.log(`RESULT load rows not written: balance ${formatEther(now)} is below ${formatEther(LOAD_MIN_BALANCE)} tGLM. Set GATE1_FORCE_LOAD=1 to write them anyway.`)
    return
  }
  const start = Number(have.count)
  let spent = 0n
  for (let i = 0; i < missing; i += LOAD_PER_TX) {
    const n = Math.min(LOAD_PER_TX, missing - i)
    const creates = Array.from({ length: n }, (_, j) => ({
      schema: Gate,
      values: { site: "gate1.load", observedAt: u64(BigInt(start + i + j)), body: pattern(BODY_BYTES, start + i + j) },
      expiration: ExpirationTime.fromDays(1),
      flags: { readonly: true },
    }))
    const r = await wallet.executeBatch({ creates })
    const rc = await wallet.getTransactionReceipt({ hash: r.txHash })
    spent += rc.gasUsed * rc.effectiveGasPrice
    console.log(`RESULT batch of ${n}: gasUsed=${rc.gasUsed} per row=${rc.gasUsed / BigInt(n)}`)
  }
  record("PASS", "load rows written", `${missing} rows cost ${formatEther(spent)} tGLM`)
})
await step("catalogue download", async () => {
  const t0 = performance.now()
  let rows = 0
  let bodyChars = 0
  for (let offset = 0; offset < LOAD_ROWS; offset += 100) {
    const p = await pub.query(loadWhere, { select: loadSelect, limit: 100, offset })
    rows += p.entities.length
    for (const e of p.entities) bodyChars += e.$attributes.body?.value.length ?? 0
    if (p.entities.length < 100) break
  }
  const ms = Math.round(performance.now() - t0)
  if (rows === 0) return console.log("RESULT catalogue download: no load rows to read")
  record(rows >= LOAD_ROWS ? "PASS" : "RESULT", "catalogue download through SDK", `${rows} rows, ${(bodyChars / 1e6).toFixed(2)} MB of body hex, ${ms} ms`)

  // The same read without the SDK, for wire size and rate-limit headers.
  const t1 = performance.now()
  const res = await fetch(chain.rpcUrls.default.http[0], {
    method: "POST",
    headers: { "content-type": "application/json", "accept-encoding": "br, gzip" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "arkiv_query",
      params: [loadWhere, { select: { key: true, creator: true, createdAt: true, updatedAt: true, creationFlags: true, attributes: true }, limit: "0x64" }],
    }),
  })
  const text = await res.text()
  console.log(`RESULT raw page: http=${res.status} ms=${Math.round(performance.now() - t1)} decodedBytes=${text.length} encoding=${res.headers.get("content-encoding")} ratelimit=${res.headers.get("ratelimit")} arkiv-cost=${res.headers.get("arkiv-cost")}`)
})

const left = await pub.getBalance({ address: account.address })
console.log(`RESULT balance after: ${formatEther(left)} tGLM, spent ${formatEther(balance - left)}`)
const fails = results.filter((r) => r.status === "FAIL").length
console.log(`SUMMARY ${results.filter((r) => r.status === "PASS").length} PASS, ${fails} FAIL, ${results.filter((r) => r.status === "SKIP").length} SKIP`)
