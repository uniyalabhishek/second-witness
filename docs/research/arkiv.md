# Arkiv research notes (Second Witness)

Checked 6 Nov 2026 against `@arkiv-network/sdk` 1.0.1. Labels: **TESTED** (ran it against live Rabdi), **TYPES** (SDK source), **DOCS** (docs.arkiv.network), **MCP** (Arkiv's Mumbai MCP server).

Gate 1 ran on 6 Nov 2026: 13 of 14 checks passed with real money on w1. Measured numbers are in section 9. The one failure was the optional 100-row load batch, replaced by a measurement of the real catalogue. Other write numbers below are `eth_estimateGas` results.

## Changes the PRD needs

1. **The gas token is tGLM, not ETH.** DOCS, TYPES.
2. **Trust rule `$updatedAt == $createdAt` may reject extended records.** TESTED: a live `readonly` entity (`0x7b9b9416...`, schema `afr.batch.v1`, flags `raw: 3`) has `$createdAt` 179070 and `$updatedAt` 179076. A readonly entity can't be patched, so something else moved it. An extension or ownership change is the likely cause, but that is an inference. Gate 1 now tests it. Keep `permissionlessExtension` off, or anyone could move `$updatedAt` and get our records rejected. If it is confirmed, witnesses must never extend, or the rule must change.
3. **Page by `$key`, not `offset`.** DOCS: writes and expiries between `offset` pages can make a row repeat or go missing. A missed row could show a real file as Not seen. Sort by `$key` and continue with `$key > key(last)`.
4. **The catalogue with bodies is unproven.** The PRD's 143 KB figure excludes bodies. `bytes` come back as hex, so 100 rows of 27 KB is about 5.4 MB of JSON. DOCS warn that an endpoint may cap response size. The largest real page I read was 82 rows and 779 KB in 809 ms (TESTED). Gate 1 measures the real case.
5. **180 days is the expensive choice.** A 27 KB create costs 3.8 times what a 1-day one does (section 6). That is affordable, so no change is needed, but keep bodies small.
6. **128 KiB is not reachable in practice.** TESTED by estimate: 127 KiB is accepted and exactly 128 KiB fails. At 180 days the 2^24 gas cap is reached near 108 KiB, and the SDK's 25% padding is clipped from about 86 KiB. The 27 KB body is well inside this. Keep the PRD's body budget under 80 KiB, not 128.
7. **Compare `$creator` case-insensitively if using raw RPC.** TESTED: the SDK returns checksummed addresses and raw `arkiv_query` returns lowercase.

**Confirmed correct:** the `createEntity(schema, values, { expiration: ExpirationTime.fromDays(180), flags: { readonly: true } })` shape (180 days is within the 182.5-day maximum), `$creator` filtering with `OR`, `$createdAt` being projection-only, and the 2-second block time. `str.indexed` in the PRD is shorthand; the real syntax is `str().indexed()`.

## 1. Current testnet

| Property | Value | Source |
|---|---|---|
| Name | Rabdi, "Arkiv's current public testnet" | DOCS, MCP |
| Chain ID | 7794095 (`0x76edaf`) | TESTED |
| HTTP RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network` | TESTED |
| WebSocket RPC | `wss://rpc.rabdi.db-chain.testnet.arkiv.network` | DOCS, TYPES |
| Explorer | `https://rabdi.explorer.arkiv.network` | DOCS, TYPES |
| viem chain | `rabdi({ accessKey })` from `@arkiv-network/sdk/chains`. It is a function and the argument is required; `""` means the public endpoint. | TYPES, TESTED |
| Gas token | tGLM, 18 decimals | DOCS, TYPES |
| Replaced testnets | Tiramisu, Braga, Kaolin | DOCS |

## 2. Wallet client and create

Client code follows DOCS and TYPES. The create has only been run up to the gas estimate (TESTED), with the same schema types.

```js
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" })
const account = privateKeyToAccount(process.env.W1_KEY)
const wallet = createWalletClient({ chain, transport: http(), account })
const pub = createPublicClient({ chain, transport: http() })

const Obs = defineSchema("sw.obs.v1", {
  site: str().indexed(),
  observedAt: u64().indexed(),
  body: bytes(),
})

const { entityKey, txHash, expiresAt } = await wallet.createEntity(
  Obs,
  { site: "app.safe.global", observedAt: u64(1793967000n), body: new Uint8Array(27 * 1024) },
  { expiration: ExpirationTime.fromDays(180), flags: { readonly: true } },
)
```

- A bare `1n` for a `u64` column fails with `SchemaMismatchError`; write `u64(1n)`. TESTED.
- `body` takes a `Uint8Array` or hex and reads back as hex. DOCS.
- A wallet client has no `query` or `getEntity`, so keep a public client too. TYPES.
- Gas receipts: `await wallet.getTransactionReceipt({ hash: txHash })`. TYPES.

## 3. Patch and batch

TYPES and DOCS. Not yet run on chain.

```js
const Status = defineSchema("sw.status.v1", { body: bytes() })

await wallet.patchEntity(Status, statusKey, { set: { body: newBody } })
// returns { entityKey, txHash }. A patch never changes the expiry.

const r = await wallet.executeBatch({
  creates: [{ schema: Obs, values, expiration: ExpirationTime.fromDays(180), flags: { readonly: true } }],
  patches: [{ schema: Status, entityKey: statusKey, set: { body: newBody } }],
})
// returns { txHash, createdEntities, patchedEntities, deletedEntities, extendedEntities, ownershipChanges }
// Atomic. Optional lists: extensions, ownershipChanges, deletes.
```

A batch suits a witness run: new observations and the status patch land together or not at all. One transaction may carry at most 2^24 gas (TYPES). The MCP guidance is stricter, at half the 30M block limit, so 15M.

Note the argument order: `patchEntity(schema, key, ...)` but `getEntity(key, schema)`. TYPES, TESTED.

## 4. Read

The query ran live with no key against `afr.batch.v1`, because no `sw.obs.v1` rows exist yet. The exact `sw.obs.v1` query with w1 and w2 also ran and returned 0 rows without error. TESTED.

```js
const q = `arkiv.schema = str('sw.obs.v1') AND ($creator = addr(${w1}) OR $creator = addr(${w2}))`
const page = await pub.query(q, {
  select: { $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, $attributes: true },
  limit: 100,
  offset: 0,
  count: true,
})
```

The typed builder also works, with the attributes as named fields rather than a map. TESTED, 82 rows, 0 skipped:

```js
import { asc, eq, gt, or } from "@arkiv-network/sdk/query"
import { addr, key } from "@arkiv-network/sdk/schema"

let query = pub
  .select({ $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, site: true, observedAt: true, body: true })
  .from(Obs, { onMismatch: "throw" })
  .where(or(eq("$creator", addr(w1)), eq("$creator", addr(w2))))
  .limit(100)
```

To page by key, add `.orderBy(asc("$key"))` and `.where(gt("$key", key(lastKey)))`, and stop on a page shorter than 100 (DOCS; the `orderBy` and `gt` chain is not yet run). With `onMismatch: "throw"`, one spam row carrying our schema tag from a roster witness fails the read; without it, a page of skipped rows gives no key to continue from. The roster filter limits this to our own witnesses.

Decoded result shape (TESTED, values abbreviated):

```js
{
  count: 82n,            // only when count: true
  blockNumber: 290875n,
  skipped: 0,
  entities: [{
    $key: "0x7b9b9416...",
    $creator: "0x952dB75B...",          // checksummed
    $createdAt: 179070n,                // block
    $updatedAt: 179076n,                // block
    $creationFlags: { readonly: true, permissionlessExtension: true, raw: 3 },
    $attributes: {
      "arkiv.schema": { type: "str", value: "afr.batch.v1" },
      epoch_id: { type: "u64", value: 352n },
      frame: { type: "bytes", value: "0x60c90826..." },  // hex string, 2 chars per byte plus 0x
      has_tx: { type: "bool", value: true },
      session_key: { type: "addr", value: "0x952dB75B..." },
    },
  }],
}
```

Turn `bytes` back into binary with `hexToBytes(row.$attributes.body.value)` from viem.

Raw `arkiv_query` differs (TESTED): field names have no `$` (`key`, `creator`, `createdAt`), values are hex strings, `attributes` is an array of `{ name, type, value }`, and addresses are lowercase. The call is `arkiv_query(queryString, { select: { key: true, creator: true, attributes: true }, limit: "0x64", offset: "0x0" })`.

Query behaviour (TESTED):
- `$createdAt` and `$updatedAt` can't be filtered: error `-32002`, "returned by projections only".
- `!=` is rejected with `-32002`, and `NOT (...)` fails with `-32603 query: store: NotImplemented`.
- `getEntity` on a missing or deleted key throws `NoEntityFoundError`.
- `getBlockTiming()` returns `{ currentBlock, currentBlockTime, blockDuration: 2 }`.

## 5. Rate limits and access keys

**Measured on the public endpoint, no key** (TESTED): header `ratelimit: limit=2000, remaining=N, reset=10`, so 2,000 units per 10 seconds. `arkiv-cost` is 10 for `arkiv_query`. 40 consecutive 100-row pages in this session gave no 429. Whether the limit is per IP or shared isn't documented.

**A key is not required for reads or writes** (DOCS, TESTED for reads, TYPES for writes).

| User | Recommendation |
|---|---|
| Local witness | No key needed at one run per 5 minutes. |
| GitHub Actions witness | Start with no key. Add one as a secret only if 429s appear, since shared datacenter IPs are the risk and this isn't tested yet. |
| Extension | No key. A key can't be secret there, any user could spend its quota, and the Origin list is "attribution, not access control" (DOCS). No key also keeps the no-backend story simple. |

**Getting a key** (DOCS): at `https://hub.arkiv.network/access-keys`, connect a wallet, sign the sign-in message, complete registration if asked, pick Rabdi, name the project, solve a captcha, then generate. One key per wallet per network, with a monthly quota in cost units. Send it as the last URL path segment, an `X-API-KEY` header or a bearer token. MCP guidance treats the keyed URL as a secret, so don't log it.

## 6. Gas

**`eth_gasPrice` is `0x3b9aca00`, 1 gwei.** Block base fee is also 1 gwei and the priority fee is 0. All 12 sampled recent writes paid exactly 1 gwei. Block gas limit is 30M. TESTED.

Estimates come from `spikes/arkiv/estimate.mjs`, using SDK-encoded writes that are never signed or sent, with a non-zero body. `eth_estimateGas` works from a zero-balance address. TESTED.

| Write | Gas | Cost at 1 gwei |
|---|---|---|
| Create, 0 byte body, 180 days | 338,995 | 0.00034 tGLM |
| Create, 1 KiB, 180 days | 479,188 | 0.00048 tGLM |
| **Create, 27 KiB, 180 days** | **4,384,532** | **0.0044 tGLM** |
| Create, 27 KiB, 30 days | 1,687,996 | 0.0017 tGLM |
| Create, 27 KiB, 1 day | 1,166,630 | 0.0012 tGLM |
| Create, 64 KiB, 180 days | 10,065,070 | 0.0101 tGLM |
| Create, 80 KiB, 180 days | 12,472,966 | 0.0125 tGLM |
| Create, 110 KiB, 180 days | 17,078,734 | Over the 2^24 (16.8M) cap |
| Create, 127 KiB, 1 day | 5,340,145 | 0.0053 tGLM |
| Create, 128 KiB, any lifetime tested | Fails: "Execution error without revert data" | |
| Patch, 16 byte body | 37,252 | 0.000037 tGLM |
| Patch, 256 byte body | 43,722 | 0.000044 tGLM |
| Patch, 1 KiB body | 69,432 | 0.000069 tGLM |

Patch figures were simulated on another owner's entity, whose remaining lifetime and old body size may affect them, so treat them as approximate. Real writes on chain agree in scale: 292-byte `execute` transactions used about 42,900 gas. Lifetime has a large effect: 27 KiB gains about 18,000 gas per day of life. Docs say only that a shorter lifetime costs less.

**tGLM per witness per day** (estimates at 1 gwei):

| Item | Gas per day | tGLM per day |
|---|---|---|
| 288 status patches at about 45,000 gas | 13M | 0.013 |
| 3 worst-case 27 KiB creates, assuming each site changes daily | 13.2M | 0.013 |
| **Total** | | **about 0.03** |

**Budget 0.05 tGLM per witness per day.** Allow about 0.15 tGLM on top for w1's single Gate 1 run, nearly all of it the 100 load rows at about 0.12.

Balance must also cover the gas limit upfront, not just gas used: 4.38M x 1.25 is 5.5M, and viem may add fee headroom, so keep at least 0.01 tGLM spare. The MCP says "Rabdi gas estimation can be too small" and asks for `max(1M, 2 x estimate)` capped at half the block limit, while the SDK uses 1.25 x estimate. I can't tell who's right until real writes run. If a Gate 1 write runs out of gas, pass explicit `gas` in the last argument.

## 7. Faucet

Looked at `https://hub.arkiv.network/faucet` in the built-in browser, read-only. Nothing was connected, signed or submitted.

**No claim was made, because the rule's condition isn't met:** it requires a wallet connection, then a sign-in signature, then a captcha.

What the rendered page shows without a wallet: "Sign in with your wallet to claim tGLM", a Connect wallet button, and "One claim per wallet, per cooldown window". Nothing else.

What the page's public JavaScript suggests, from an initial text search (less certain than the rendered page): a sign-in gate, a recipient address value, a CAPTCHA widget, a "Per claim" readout, a default cooldown label of "24 hours", and the note that a claim "can take up to a couple of minutes".

**Not determined:** the amount per claim, whether the recipient can be edited to another address, and whether the cooldown is keyed to the signed-in wallet or the recipient. I then tried a deeper read of the faucet code and a GET to its `/api/faucet` endpoint. The session's permission check blocked that as website access circumvention, so I stopped and did not retry it another way.

**Human steps:**
1. Open `https://hub.arkiv.network/faucet` in a browser with a wallet.
2. Connect a wallet and sign the sign-in message (no transaction). Prefer a throwaway wallet. If the recipient can't be edited, that wallet must be w1, which means importing the `W1_KEY` throwaway key into a separate browser profile.
3. Complete registration if asked.
4. Set or confirm the recipient as w1, `0x109F654eC9c3c235d2f49128f8FA373Bb3685821`.
5. Solve the captcha and press Send tGLM. Keep the tab open until it finishes.
6. For w2, `0xEC6E879764725c30eca0DF033adAcDB58A05f632`: try another claim. If the cooldown blocks it, either send part of w1's balance to w2 with a plain transfer, or claim from a second wallet.

Then run `node --env-file=.env spikes/arkiv/gate1.mjs`.

## 8. AI tools

`https://hub.arkiv.network/ai-tools` offers a plugin, an MCP server, skills and npm tools. The connector URL is `https://mcp.arkiv.network/mumbai` (Streamable HTTP, no API key). I called it directly with curl for read-only lookups and did not install anything or change any configuration.

**Useful:**
- `network_status`: confirms Rabdi and SDK 1.0.1 with dated checks.
- `read_knowledge` with `guides/known-issues`: the only place I found the gas warning, and `eth_getLogs` failing beyond about 1,000 blocks behind head. Second Witness reads with queries, so the log limit doesn't affect it.
- `check_schema` and `check_submission` check a public draft against the prize rules. Worth running on `/arkiv/schema.md` before submitting. Not yet run.

I did not call `submit_feedback` or `report_outcome`, since those send data to Arkiv and need the user's agreement. Skills install with `npx skills add https://github.com/Arkiv-Network/skills --all` (DOCS); not installed.

The prize rules ask for `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`, plus writer addresses and one runnable query in the README.

## 9. Gate 1 script

**Measured on Rabdi, 6 Nov 2026 (`spikes/arkiv/gate1.mjs`):**

| Check | Result |
|---|---|
| Create, readonly, 27 KB, 180 days | 4,348,467 gas, 0.00435 tGLM |
| Create status | 266,427 gas |
| Patch status | 29,690 gas |
| Bytes round trip | Equal |
| `$creationFlags` on a readonly record | `{"readonly":true,"permissionlessExtension":false,"raw":1}` |
| `$updatedAt == $createdAt` on a fresh readonly record | True |
| Patch a readonly record | Rejected by the SDK, reverts on chain |
| Extend a readonly record | **Accepted, and it moves `$updatedAt` (291489 to 291504).** Witnesses must never extend, or the trust rule drops their own records. |
| Owner deletes a record | Allowed. The next read raises `NoEntityFoundError`, so the file falls to Not seen. |
| 100-row load batch | Failed with "Execution error without revert data", probably too large for one batch. Not needed. |
| Real catalogue, 8 observations and 2 statuses | 97,336 bytes of JSON in 403 ms |

`spikes/arkiv/gate1.mjs`. **Not run on a funded wallet, so its write paths are untested.** It passes `node --check`, its zero-balance exit was run, and its read calls were checked against live entities.

Zero-balance run, TESTED, exit 0:

```
RESULT w1=0x109F654eC9c3c235d2f49128f8FA373Bb3685821 balance=0 tGLM
RESULT w1 balance is zero: nothing written. Fund it at https://hub.arkiv.network/faucet and run again.
```

When funded it does the following, each step printing PASS, FAIL or RESULT and none stopping the others:
- Creates a readonly 27 KB `sw.gate.v1` entity for 180 days, and creates and patches a status entity. It prints gas and cost for each.
- Reads back and checks the bytes round-trip, the readonly flag, `$updatedAt == $createdAt` and `$creator`.
- Tries to patch the readonly entity through the SDK, then forces a transaction onto the chain with a set gas limit to see the chain's own answer.
- Extends the readonly entity and reports whether `$updatedAt` moved. This step was added beyond the brief, for PRD item 2.
- Deletes the entity and confirms it is gone.
- Writes up to 100 load rows with a 1-day lifetime and times the download. It only writes them if the balance is at least 0.15 tGLM, or if `GATE1_FORCE_LOAD=1` is set, and it reuses rows from an earlier run.

The status schema is `sw.gate.status.v1` so test rows stay out of real queries.

Read-only scripts, all runnable with `node spikes/arkiv/<file>`: `estimate.mjs` (gas), `read.mjs`, `read2.mjs`, `read3.mjs`, `read4.mjs` (query shapes, size limits, recent transactions).
