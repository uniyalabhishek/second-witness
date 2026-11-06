# Arkiv friction log

Everything here happened to us while building Second Witness on Rabdi with `@arkiv-network/sdk` 1.0.1. First entries are from 6 Nov 2026, before our first funded write, so write results are `eth_estimateGas` outputs unless stated otherwise.

## Things that broke

### 1. `NOT` is suggested by the node, then fails

- **Expected:** the node's error for `!=` tells us to write `NOT (attr = value)`, so that should work.
- **What happened:** `NOT` fails with `-32603 query: store: NotImplemented`. Through the SDK, this surfaces only as "An internal error was received."
- **Docs disagree too:** Column Types says every indexed column takes `ne`. Older Networks says "Rabdi has no NOT or !=".
- **Reproduce:**
  - `arkiv_query("$creator != addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821)", {"select":{"key":true},"limit":"0x1"})`
  - `arkiv_query("NOT ($creator = addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821))", {"select":{"key":true},"limit":"0x1"})`
- **Ask:** have the `!=` error suggest what actually works, and pass the node's message through the SDK.

### 2. Exactly 128 KiB of bytes passes the SDK and then fails

- **Expected:** the Limits page says 128 KiB for `bytes` in one create, so a body of exactly `MAX_ENTITY_BYTES` should work.
- **What happened:** the SDK's check passes, then gas estimation fails with "Transaction failed: Execution error without revert data". 127 KiB estimates fine (5,340,145 gas at 1 day). 128 KiB fails at 1, 30 and 180 days. The message doesn't say why.
- **Reproduce:** `createEntity` with `{ body: bytes() }`, a 131,072-byte non-zero body and `ExpirationTime.fromDays(1)`. Our script is `spikes/arkiv/read3.mjs`.
- **Ask:** make the SDK limit and node limit match, or return a named error.

## Things that slowed us down

### 3. No gas or cost documentation

- **Expected:** a way to budget a witness that writes every 5 minutes.
- **What happened:** the docs say a shorter lifetime and fewer indexes cost less, with no numbers or formula. We had to measure it. A 27 KiB create estimates at 1,166,630 gas for 1 day, 1,687,996 for 30 days and 4,384,532 for 180 days.
- **Ask:** publish the cost formula, or add an `estimateCost` helper.

### 4. The usable size depends on lifetime, and the Limits page doesn't say so

- **Expected:** 128 KiB is the working ceiling at any allowed lifetime.
- **What happened:** with lifetime-based gas and the 2^24 per-transaction cap, a 110 KiB create at 180 days estimates at 17,078,734 gas, which is over the cap. The same body at 30 days estimates at 6,646,649.
- **Ask:** add a size-by-lifetime note to the Limits page, and a clear error when an estimate is over the cap.

### 5. Two official sources disagree on gas headroom

- **Expected:** one recommendation.
- **What happened:** SDK 1.0.1 pads estimates by 25%. The Mumbai MCP's `guides/known-issues` says "Rabdi gas estimation can be too small" and asks for at least 2 x the estimate, with a 1M floor. The public docs don't mention this at all. We can't yet say which is right, because we haven't sent a funded write.
- **Reproduce:** compare `GAS_HEADROOM_PERCENT` in `src/consts.ts` with `read_knowledge` on `guides/known-issues` at `https://mcp.arkiv.network/mumbai`.
- **Ask:** have the SDK default follow the guidance, or remove the warning if it's out of date.

### 6. Faucet can't fund a CI or throwaway key directly

- **Expected:** paste an address and get test tokens, since our witnesses are headless throwaway keys and one runs in GitHub Actions.
- **What happened:** `https://hub.arkiv.network/faucet` needs a wallet connection before showing anything else, so the claim amount and recipient form aren't visible up front. The page's code also references a sign-in gate and a captcha. An agent or script can't complete this, so a person must stop and do it.
- **Reproduce:** open the faucet with no wallet connected.
- **Ask:** show the amount and cooldown before connecting, and allow an address-only claim with a captcha.

### 7. Docs don't say what moves `$updatedAt`

