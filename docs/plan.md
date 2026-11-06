# Second Witness: build plan

**Spec:** `PRD.md`, `IDEA.md`. Where they disagree with a tested fact in `docs/research/`, the tested fact wins.
**Goal:** a first iteration the user can test: real Arkiv records, real Sepolia ENS, real extension, on the short list plus the demo site.
**Architecture:** witnesses write to Arkiv. ENS says who counts. The extension hashes what V8 parsed and compares locally. No backend of ours.

## Constraints

- Local git only: no stage, commit, push or remote. Witnesses run locally until the user says otherwise.
- Minimal and boring. Dependencies: `viem`, `@arkiv-network/sdk`, nothing else at runtime. No framework. Vanilla TS, CSS from `design/`.
- Fail closed: missing or stale data never reads Matches.
- Copy never says safe, hacked, secure, verified, malicious or attack, and never implies it's OK to sign.
- No third-party requests from any client except the Arkiv and Sepolia RPCs.
- Keys only in `.env`. Never printed.
- TS run directly by Node 22.18+, tests with `node:test`, browser bundles with esbuild.

## Done so far

| Part | State |
|---|---|
| `core/`, `reader/`, `witness/`, `extension/`, `feed/`, `demo-site/`, `ens/`, `replay/` | Built. 110 tests, plus a browser run against live records (`extension/test/e2e.mjs`). |
| Arkiv and ENS | Live. `secondwitness.eth` lists w1 and w2 on Sepolia, and both write to Rabdi. |
| Not done | Deploy demo and feed, GitHub Actions witness (needs a remote), README, `/arkiv/*.md`, video. |

## Tasks

Each owner writes only inside its own directories. `core` changes go through the orchestrator.

### 1. `reader/`: read side, shared by extension and feed
- `fetchRoster(rpcUrl, parent): Promise<RosterEntry[]>`: `getEnsAddress` on `w1..w5.<parent>`, null means revoked. Throws if the RPC fails, so the caller reads Can't check rather than an empty roster.
- `fetchCatalogue(arkivRpc, roster, now): Promise<Catalogue>`: pages all three schemas by `$creator`, maps to `RawEntity`, runs `accept*`. One malformed entity is dropped, not fatal. A failed RPC throws.
- Test: fixture entities through the mapper, forged and edited ones dropped. Live smoke test behind an env flag.

### 2. `witness/`: stateless CLI, `node --env-file=.env witness/src/run.ts --key W1_KEY`
- `crawl(site, fetch): Promise<CrawledFile[]>`: from the HTML: script tags, preloads, quoted JS paths, Next manifests, webpack chunk maps, plus `seeds`. Same origin, 12 concurrent, 15s timeout. Only a 200 with a JS content type counts. Port from `crawl_probe.mjs`. Hash `res.text()`, which strips a BOM the way the browser does.
- `planWrites(crawled, knownPairs, cachedSurface, cachedBodies): {obs, changes, status}`: pure. Empty cache is a baseline with no additions. Cap 50 per kind with totals. Split bodies at 64 KiB.
- `run`: read own records, crawl, plan, write, always patch status. A site that fails stays out of `ok` and doesn't stop other sites. Cache bodies in `.witness-cache/<witness>/`. The demo origin is one constant in `core/src/sites.ts`.
- Test: `planWrites` table. Crawl against a local fixture server, including an HTML fallback at a JS path, which is ignored.

### 3. `extension/`: Manifest V3, only `debugger`, `activeTab`, `storage`, `alarms`
- `background.ts`: attach on click only, `Debugger.enable`, `setSkipAllPauses`, resume on pause. On `scriptParsed`: read source, `hashCode`, store, recompute `verdict`, set badge. Count cross-origin frames. Detach on Finish, tab close or external detach. Survive a worker restart by detaching stale state, never by showing old results as current. Alarm refreshes roster and catalogue every 15 min, every 60s while attached.
- `popup.ts`: render only, from `chrome.storage.session`. Markup and copy from `design/`.
- Test: `render(verdict) -> html` for all six results, plus a banned-word check on all copy. Playwright run on the demo site.

### 4. `demo-site/`: zero-dependency Node server
- Generic Demo Treasury page. Cookie `sw_target=1`, set from a control page, serves altered code on the same path, with `immutable` cache headers. That code changes the displayed recipient.
- Clearing the cookie means the server now serves clean code to this client too, while the tab still runs the altered copy from cache. That needs no server state.
- `POST /__control/release` with a shared secret switches everyone to a renamed file naming a new address, for the New release step. In-memory state.

### 5. `feed/`: one static page
- Reads Arkiv and ENS directly through `reader`. Roster, last observation per site, changes with evidence, replay from `replay/output.json`. Markup from `design/`. Works from `file://`-free static hosting, with no server of ours.

### 6. `ens/`: register, roster, revoke
- Scripts from `docs/research/ensv2.md`, run once the owner wallet is funded. Fallback if ENS fails: hardcode the roster in one constant and drop the track.

### 7. Submission files (after the user has tested)
- `arkiv/*.md` with real numbers, README with CROPS section, writer addresses and one runnable query, AI disclosure. Public repo when the user says so.

## Order

1. Research and design finish (running).
2. Tasks 1 and 2, then real witnesses on real Arkiv once funded.
3. Tasks 3, 4, 5 in parallel, at most 4 agents.
4. Independent review, then a fresh-Chrome run of PRD section 8.
5. Hand back for testing.

## Review focus

Untested input most likely to bite, each pinned by a test in the owning task:

1. A page that has no scripts yet, or navigates while attached: never Matches on an empty or half-read tab.
2. The site serves an HTML fallback at a JS path to the witness: ignored, not recorded as a version.
3. `getScriptSource` fails or returns bytecode: that file reads Not seen, never Matches.
4. The RPC is down or rate limited during refresh: the last good catalogue is used until it's an hour old, then Can't check.
5. A hostile entity: huge body, wrong types, a path with control characters. Dropped, and rendered only as text, never as HTML.
