# ENSv2 on Sepolia: research notes

Checked 2026-11-06. **TESTED** means run against live Sepolia (reads, `eth_call`, `eth_simulateV1`) or a local fork of it. **SOURCE** means read in contract source or ABI. **DOCS** means docs.ens.domains or a provider's page. No transaction was sent or signed.

## What the PRD must change

1. **The P1 call is wrong.** `grantRoles(uint256(keccak256("release")), 1<<4, ciKey)` reverts `EACCannotGrantRoles` on the resolver, even from the owner holding all roles. Use `grantSetterRoles(setter, ciKey)`. TESTED, and DOCS agree.
2. **"The registrar rejects MockUSDC" is only true of the wrong mocks.** The deployment's own MockUSDC `0x240b0316df57887dbbe58b586508b19e633a14aa` is accepted by the oracle and anyone can mint it. A full registration paid with it passed on the fork. So **no USDC faucet is needed**. TESTED.
3. **The P1 stage line needs one more revert.** The CI key gets `EACUnauthorizedAccountRoles` on another text key or `setAddress`, and `EACCannotGrantRoles` if it tries to grant itself a role. TESTED.

The rest of the PRD's ENS section holds: resolver impl `0x115eb5…`, no subregistry, children resolving through the parent's resolver, `setAddress(…, "0x")` as revoke, and text-key scope being resolver-wide.

## Addresses

The docs' "Sepolia (ENSv2)" table matches what the earlier notes used, so nothing moved. All have code. TESTED.

| Contract | Address | Bytes |
|---|---|---|
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` | 8037 |
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` | 16000 |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` | 15608 |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` | 1524 |
| StandardRentPriceOracle | `0x8196665d4ca7488b6474a9ec8e7d2719fb42263a` | 8355 |
| Universal Resolver proxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | 2491 |
| Circle USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 1798 |
| MockUSDC (docs table) | `0x240b0316df57887dbbe58b586508b19e633a14aa` | |

`contracts-v2` HEAD (`sepolia/`) and its `sepolia-official-v1-20260525-r2/` folder both list other addresses. Neither is what the docs or the Universal Resolver path here use, so ignore both. SOURCE.

Payment tokens per `oracle.isPaymentToken` (TESTED): Circle USDC true, MockUSDC `0x240b…` true, MockDAI `0xf6fac8…` true. The migration page's "freely mintable test USDC" `0x16f95d…` and test DAI `0x278053…` are false, so that docs page is stale.

## 1. The sequence

Each step ran in `ens/simulate.mjs` on live state and in `ens/dry-run.mjs` on a fork, in this order. TESTED. ABIs are in `ens/config.mjs`.

1. **Deploy resolver:** `factory.deployProxy(impl, salt, initData)`.
   - `salt = uint256(keccak256(abi.encode(keccak256("OwnedResolver"), owner, uint256(0))))`.
   - `initData = initialize([{account: owner, roleBitmap: 0x1111…1111}], [])`, which grants every role and admin role on root.
   - Our resolver will be `0x0f16c4ccd950A5DBD2B5fC2335Da32A8B2874099`. The docs' CREATE2 formula predicted it and the fork deploy matched.
2. **Commit:** `makeCommitment(label, owner, secret, 0x0, resolver, duration, 0x0)`, then `commit(hash)`. The label is `secondwitness`, not the full name.
3. **Wait** 60s of chain time (`MIN_COMMITMENT_AGE`). The commitment lives 24h.
4. **Pay:** `token.approve(registrar, price)`, with a `mint` first if using MockUSDC.
5. **Register:** `register(label, owner, secret, 0x0, resolver, duration, token, 0x0)`.
6. **Add witness:** `resolver.setAddress(dns("w1.secondwitness.eth"), 60, wallet)`. **Nothing else is needed: no `linkToNode`, no token, no subregistry.** The first write creates and links the record.
7. **Revoke:** `resolver.setAddress(dns("w1.…"), 60, "0x")`.
8. **Read:** `getEnsAddress({ name })`, through the Universal Resolver.

**After clearing, `getEnsAddress` returns `null`.** The raw resolver answer is the zero address, and viem maps it. A slot that was never set also returns `null`, so "revoked" and "never added" look the same. TESTED.