- **Expected:** a statement of which operations change it. Our trust rule wants a witness record to be unchanged since creation, using `readonly` and `$updatedAt == $createdAt`.
- **What happened:** we found a live `readonly` entity with different values: `0x7b9b94166dbb272fa3eb06dcf6d34affce13e2728d20f1cb2969cbda8978c4c6`, `$createdAt` 179070, `$updatedAt` 179076, flags `raw: 3`. Readonly means no patches, so we suspect an extension or ownership change. The docs don't say.
- **Reproduce:** `getEntity` on that key.
- **Ask:** document it, or better, add a separate timestamp for attribute changes, so "these contents never changed" can be read without inference.

### 8. Docs say cursors are gone, but the node still returns one

- **Expected:** Older Networks says "Cursors... are gone" on Rabdi, so no cursor in responses.
- **What happened:** raw `arkiv_query` returned `"cursor":"b64:..."` on a page that had more rows. We can't tell whether it's safe to rely on, so we won't.
- **Reproduce:** `arkiv_query("$key > key(0x0000000000000000000000000000000000000000000000000000000000000000)", {"select":{"key":true},"limit":"0x3"})`
- **Ask:** document it or remove it.

### 9. `llms.txt` and the API reference have gaps

- **Expected:** `llms.txt` covers the key setup pages, since agents start there.
- **What happened:** it doesn't link Networks (`/networks/rabdi/`), Access Keys or Agent Skills, so the page with the chain ID and faucet is missing. `/llms-full.txt` returns 404. The API reference in the sitemap lists `chains/variables/tiramisu` and `localhost`, with no `rabdi`.
- **Reproduce:** `curl https://docs.arkiv.network/llms.txt`, and search `https://docs.arkiv.network/sitemap-0.xml` for `chains/`.

### 10. The MCP URL is hidden behind a collapsed section

- **Expected:** the MCP URL on the AI Tools page or in the docs' Agent Skills page.
- **What happened:** the page's text shows only one-line summaries until the MCP section is opened by clicking, and a plain fetch of the page finds no URL. Agent Skills covers skills and doesn't mention the MCP.
- **Reproduce:** fetch `https://hub.arkiv.network/ai-tools` and search for `mcp.arkiv.network`.

### 11. Argument order differs between reads and writes

- **Expected:** one order for schema and key.
- **What happened:** `patchEntity(schema, key, changes)` but `getEntity(key, schema)`. We wrote `getEntity(schema, key)` in our first draft and caught it by reading the SDK source.

### 12. Raw RPC and SDK use different field names in `select`

- **Expected:** the names the SDK takes work on the raw RPC too, since a README query has to be something anyone can run with `curl`.
- **What happened:** the SDK takes `{ $key: true, $creator: true }`. Raw `arkiv_query` returns `unknown field `$key`, expected one of `key`, `owner`, `creator`...`, though the filter string in the same call uses `$creator`.
- **Reproduce:** `arkiv_query("$key > key(0x0000000000000000000000000000000000000000000000000000000000000000)", {"select":{"$key":true},"limit":"0x1"})`
- **Ask:** accept both, or use one spelling across filters, `select` and the SDK.

### 13. Every browser client warns about an access key we can't ship

- **Expected:** a documented way to read from an open-source, browser-only client, since the docs' CORS support makes that the natural design.
- **What happened:** every client logs "Rabdi: no access key, so requests go to the public endpoint, which is heavily rate limited." A key in an extension's source is public, and a per-user key would make each signer identify themselves, which is what our design avoids. The limits aren't documented, so we can't size the extension's refresh against them.
- **Ask:** publish the anonymous read limit, and offer a keyless tier for public reads.

## What worked well

- `eth_estimateGas` works from a zero-balance address, so we could budget before funding.
- The `u64` column error is exact: "Column "observedAt": a u64 column, but the value is a u256. Write u64(...) around the value."
- The `$createdAt` filter error says plainly that it is "returned by projections only".
- CORS and the `ratelimit` and `arkiv-cost` headers make browser-only reading practical with no backend.
