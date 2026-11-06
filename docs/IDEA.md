# Second Witness

**Before you sign, check whether your browser got the same code witnesses saw on that site, and what that code's latest release added. The site doesn't have to sign up.**

Submissions close Saturday 7 Nov 2026, 09:00 IST. Our target is 08:00.

- **Problem:** signers trust whatever code a website delivered to their browser, and they can't tell whether everyone else got the same code. In the Bybit theft (about $1.5B), altered code sat at a Safe URL for about 46 hours and nobody was comparing.
- **User:** multisig and treasury signers, on a short list of frontends that control a lot of money, starting with Safe. They press one button, "Check before signing". The public feed also lets anyone, including the site's own team, see a change without installing anything.
- **What it says, for the open tab:**
  - **Matches witnesses:** every script was compared and matches N witnesses, first seen X ago. It never says "safe".
  - **Changed in place:** the filename promises fixed content but the code differs. It shows both hashes, plus the witnessed diff if one exists, and never says "hacked".
  - **Not seen:** no trusted witness has seen this code, so wait and recheck. A brand-new or renamed file lands here until witnesses crawl it, usually within 5 minutes.
  - **New release:** witnesses saw this code, but its release added addresses or hosts in the last 72 hours. It lists them, with any address from the tab's URL, such as your Safe, at the top. Ordinary releases skip this.
  - **Partial:** the files match, but other code is running that we can't compare, or witnesses haven't checked the site in the last hour. It says which.
  - **Publisher confirmed:** optional, when the site's ENS name lists this release hash.
- **How it works:**
  - **Witnesses:** a small script on two separate networks, one a public GitHub Actions job anyone can audit, crawls each frontend's JS files outward from its HTML, hashes them and writes new hashes to Arkiv, along with any addresses and hosts the new files add. When code changes in place, the changed region is stored as evidence, because sites clean up afterwards.
  - **Extension:** the button attaches Chrome's debugger to that tab and hashes every script the JS engine parsed, not a refetched copy. It stays attached until you finish, so code loaded later is checked too.
  - **Comparison:** it downloads the whole catalogue on a schedule and compares locally, so no endpoint learns which site you're checking.
- **Trust rules:** anyone can write to Arkiv, so the extension only accepts records from witnesses listed under our ENS name (`w1`, `w2`), and clearing an entry revokes that witness. It needs two witnesses and rejects edited records. First-seen time comes from Arkiv's `$createdAt` block, so a witness can't backdate a record. Each witness also updates one status record every run, so the extension can tell when witnesses stop.
- **Publisher option:** without the publisher we can show code changed, not that they authorized it. A team closes that gap with one ENS text record holding its release hash. Enhanced Access Control limits its CI key to that one record, so a stolen CI key can't change anything else on the name.
- **Prizes, three picks, $8k ceiling plus finalist:**
  - **EF Best CROPS App ($2k top):** the lead track, because it has a matching idea (a tool that checks a shipped frontend) and only the user's own browser does the comparison.
  - **Arkiv Build ($3k top):** the extension and public feed both read the witness records with no backend of ours.
  - **ENSv2 Best Use ($3k top):** witness roster and publisher record. Without ENS there's no public way to admit or revoke witnesses.
  - **Out:** Uniswap, Anon-RPC and 0G.
- **Why this isn't already out there:** Hypernative and Blockaid are closed and sold to teams and wallets. WEBCAT, WAICT and DappFence all need the site to adopt them, and in return they give stronger authenticity than we can. Our claim is separate witnesses, a local check of what actually ran, and a plain list of what each release added, with no enrolment. I found no exact match, but that search wasn't exhaustive.
- **Measured so far, 6 Nov:**
  - **Bybit replay:** 7 archived captures of one Safe file, 6 identical. The altered one is 1,994 bytes larger and contains Bybit's cold wallet address, 44.7 hours before the theft transaction (time read from chain). Astra re-hashed the captures and got the same split.
  - **False alarms, archive:** of 197 files tested on 28 sites, 8 hash-named files changed and none I read was a real code change: HTML fallback pages at JS paths (Pendle, Frax), one debug ID comment and two Vercel deployment IDs. I read 2 of the 4 Frax files. The test favoured files most likely to vary. We ignore non-JS responses and otherwise hash the exact source, because none of the 560 files on our listed sites has a debug ID or deployment ID.
  - **False alarms, live:** no hash-named file changed across about 532 URLs in 13 samples over 2.8 hours, on 31 sites from one network. That's too short a window to call it a rate.
  - **Engine check, local Chrome spike:** with no reload it saw external, inline, eval and dynamically imported code. It caught altered code served only to the user, and altered code still running from cache after the server was cleaned up, when a fresh refetch looked clean.
  - **Engine check, real sites:** its exact hashes, with nothing stripped, matched a plain fetch on all 20 files compared across Safe and revoke.cash, so witnesses don't need a browser. Files were stable across two loads on Safe (5 of 5) and revoke.cash (35 of 35, then 33 of 34 on a rerun I didn't investigate), but some inline or eval scripts on revoke.cash varied. Headless Chrome also froze on Safe and ENS with GPU on, even without the debugger, and the two other sites didn't get tested.
  - **Witness coverage:** a crawl with no browser found 114 of the 115 first-party files a real browser loaded (Safe 54 of 54, CoW 14 of 14, revoke.cash 46 of 47). That's landing pages on one load, so deeper pages are still unmeasured.
  - **Uncompared code, landing pages:** Safe ran none. CoW ran 13 inline scripts plus scripts from 9 other hosts, and revoke.cash ran 6 inline plus Crisp. So Safe can read Matches and those two read Partial.
  - **What releases add:** the altered Bybit file added 5 addresses to the 72 already there, including the cold wallet. None of the 5 appears in any of Safe's 297 current files, so they'd likely stand out even under a new name, though today's files are only a proxy for the 2025 set. Of 7 normal Safe `_app` releases, 4 added nothing and 3 added 1 to 47 addresses plus 1 or 2 hosts. That's one file per release, so whole-release noise is unmeasured. The archive shows 3 to 9 new `_app` files a month, a lower bound on deploys.