**Watch out, resolver defaults:**
- Never write an address to the root name `0x00`. Every name without its own record would then resolve to it, so `w3`..`w5` would become witnesses. DOCS.
- For the same reason, revoke with `setAddress(…, "0x")`, not `linkToRecord(name, 0)`. A cleared name keeps its own empty record and can't fall back. DOCS, and clearing is TESTED.
- `viem` returning `null` also covers an expired name, so if registration lapses the roster empties and checks fail closed. Reads and failures are separate: RPC errors throw. SOURCE for the mapping; not tested with a real expiry.

## 2. Cost

Live oracle, `getRegisterPrice`. TESTED.

| Term | Price |
|---|---|
| 28 days (minimum) | 0.613701 USDC |
| 90 days | 1.972608 USDC |
| 1 year | 8.000021 USDC |

Gas from `eth_simulateV1` on live Sepolia. TESTED. **A local anvil fork reports about a third of this**: the live chain prices new state far higher (`eth_estimateGas` for the deploy is 812,553, against 178,250 on anvil). Use these numbers.

| Step | Gas |
|---|---|
| Deploy resolver | 791,358 |
| Commit | 127,458 |
| Mint MockUSDC (skip with Circle) | 140,589 |
| Approve | 128,274 |
| Register | 656,936 |
| Set `w1` | 371,012 |
| Set `w2` | 273,092 |
| Clear `w2` | 41,272 |
| Grant release key (P1, owner) | 258,062 |
| CI sets `release` (P1, CI key) | 274,286 |
| **Total** | **3,062,339** |

The base fee today is about 17 wei, so this costs almost nothing right now. Fees can spike, so budget for it: at 20 gwei the total is 0.061 ETH.

**Send the owner 0.05 ETH** (safe up to about 16 gwei), and send the CI key 0.005 ETH for P1, since it pays for its own `setText`. **USDC: none**, because `register.mjs` mints MockUSDC. To pay with Circle USDC instead, the owner needs 8.000021 for a year or 0.613701 for 28 days. The script defaults to a year, and `ENS_DURATION_DAYS=28` shortens it. The Circle path passed only on the fork (registered, with 18k more gas than the mock there), not in `eth_simulateV1`.

## 3. Faucets

Not attempted.

| Asset | URL | Access (DOCS or third-party guides, untested) |
|---|---|---|
| Sepolia ETH | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | Google login, 0.05 ETH per 24h, no mainnet balance per a third-party guide. Try first. |
| Sepolia ETH | https://sepolia-faucet.pk910.de | Proof-of-work in the browser. Page reachable; no login as far as I know, unconfirmed. Slower. |
| Sepolia ETH | https://www.alchemy.com/faucets/ethereum-sepolia | Alchemy account, 0.1 ETH per 24h. May require a mainnet balance, sources conflict. |
| Circle USDC (optional) | https://faucet.circle.com | Page says 20 USDC every 2 hours per address. Page text mentions no login. Choose Ethereum Sepolia. |

## 4. P1: scoped CI key

Correct call (TESTED):

```js
const setter = encodeFunctionData({ abi, functionName: 'setText', args: ['0x', 'release', ''] })
resolver.grantSetterRoles(setter, ciKey) // owner; only the selector and key matter
```

The resource is `uint256(keccak256("release"))` = `0x585a6dc6…b3e3` and the role is `1<<4`. Afterwards `roles(resource, ci)` is 16 and `roles(0, ci)` is 0.

| Attempt | Result |
|---|---|
| Owner: `grantRoles(resource, 1<<4, ci)` | `EACCannotGrantRoles` |
| CI: `setText(name, "release", v)` after the grant | Succeeds, reads back through the Universal Resolver |
| CI: `setText(name, "release", v)` before the grant | `EACUnauthorizedAccountRoles` |
| CI: `setText(name, "description", v)` | `EACUnauthorizedAccountRoles` |
| CI: `setAddress(w1, 60, …)` | `EACUnauthorizedAccountRoles` |
| CI: `grantRootRoles(1<<4, ci)` | `EACCannotGrantRoles` |

To revoke: `revokeRoles(resource, 1<<4, ci)`. DOCS.

