# Second Witness: PRD and architecture

**Before you sign, check whether your browser got the same code witnesses saw on that site, and what that code's latest release added. The site doesn't have to sign up.**

Companion to `IDEA.md`, written 6 Nov 2026. Submit by 08:00 IST on 7 Nov (hard close 09:00). "Tested" means run today. "Docs" means read but not run.

## 1. Product

**User:** a multisig or treasury signer on a short list of frontends: Safe, CoW Swap, revoke.cash and our demo site.

**Flow:** press "Check before signing" and read one result. It stays attached and updates until you press Finish.

| Result | When | It says |
|---|---|---|
| **Changed** (red) | A fixed-name file differs from what witnesses saw, or witnesses saw two versions of it | Shows both hashes, plus the witnessed diff if one exists. Never "hacked". |
| **Not seen** (amber) | A first-party file lacks 2 witnesses, or a script comes from a host not on the site's list | Wait and recheck. New files usually resolve within 5 minutes, without a reload. |
| **New release** (amber) | Witnesses saw this code, but its release added addresses or hosts in the last 72 hours | Lists what was added, with any address from the tab's URL, such as your Safe, at the top. Ordinary releases skip this. |
| **Partial** (amber) | First-party files match, but uncompared code is running, or fewer than 2 witnesses checked this site in the last hour | Names what wasn't compared, or when witnesses last checked. |
| **Matches** (green) | Every script was compared and has 2 or more witnesses, and 2 witnesses checked this site in the last hour | Same code as N witnesses, plus the newest file's age as plain text. Never "safe". |
| **Can't check** (grey) | Site isn't listed, catalogue is over 1 hour old, or the roster can't be read | Never green. |

Uncompared code means inline and eval scripts, listed third-party scripts, and cross-origin frames. Tested on landing pages: Safe ran none, so it can reach green. CoW ran 13 inline scripts plus scripts from 9 other hosts, and revoke.cash ran 6 inline plus Crisp, so both read Partial.

| Priority | Scope |
|---|---|
| **P0** | Shared `core`, 2 witnesses, extension, ENS roster, forged-record rejection, release additions, minimal feed page, demo site, Bybit replay |
| **P1, cut first** | Publisher record ("Publisher confirmed") |
| **Out** | Blocking transactions, touching the wallet, Firefox, a backend, Merkle logs, headless browser witnesses, any bypass of bot challenges |

## 2. Architecture

```
Frontends ──plain HTTP──► Witness w1 (GitHub Actions)
    │                     Witness w2 (second network)
    │                          │ new hashes, signed by witness wallet
    │                          ▼
    │                     Arkiv Rabdi ◄── whole catalogue ──┐
    │                                                       │
    ▼                                                       │
Chrome tab ──code the engine parsed──► Extension: compares locally
                                                            │
ENSv2 Sepolia: w1, w2 → wallets ──── who counts ────────────┤
                                                            │
                                         Feed page (static) ┘
```

**Principles**
- **No backend of ours.** Switching off the feed page changes nothing.
- **One `core` for witness and extension,** so their hashes can't drift apart.
- **Fail closed.** Missing or stale data never produces green.
- **Least privilege.** The debugger attaches only on click, to that tab only.

### `core`: pure TypeScript, no dependencies

```ts
hashCode(src)                       // SHA-256 of the exact source as UTF-8, first 128 bits, hex (WebCrypto)
surface(src)                        // addresses and hosts named in the source
classify(script, site)              // ignored | uncompared | thirdParty | file
verdict(scripts, catalogue, site)   // the worst result across the tab
```

**No normalisation.** We hash the exact source, so nothing executable can be masked. Tested: engine and plain-fetch hashes agree on 20 of 20 files with nothing stripped, and none of the 560 files on our listed sites has a debug ID or deployment ID. If a listed site starts varying those, it reads Changed with the diff visible, and we take it off the list.

**`classify`**, first match wins:
1. Isolated world or `chrome-extension://`: **ignored**, because it belongs to another extension.
2. `hasSourceURL`, empty URL, or URL equal to the page: **uncompared**. A page can label eval'd code with any URL through `//# sourceURL`, so that URL is never trusted.
3. Origin not in `site.origins`: **thirdParty**. A host not in `site.thirdParty` makes the tab Not seen.
4. Everything else: **file**, keyed by pathname with the query dropped.

