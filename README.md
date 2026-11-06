# Second Witness

A website can run different code in your browser than everyone else gets. The page looks the same, but your money can go somewhere else. An altered Safe file was live on a public URL 44.7 hours before the $1.5B Bybit theft, and no signer's browser could tell.

Second Witness is a button you press before you sign. It compares the code in your tab with what two witnesses recorded. If it's different, don't sign. The site doesn't have to sign up, and nobody learns what you check.

[Demo video](VIDEO_URL) · [Live demo](https://second-witness.vercel.app/demo) · [Witness feed](https://second-witness.vercel.app/feed/)

## How it works

1. **Witnesses** crawl each listed site every 15 minutes in [public GitHub Actions](.github/workflows/witness.yml), hash every JavaScript file and write new hashes to Arkiv as write-once records.
2. **The roster** is on ENS: `w1` and `w2` under `secondwitness.eth`. Clear a name and every browser stops counting that witness.
3. **The extension** attaches Chrome's debugger on your click and hashes the exact source the JavaScript engine parsed. That catches code served only to you, and code still running from cache after the server was cleaned.
4. **The comparison** runs in your browser against every record, so no request says which site you're on.

| | Result | Means |
|---|---|---|
| `=` | Same code | Every file matches what two witnesses recorded. |
| `≠` | Don't sign | A file witnesses never recorded under a name that promises fixed content, or that name has held two versions. |
| `?` | Not seen | Witnesses haven't recorded this code, or a script comes from a host not on the site's list. |
| `+` | New release | Code under an hour old, or a release that added addresses or hosts in the last 72 hours. |
| `≈` | Partial | The files match, but other code wasn't compared, witnesses are behind, or one witness recorded another version. |
| `∅` | Can't check | The site isn't listed, or the records are missing or old. |

## Evidence

- **Bybit replay:** 7 archived captures of Safe's `_app` file, 6 identical. The altered one is 1,994 bytes larger and names Bybit's cold wallet. Through the real comparison code it reads Don't sign. Rerun with `node replay/fetch-captures.mjs && node replay/run.ts`. Results are in [`replay/output.json`](replay/output.json).
- **False alarms:** 0 hash-named files changed across about 532 URLs in 13 samples over 2.8 hours, on 31 sites.
- **Coverage:** a plain crawl found 114 of the 115 first-party files a real browser loaded on Safe, CoW and revoke.cash.

## CROPS

The lead property is **Secure**: the page you're about to sign on can't vouch for itself, so your browser checks it against records the page doesn't control, with no server of ours in the path.

- **C:** We control the ENS name, two witness keys and the bundled site list. There is no backend. If we vanish, the records stay readable on Arkiv for 180 days, the check turns Partial within an hour, and anyone can fork with their own witnesses by changing one constant. If an RPC refuses you, the popup reads Can't check once records are over an hour old, never Same code.
- **O:** MIT. `npm ci && npm run build` produces everything from this repo.
- **P:** The Arkiv and Sepolia RPCs see your IP and that you use Second Witness, not which sites you check, because the extension downloads every record. There are no analytics. Our host sees only people who open the feed or demo.
- **S:** The extension handles no keys and never touches your wallet. The debugger attaches only on your click, only to that tab, and Chrome shows a bar while it's on. Witness keys are throwaway testnet keys. You trust the ENS owner to list honest witnesses, and at least one witness to report what the site really served.

It doesn't catch:

- Sites not on the list. There are 4 today: Safe, CoW Swap, revoke.cash and the demo.
- A release served to everyone under a new filename that adds no addresses or hosts. It reads New release for an hour, then Same code.
- A bad transaction. It checks the code you sign through, not what you sign.
- Code Chrome has already discarded when you press the button, so check right before you sign.

Today we run both witnesses ourselves, on different machines.

## Arkiv

All witness data lives on Arkiv's Rabdi testnet, and the extension and feed read it directly from the browser. Details are in [`arkiv/`](arkiv).

- **Writers:** `0x109f654ec9c3c235d2f49128f8fa373bb3685821` (w1), `0xec6e879764725c30eca0df033adacdb58a05f632` (w2)
- **One query,** both witnesses' records of Safe:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'sw.obs.v2'"'"') AND site = str('"'"'app.safe.global'"'"') AND ($creator = addr(0x109f654ec9c3c235d2f49128f8fa373bb3685821) OR $creator = addr(0xec6e879764725c30eca0df033adacdb58a05f632))",{"select":{"key":true,"creator":true,"createdAt":true,"updatedAt":true,"expiresAt":true,"creationFlags":true},"limit":"0x5"}]}'
```

## ENS

`secondwitness.eth` is on ENSv2 on Sepolia, with its own resolver. `w1` and `w2` are answered straight off that resolver through wildcard resolution, with no registry or token for each one. Every browser reads the roster live, and revoking a witness is one `setAddress`. Read it with `node ens/read-roster.mjs`.

## Run it

```bash
npm ci
npm test
npm run build
```

Load `extension/dist` as an unpacked extension at `chrome://extensions`, then open the [demo](https://second-witness.vercel.app/demo) and press **Check before signing**. To see Don't sign, press **Serve me altered code** on that page and check again.

To run your own witnesses, put two funded Rabdi keys in `.env` as in `.env.example`, then run `npm run witness W1_KEY` and `npm run witness W2_KEY`. For your own roster, edit `ens/config.mjs`, run `ens/register.mjs`, and change `ENS_PARENT` in `reader/src/index.ts`. The site list is in `core/src/sites.ts`. `npm run site` builds what `vercel.json` hosts.

## How we used AI

Abhishek Uniyal chose the problem, the tracks and the product calls. Claude Code wrote nearly all of the code, tests and docs under that direction. ChatGPT and Astra reviewed it, and their findings were accepted or rejected case by case.

## License

[MIT](LICENSE). The Bybit captures are third-party bytes, so only their hashes, times and the changed region are in this repo.