**Scope limit:** the grant covers `release` on every name this resolver serves, so CI could also write `release` on `w1.secondwitness.eth`. Read `release` only from the parent name. DOCS.

## 5. Availability

`secondwitness.eth` is still available. TESTED at the end of this run; `node ens/check.mjs` re-checks it.

## 6. App-side read

- **Works with viem alone.** `ens/roster.mjs` has no node imports. Bundled with esbuild (`--platform=browser`, minified) it pulled in no `node:` modules and has no `eval` or `new Function`. It ran in a bare `vm` context given only `fetch` and JS built-ins, making live RPC calls. TESTED. It has not run inside a real Chrome extension.
- **Size:** 342 KB minified, 123 KB gzipped, including `http`, `createPublicClient`, the `sepolia` config and `getEnsAddress`. `ens-normalize` is 37 KB of that; our names are fixed ASCII, so it could go. TESTED.
- **viem's `sepolia` config is correct for ENSv2** (viem 2.57.16). `ensUniversalResolver` is `0xeeee…eeee`, the same proxy the docs list, and it returned our records on the fork. No override needed. TESTED.
- **Calls:** one `eth_call` per name, so 5 per roster read. No gateway traffic for on-chain records (the bundle made only 5 RPC fetches). TESTED.

**RPC for the extension: `https://ethereum-sepolia-rpc.publicnode.com`.** It returned `access-control-allow-origin: *` for a `chrome-extension://` origin on 3 of 3 tries at 180–430 ms, and it serves `eth_simulateV1`. Fallback: `https://1rpc.io/sepolia` (also `*`, about 550 ms). TESTED.

Rejected: `sepolia.drpc.org` (free plan refuses the chain), `sepolia.gateway.tenderly.co` and `eth-sepolia.api.onfinality.io/public` (rate limited), `rpc.sepolia.org` and `rpc2.sepolia.org` (timed out), `eth-sepolia.public.blastapi.io` (shut down). TESTED.

## Scripts

Run from the repo root.

| Script | Needs |
|---|---|
| `node ens/check.mjs` | Nothing. Read-only: balances, availability, price, what's missing |
| `node ens/read-roster.mjs` | Nothing. Read-only |
| `node ens/simulate.mjs` | Nothing. Live `eth_simulateV1`, gas table |
| `node ens/dry-run.mjs [--circle]` | `anvil`. Runs every script below on a fork with impersonated accounts. Refuses to run once `ens/deployment.json` exists |
| `node --env-file=.env ens/register.mjs` | Owner funded. Resumable; writes `ens/deployment.json` |
| `node --env-file=.env ens/set-witness.mjs w1 0x…` | Registered |
| `node --env-file=.env ens/clear-witness.mjs w1` | Registered |
| `node --env-file=.env ens/grant-release-key.mjs` | Registered (P1) |
| `node --env-file=.env ens/test-release-key.mjs [hash]` | Key granted, CI key funded (P1) |

Writes look up the name's configured resolver on chain, as the docs require, rather than trusting a saved address. `.env` keys match the expected owner and CI addresses. TESTED.

## What was and wasn't simulated

- **Live Sepolia, `eth_simulateV1`, with balance overrides:** deploy, commit, mint, approve, register, set, clear, grant, CI `setText`, both reverts, and Universal Resolver reads inside the same simulation.
- **Local fork with impersonated accounts:** every script end to end, including the real 60s wait, resume after completion, and viem's `getEnsAddress`. Both MockUSDC and Circle USDC payment paths.
- **Not run:** anything on the real chain, `walletFromEnv`'s signing path (the fork impersonates instead, so the signed path first runs on the real registration), real expiry, a real Chrome extension, and the faucets.
- **Fork limit:** the anvil here is from 2024 and is forced to `prague`, older than Sepolia's current rules. That's why its gas is low. The live simulation covers the difference; contract logic matched in both.

## Other sources

- `https://docs.ens.domains/llms.txt` and `/llms-full.txt` both exist. Context7 is the docs' listed MCP; there's no ENS-run docs MCP.
- `ensdomains/ens-cli` is an experimental preview, not on npm. It emits unsigned calldata and doesn't change anything here.