**`verdict`** for each file, where `versions` means hashes at that path with 2 or more witnesses:

```
immutable path, and (versions > 1, or versions ≥ 1 and hash not in versions)  → Changed
hash not in versions                                                          → Not seen
otherwise                                                                     → Matches
```

The tab takes the worst file result. If every file matches, a release in the last 72 hours that added addresses or hosts makes it New release, and any fresh witness reporting additions is enough. Otherwise, any uncompared code, or fewer than 2 fresh witnesses, makes it Partial. The popup lists every amber reason that applies. A witness is fresh for a site if its latest status lists that site and is under 1 hour old.

**`sites.json`** is bundled. Tested: these patterns cover 290 of 297, 147 of 148 and 113 of 115 crawled files. Other files compare by exact hash and can never read Changed.

```json
{ "app.safe.global": {
    "origins": ["https://app.safe.global"],
    "immutable": "/_next/static/chunks/.*[-.][0-9a-f]{16}\\.js$",
    "thirdParty": [], "seeds": [] } }
```

`seeds` holds paths the crawl misses, such as `/431852cb494ae7c6/script.js` on revoke.cash.

### Witness: stateless Node CLI

Each run:
1. Read its own records back from Arkiv, so hashes need no local state.
2. Crawl each site from the HTML: script tags, quoted JS paths, Next manifests and webpack chunk maps. Same origin, 12 concurrent, 15-second timeout. Accept only a 200 with a JS content type.
3. Hash with `core`, and use `surface` to find addresses and hosts that new files add compared with every cached file for that site.
4. Write new pairs and additions to one `sw.obs.v1` entity, keeping totals and up to 50 of each. If nothing is new, write nothing.
5. If a fixed-name file has a new hash, also write `sw.change.v1` with the changed region, trimmed by common prefix and suffix and capped at 16 KiB. Diffing needs the old file, so witnesses keep bodies in a disk cache (`actions/cache` on GitHub). If the old file is gone, the record has both hashes and no region.
6. Patch its one `sw.status.v1` entity with the sites it reached, even when nothing is new.

An empty cache makes the run a baseline, with no additions reported. It runs every 5 minutes and on manual dispatch. GitHub's cron can lag, which is why freshness allows 1 hour. Keys are throwaway testnet keys, held only in CI secrets or a local env file.

### Arkiv

SDK 1.0.1 has no `payload` field, so data goes in a `bytes` attribute (Types). Limits are 128 KiB of bytes per create and 128 bytes per `str`, so paths stay in the body.

```ts
sw.obs.v1    { site: str.indexed, observedAt: u64.indexed, body: bytes }  // {files: [[path, hash], ...], added: {addrs, hosts}}
sw.change.v1 { site: str.indexed, old: str, new: str, body: bytes }       // {path, sizes, region}
sw.status.v1 { body: bytes }                                              // {ok: [site, ...]}, one per witness
createEntity(schema, values, { expiration: ExpirationTime.fromDays(180), flags: { readonly: true } })  // obs and change only
```

**Read (query tested):**
`arkiv.schema = str('sw.obs.v1') AND ($creator = addr(w1) OR $creator = addr(w2))`, 100 rows a page, with `offset`.

**Trust rules:**
- Recheck `$creator` against the roster on the client.
- For `sw.obs.v1` and `sw.change.v1`, require `readonly` and `$updatedAt == $createdAt`.
- Witness freshness comes from the `$updatedAt` of `sw.status.v1`, because observations are written only when something is new.
- First seen comes from `$createdAt`, which can only be read, not filtered. Age is `(head − created) × 2s`.
- `observedAt` is set by the witness, so it's used for paging only and never for time.

### Extension: Manifest V3

**Permissions:** `debugger`, `activeTab`, `storage`, `alarms`. No host permissions, because both RPCs allow any origin (curl-tested with an extension `Origin`).

```
chrome.debugger.attach({tabId}, "1.3")
Debugger.enable                      // replays scripts already parsed, no reload (tested)
Debugger.setSkipAllPauses {skip}     // without it, a `debugger;` statement freezes the page (tested)
on Debugger.paused      → resume     // covers the gap between those two calls
on Debugger.scriptParsed → getScriptSource → hashCode → verdict → badge
detach on Finish or tab close
```