- **Cut on purpose:** a Merkle or append-only log, GitHub commit matching, blocking transactions or touching the wallet, Firefox, Swarm, headless browser witnesses, a 40-site catalogue, a Telegram bot, and any bypass of bot challenges. If a site blocks our witness, it stays off the list.
- **Gates, before any UI:**
  1. One Arkiv write and read. The faucet needs a wallet connection, so the user connects a throwaway wallet.
  2. The same engine check inside a real Manifest V3 extension in normal Chrome, on Safe's full app, including how bad the debugger banner feels.
  3. A witness run from GitHub Actions reaches every listed site. A site that blocks it comes off the list.
  4. ENSv2 on Sepolia: register a test name (needs Circle's Sepolia USDC) and limit one key to one text record. If this fails, drop the ENS track and hardcode the roster. EF and Arkiv still give us two tracks.
- **Not proven yet:**
  - Arkiv writes, and the rate limits on reading the catalogue.
  - The debugger flow in a real extension, and a key limited to one text record.
  - How often "New release" fires across whole releases, whether Safe's URL exposes the address as expected, and how noisy "Not seen" gets on deeper pages. The biggest risk is now the debugger flow on Safe, because headless Chrome froze there.
  - Inline, eval and third-party scripts aren't compared, so they make the result Partial. A script from a host not on that site's list reads "Not seen".
  - Service workers and cross-origin iframes aren't covered.
- **Demo, 4 minutes:**
  1. Replay the real Bybit captures: clean, then red with Bybit's address in the diff, then the theft 44.7 hours later.
  2. Live: our demo site serves clean code to witnesses and altered code to the user, and the check catches it. We clean the server and reload, and it's still red because the altered code runs from cache. We then rename the file: it reads "Not seen", then "New release" with the attacker's address listed once witnesses crawl it.
  3. Submit a forged witness record and it's rejected, revoke a witness on ENS, then switch off our feed page and show the check still works.
- **Working when:** on the deployed build, in a fresh Chrome on venue Wi-Fi, all three demo steps pass with real Arkiv records and real Sepolia ENS reads. Live witnesses are covering the short list, and the network log shows the extension making no per-site queries.
- **Good to submit when:**
  - The repo has a FOSS license, a README CROPS section, the Arkiv writer addresses and one runnable query.
  - `/arkiv/` has `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` and `schema.md`.
  - We have the live demo link, AI disclosure and spec files, steady commits, no trackers, a video of 3 minutes or less showing the moment it matters, and a backup recording, all submitted by 08:00.
- **On stage, say this plainly:**
  - The replay shows the alert would have fired 45 hours early, not that the theft would have been stopped.
  - Matching witnesses means the code is consistent, not that it's safe. A changed file means changed, not hacked.
  - New code served to everyone reads "New release" only if it names new addresses or hosts. Code that hides them reads like any new deploy, and the 72 hours can be waited out.
  - Both witnesses are run by us today. The code is open, and the ENS roster is how others join.
  - A witness proves who made a statement, not what the server really sent. That's why we require two.
  - A stolen CI key can still publish a false release hash. The ENS limit only contains the damage.
  - Arkiv records can be deleted by their owner and expire, so this isn't an append-only log. Arkiv is testnet only for now.
  - Safe disputes that its frontend was compromised and blames a developer machine.
  - Clear signing protects the same moment and we complement it. We warn earlier, including about code that never reaches a signature screen.
  - The extension needs a powerful permission, so it's open source and only attaches when you press the button.
