# Arkiv friction log

Hit while building on Rabdi with `@arkiv-network/sdk` 1.0.1, 6–7 Nov 2026.

## Broke

**1. `NOT` is suggested by the node, then fails.** The error for `!=` says to write `NOT (attr = value)`, which fails with `-32603 query: store: NotImplemented`. Through the SDK that surfaces only as "An internal error was received." The docs disagree too: Column Types says every indexed column takes `ne`, and Older Networks says Rabdi has no `NOT` or `!=`.
- Reproduce: `arkiv_query("NOT ($creator = addr(0x109F654eC9c3c235d2f49128f8FA373Bb3685821))", {"select":{"key":true},"limit":"0x1"})`
- Ask: suggest what works, and pass the node's message through the SDK.

**2. Exactly 128 KiB passes the SDK, then fails.** The Limits page allows 128 KiB of `bytes`. The SDK's check passes, then gas estimation fails with "Execution error without revert data". 127 KiB estimates fine.
- Reproduce: `createEntity` with `{ body: bytes() }`, a 131,072-byte non-zero body and `ExpirationTime.fromDays(1)`.
- Ask: make the limits match, or return a named error.

**3. Raw RPC and SDK use different names in `select`.** The SDK takes `{ $key: true }`. Raw `arkiv_query` rejects it with ``unknown field `$key` ``, though the filter in the same call uses `$creator`.
- Reproduce: `arkiv_query("$key > key(0x0000000000000000000000000000000000000000000000000000000000000000)", {"select":{"$key":true},"limit":"0x1"})`
- Ask: accept both.

## Slowed us down

**4. No cost documentation, and usable size depends on lifetime.** We had to measure it. A 27 KiB create estimates at 1,166,630 gas for 1 day and 4,384,532 for 180 days. A 110 KiB create at 180 days estimates at 17,078,734, over the 2^24 cap, while 30 days is fine.
- Ask: publish the formula, and note size by lifetime on the Limits page.

**5. The faucet can't fund a CI key directly.** Our witnesses are headless throwaway keys, but the faucet needs a wallet connection before showing anything, so a person has to stop and do it.
- Ask: allow an address-only claim with a captcha.

**6. Docs don't say what moves `$updatedAt`.** Our trust rule needs `readonly` and `$updatedAt == $createdAt`. We found a `readonly` entity where they differ: `0x7b9b94166dbb272fa3eb06dcf6d34affce13e2728d20f1cb2969cbda8978c4c6`, created 179070, updated 179076.
- Ask: document it, or add a timestamp for attribute changes only.

**7. Browser clients warn about an access key they can't ship.** Every client logs "Rabdi: no access key, so requests go to the public endpoint, which is heavily rate limited." A key in an open-source extension is public, and a per-user key would make each signer identify themselves. The limit isn't documented, so we can't size our refresh against it.
- Ask: publish the anonymous read limit, and offer a keyless tier for public reads.

**8. Smaller things.**
- `patchEntity(schema, key, changes)` but `getEntity(key, schema)`.
- Older Networks says cursors are gone, but raw `arkiv_query` still returns `"cursor":"b64:..."`.
- `llms.txt` doesn't link Networks or Access Keys, `/llms-full.txt` is 404, and the API reference lists no `rabdi` chain.
- The MCP URL is only visible after opening a collapsed section on the AI Tools page.

## Worked well

- `eth_estimateGas` works from a zero-balance address, so we could budget before funding.
- The `u64` column error is exact: "a u64 column, but the value is a u256. Write u64(...) around the value."
- CORS and the `ratelimit` headers make browser-only reading practical with no backend.