- An active debugger session keeps the service worker alive from Chrome 118 (Docs).
- Results live in `chrome.storage.session`, and the popup only renders them.
- Every 15 minutes an alarm refreshes the roster, witness statuses and the whole catalogue into `chrome.storage.local`. Every user makes the same query, so no RPC learns which site you're checking. While attached, it refreshes every 60 seconds, so Not seen resolves without a reload.
- Uses `@arkiv-network/sdk`, which includes viem: 107 KB gzipped, browser-safe (tested).

### ENSv2 on Sepolia

One name, `secondwitness.eth` (available today), with one `PermissionedResolver` and no subregistry. Children resolve through the parent's resolver (tested).

| Job | Call | Status |
|---|---|---|
| Register | `commit`, wait 60s, approve USDC, `register(...)` | Source |
| Add witness | `setAddress(dns("w1.secondwitness.eth"), 60, wallet)` | Docs |
| Revoke | `setAddress(dns("w1…"), 60, "0x")` | Docs |
| Read roster | viem `getEnsAddress` on `w1..w5`, null means revoked. Children can't be listed on-chain, so we probe. | Tested |
| Scoped CI key (P1) | `grantRoles(uint256(keccak256("release")), 1<<4, ciKey)` | Docs |

**P1 publisher flow:** the `release` text record holds the SHA-256 of `/.well-known/second-witness.json`, which lists `[path, hash]` pairs. The extension fetches it, checks its hash, then checks every tab file is listed. On stage, the CI key sets `release`, then reverts with `EACUnauthorizedAccountRoles` when it touches anything else.

**Watch out:**
- Copy ABIs from the docs, using resolver impl `0x115eb5…`. `contracts-v2` HEAD has a different ABI and addresses (tested).
- The registrar rejects MockUSDC and accepts Circle Sepolia USDC `0x1c7D…7238`. A year costs about 8 USDC, and the minimum term is 28 days (tested).
- Text-key scope applies across the whole resolver, not per name. That's fine with one name.

### Feed, demo and replay

- **Feed:** one static page reading Arkiv and ENS directly. It shows the roster, the last observation per site, changes with evidence, and the replay. It's also the live demo link.
- **Demo site:** a generic "Demo Treasury" page with no real brand and no wallet. A serverless function serves altered code only to a client holding a cookie, and that code swaps the displayed recipient.
- **Bybit replay:** runs `core` over the 7 Wayback captures. We commit only hashes, timestamps and the changed region. Captures are never executed and never enter the catalogue, because Arkiv can't backdate them and they weren't live observations.

## 3. Threat model

| Attack | Result |
|---|---|
| Same altered file for everyone at the same URL (Bybit) | **Changed**: two witnessed versions |
| Altered file served only to the victim | **Changed**: tab hash differs from witnesses |
| Altered code still in cache after cleanup | **Changed**: we hash parsed code, not a refetch |
| DNS hijack or pipeline compromise: new code for everyone, witnesses included | **Not seen**, then **New release** listing what it added. Tested on the altered Bybit file against the clean one: 5 added addresses, including the cold wallet. |
| Script injected from a new host | **Not seen** |
| Eval'd code labelled with a fake URL | **Partial**: treated as uncompared |
| Forged witness record | Dropped: `$creator` isn't on the roster |
| One witness key stolen | Can't reach 2 witnesses alone. Revoke on ENS. |
| Witness deletes records, or they expire | Falls to **Not seen** |
| Witnesses stopped or blocked | **Partial** after 1 hour. A dead witness can't make altered code match. |
| RPC blocked | **Can't check** after 1 hour |
| **Limit:** new code for everyone that encodes its addresses, or fetches them from a host already known | Reads like an ordinary release: Matches once witnessed, with its age shown |
| **Limit:** an attacker waits out the 72 hours | New release clears. The feed keeps the record. |
| **Limit:** injected inline or eval code | Turns green into **Partial**, but adds no signal on a site that already reads Partial |
| **Not defended:** lying RPC | Reads carry no proofs. Users would need their own node. |
| **Not defended:** service worker code, cross-origin frames | Outside the check. Frames are counted. |

