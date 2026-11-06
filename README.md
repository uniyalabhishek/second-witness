# Second Witness

Before you sign, check that your browser got the same code everyone else got. The site doesn't have to sign up, and nobody learns what you check.

An altered Safe file was live on a public URL 44.7 hours before the Bybit theft, and no signer's browser could tell. Second Witness is one button that can.

**Live:** [Demo Treasury](DEMO_URL/) · [Witness feed](DEMO_URL/feed/) · [Extension zip](DEMO_URL/second-witness-extension.zip) · [Demo video](VIDEO_URL)

## Try it

1. Unzip the extension, open `chrome://extensions`, turn on Developer mode, and choose Load unpacked.
2. Open the [Demo Treasury](DEMO_URL/), click the extension, and press **Check before signing**. It reads `=` **Same code**.
3. Press Finish, open [Demo control](DEMO_URL/control), and press **Serve this browser altered code**. Only your browser now gets a different file at the same URL, and the page shows a different recipient.
4. Check again. It reads `≠` **Don't sign**, and still does after the server cleans up, because the altered copy keeps running from your cache.
5. Try it on the real thing: [app.safe.global](https://app.safe.global).

## What it says

| | Result | Means |
|---|---|---|
| `=` | Same code | Every file matches what two witnesses recorded. |
| `≠` | Don't sign | This tab runs a file witnesses never recorded under a name that promises fixed content, or that name has held two versions. |
| `?` | Not seen | Witnesses haven't recorded this code, or a script comes from a host not on the site's list. |
| `+` | New release | Witnesses saw it, and its release added addresses or hosts in the last 72 hours, which it lists. Code under an hour old also reads this. |
| `≈` | Partial | The files match, but other code here wasn't compared, witnesses are behind, or one witness recorded another version. |
| `∅` | Can't check | The site isn't listed, or the records are missing or old. |

A false stop costs a signer minutes. A miss cost $1.5B. So red says what to do.

## How it works

1. **Witnesses** crawl each listed site from outside, hash every JavaScript file with SHA-256, and write new hashes to [Arkiv](#arkiv) as write-once records. They run every 15 minutes in [public GitHub Actions](.github/workflows/witness.yml).
2. **The roster** is on ENS: `w1` and `w2` under `secondwitness.eth`. Clear a name and that witness stops counting, in every browser, with nothing to redeploy.
3. **The extension** attaches Chrome's debugger when you press the button and hashes the exact source the JavaScript engine parsed, not a refetched copy. That's how it sees code served only to you, and code still running from cache after the server was cleaned.
4. **The comparison** runs in your browser, against a catalogue it downloads whole on a schedule. No request says which site you're looking at.

Unlike tools that need the site to adopt them or a team to onboard, this needs nothing from the site and sends your browsing to nobody.

## Evidence

- **Bybit replay:** 7 archived captures of Safe's `_app` file, 6 identical. The altered one is 1,994 bytes larger and names Bybit's cold wallet, 44.7 hours before the theft transaction. Through the real comparison code, that capture reads Don't sign. Rerun it with `node replay/fetch-captures.mjs && node replay/run.ts`. The numbers are in [`replay/output.json`](replay/output.json).
- **False alarms:** 0 hash-named files changed across about 532 URLs in 13 samples over 2.8 hours, on 31 sites.
- **Coverage:** a plain crawl found 114 of the 115 first-party files a real browser loaded on Safe, CoW and revoke.cash.
- **Tests:** `npm test` runs 129 tests on the comparison, witness, reader, popup, feed and replay. `node extension/test/e2e.mjs` drives the built extension in real Chrome against the live sites and records.

## CROPS

The lead property is **Secure**: the page you're about to sign on can't vouch for itself, so your browser checks it against records the page doesn't control, without the site's consent and with no server of ours in the path.

- **C:** We control the ENS name, two witness keys and the bundled site list. There is no backend. If we vanish, the records stay readable on Arkiv for 180 days, the check turns Partial within an hour because witnesses stop reporting, and anyone can fork with their own witnesses and ENS name by changing one constant. If the Arkiv or Sepolia RPC refuses you, the popup reads Can't check once records are over an hour old, and never Same code.
- **O:** MIT. `npm ci && npm run build` produces everything, and the [steps below](#run-your-own) run a full copy from this repo alone.
- **P:** The Arkiv and Sepolia RPCs see your IP and that you use Second Witness. They don't see which sites you check, because the extension downloads every record on a schedule. There are no analytics. Witnessed sites see only the witnesses. Our host sees only people who open the feed or demo, and the extension doesn't use it.
- **S:** The extension handles no keys and never touches your wallet or transaction. The debugger attaches only on your click, only to that tab, and Chrome shows a bar while it's on. Witness keys are throwaway testnet keys. Records count only if they're write-once and come from a name on the ENS roster, and two witnesses must agree. You trust the ENS owner to list honest witnesses, and at least one listed witness to report what the site really served.

### What it doesn't catch

- Sites not on the list. There are 4 today: Safe, CoW Swap, revoke.cash and the demo.
- A release served to everyone under a new filename that adds no addresses or hosts. It reads New release for an hour, then Same code. The Bybit file kept its old name, and new addresses are listed for 72 hours.
- The transaction itself. It checks the code you're signing through, not what you sign.
- Code Chrome has already discarded when you press the button. The debugger only replays scripts the engine still holds, so check right before you sign.
- Today we run both witnesses, on different machines. Anyone can join through ENS.

## Arkiv

All witness data lives on Arkiv's Rabdi testnet, and the extension and feed read it directly from the browser.

- **Writers:** `0x109f654ec9c3c235d2f49128f8fa373bb3685821` (w1), `0xec6e879764725c30eca0df033adacdb58a05f632` (w2)
- **One query:** both witnesses' records of Safe's files.

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'sw.obs.v2'"'"') AND site = str('"'"'app.safe.global'"'"') AND ($creator = addr(0x109f654ec9c3c235d2f49128f8fa373bb3685821) OR $creator = addr(0xec6e879764725c30eca0df033adacdb58a05f632))",{"select":{"key":true,"creator":true,"createdAt":true,"updatedAt":true,"expiresAt":true,"creationFlags":true},"limit":"0x5"}]}'
```

More: [schema](arkiv/schema.md), [why Arkiv](arkiv/why-arkiv.md), [how we use it](arkiv/how-you-use-arkiv.md), [reach](arkiv/reach.md), [friction](arkiv/friction.md).

## ENS

`secondwitness.eth` is registered on ENSv2 on Sepolia, with its own resolver from the docs' factory. `w1` and `w2` are subnames answered straight off that resolver through wildcard resolution, with no registry or token for each one. Adding or revoking a witness is one `setAddress`.

The roster is read live in every browser. Clear `w2` and every popup stops counting it, with no redeploy. That revocation is the trust model, not a label on it. Read it with `node ens/read-roster.mjs`. The scripts are in [`ens/`](ens).

## Run your own

```bash
npm ci
npm test
npm run build       # extension/dist and feed/dist
npm run demo        # Demo Treasury on localhost:8787
```

To run your own witnesses, put two funded Rabdi keys in `.env` as in `.env.example`, then run `npm run witness W1_KEY` and `npm run witness W2_KEY`. To point everything at your own roster, register a name with the scripts in `ens/` and change `ENS_PARENT` in `reader/src/index.ts`. The site list and demo origin are in `core/src/sites.ts`.

## How we used AI

Abhishek Uniyal chose the problem, the tracks and the product calls, including the direct wording. Claude Code wrote nearly all of the code, tests and docs under that direction, and ran the research spikes in `spikes/` and `docs/research/`. ChatGPT and Astra acted as outside reviewers, and their findings were accepted or rejected case by case. The specs are in [`docs/`](docs).

## License

[MIT](LICENSE). The Bybit captures are third-party bytes, so only their hashes, times and the changed region are in this repo.