## 4. Gates, before any UI

1. **Arkiv write:** create a `readonly` entity with a 27 KB body and patch a status entity, then read gas used and catalogue download time. *If those fail, Arkiv is out and we rethink the data layer.* Also try to edit and delete a record and note what happens. Deletion succeeding is fine; confirm the file then falls to Not seen.
2. **Real extension on Safe:** in normal Chrome, measure attach to verdict and how the banner feels, with a wallet extension installed. *No fallback keeps the core claim, so if this fails we stop and decide together.* This is the biggest risk, because headless Chrome froze on Safe.
3. **GitHub Actions crawl:** a datacenter IP reaches all 3 sites. *A site that blocks it comes off the list.* Log what each real deploy adds during the build. *If New release fires on most deploys, shorten the 72 hours.*
4. **ENS:** register, set `w1`, read it through the Universal Resolver, clear it. Then test the scoped key. *If it fails, hardcode the roster and drop the ENS track.*

## 5. Performance budgets

| Measure | Budget | Today |
|---|---|---|
| Attach to verdict, Safe (54 files) | Under 2s | Not measured |
| Witness run, all sites | Under 3 min | Crawl tested: Safe 80s, CoW 2s, revoke.cash 5s |
| Body size, largest site | Under 128 KiB | About 27 KB estimated for Safe's 297 files |
| Catalogue refresh | Under 5s | 100 rows about 143 KB without bodies. No 429s in 30 reads; 2,000 units per 10s at 10 per query. |
| Cost when the button isn't pressed | One small alarm every 15 min | By design |

## 6. Repo

```
core/        hash, surface, classify, verdict + tests on real captures
witness/     crawl, Arkiv writes, sites.json
extension/   manifest, service worker, popup
feed/        static page
demo-site/   target page and serverless function
replay/      Bybit runner and committed output
arkiv/       friction, reach, why-arkiv, how-you-use-arkiv, schema (.md)
.github/workflows/witness.yml
README.md (CROPS section, writer addresses, one runnable query), LICENSE (MIT), AI disclosure, specs
```

Node 22, TypeScript, esbuild and `node:test`. Dependencies are only `@arkiv-network/sdk` and `viem`. Commit steadily and keep commits small.

## 7. Build order, about 6 hours

| # | Step | Time |
|---|---|---|
| 1 | `core` and tests, using the Bybit captures | 30 min |
| 2 | Gates 1, 2, 3 | 60 min |
| 3 | Witnesses live on all sites | 45 min |
| 4 | Extension | 60 min |
| 5 | ENS roster (Gate 4) | 30 min |
| 6 | Demo site and replay | 30 min |
| 7 | Feed page | 30 min |
| 8 | Publisher record (P1) | 30 min |
| 9 | `/arkiv` docs, README, video, fresh-Chrome run | 60 min |

**Cut in this order:** publisher record, feed evidence view, revoke.cash. **Never cut:** the engine check, two witnesses, forged-record rejection, release additions, the Bybit replay.

## 8. Done when

On the deployed build, in a fresh Chrome on venue Wi-Fi:

1. Using real Arkiv records and real Sepolia reads, Safe reads **Matches** (or Partial, if Gate 2 shows its full app runs uncompared code), and CoW and revoke.cash read **Partial**, naming what wasn't compared.
2. The demo site serves altered code to the user and reads **Changed**. After the server is cleaned, a reload still reads **Changed**, because the altered code runs from cache. A renamed file reads **Not seen**, then **New release** listing the added address once witnesses crawl it.
3. The replay shows clean, then Bybit's address in the diff, then the theft 44.7 hours later. A `core` test confirms the altered file also reads **New release**, naming the cold wallet, when treated as a new filename.
4. A record from an unlisted wallet is dropped.
5. Clearing `w2` on ENS moves a page from Matches to Not seen.
6. With the feed off, the check still works, and the network log shows no per-site queries.
7. A page with a `debugger;` statement doesn't freeze.
8. A witness status over 1 hour old turns Matches into **Partial** (unit test).

The submission checklist and on-stage statements are in `IDEA.md`.
