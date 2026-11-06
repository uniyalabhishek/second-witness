# Gate 2: real MV3 extension on the real Safe app

**Verdict: PASS, with a narrower claim than the PRD makes.**

- A real MV3 extension in branded Chrome 157 hashed everything on Safe in **624 ms** (61 scripts), with no reload, no freeze and no hash errors. Chrome for Testing 153 runs took 670 to 867 ms for 57 to 72 files. The budget is under 2s.
- All 373 first-party file comparisons against a plain Node fetch matched. There were 0 mismatches and 0 fetch failures.
- **What fails:** "every script V8 parsed". `Debugger.enable` only replays scripts V8 still holds. After a forced GC, Safe lost 1 of 54 loaded files, revoke.cash lost all 5 of its HTML inline scripts, and CoW went from 24 empty-URL scripts to about 11. The wording has to become "every script still loaded in the engine". See section 3.

Not tested: a real wallet extension, the banner's Cancel button, a profile with history, a Safe App iframe (Safe's consent dialog blocked it), and the toolbar click itself.

Reproduce: `node spikes/ext-gate/run.mjs all` (about 7 min, opens windows, no install). Branded Chrome and banner: `node spikes/ext-gate/pure.mjs branded`. Raw results are in `spikes/ext-gate/out/`, which is gitignored.

## 1. Measurements

Headed, GPU on, fresh profile, page fully loaded before the button. Empty-URL counts exclude the harness's own 3 evals.

| Page | Attach to all hashed | Largest stall at attach | Files, engine = fetch | HTML inline | Empty URL | Third party |
|---|---|---|---|---|---|---|
| Safe `/` | 823 ms | 703 ms | 58/58 | 0 | 0 | 0 |
| Safe `/welcome/accounts` | 670 ms | 578 ms | 57/57 | 0 | 0 | 0 |
| Safe `/home?safe=` read-only view | 711 ms | 618 ms | 72/72 | 0 | 0 | 0 |
| Safe `/apps/open` (stopped at consent dialog) | 666 ms | 582 ms | 52/52 | 0 | 0 | 0 |
| swap.cow.fi | 613 ms | 519 ms | 15/15 | 0 | 24 | 13 from 11 hosts |
| revoke.cash | 355 ms | 557 ms | 53/53 | 5 | 1 | 4 from 2 hosts |

Isolated world and wasm were 0 on all of these. Safe's counts include 4 service worker files (`sw.js`, `workbox-5ef02f26.js`, `fallback-*.js`, `worker-*.js`), which is why the landing page reads 58 and not 54.

**Against the PRD:** Safe having no uncompared code holds on all 4 pages, including the read-only full app. revoke.cash's "6 inline plus Crisp" holds as 5 HTML inline plus 1 empty-URL, with Crisp and Cloudflare Insights as hosts. CoW is higher than the PRD's "13 inline plus 9 hosts": 24 empty-URL and no HTML inline at all, with 11 hosts. So it still reads Partial, but the numbers move with timing.

**Self-driven runs**, with no CDP client on the page or worker at all:

| Browser | Attach to hashed | Scripts |
|---|---|---|
| Branded Chrome 157 | 624 ms, rerun enable 573 ms | 61 |
| Chrome for Testing 153 | 867 ms | 60 |
| Chrome for Testing 153, without the anti-backgrounding flags, window behind other apps | **1,938 ms** | 61 |

The last row is close to the budget. I think it is because the window was occluded, but I did not isolate that. A user pressing the button has the tab in front.

## 2. Page behaviour

- **No freeze.** Headed Safe with GPU on kept rendering. `requestAnimationFrame` kept firing (253 frames in about 4 s, 1,190 by the end of the landing-page run) and `Runtime.evaluate` round trips took 2 to 7 ms.
- **There is one real stall.** `Debugger.enable` blocks the main thread for 519 to 703 ms on these sites, against a baseline of about 20 ms. It happens once, and the peak did not grow later in the session. On a large page, the user will notice a brief hitch on pressing the button.
- **Later scripts are caught.** SPA navigation to `/settings` on Safe added 8 files, all matching fetch.
- **Worker survives.** Control with no session: the worker was gone at 30 s. Attached on a quiet page: alive at 75 s with the same boot ID, and a later eval still got hashed. After Finish: gone at 30 s. Nothing was attached to the worker, because Playwright's auto-attach would have voided this test, which is why the harness is raw CDP.
- **`debugger;` page:** kept ticking (40 ticks in 800 ms) with 0 pauses.
- **Navigation while attached:** kept reporting. New scripts arrived and old ones must be dropped. **4 `Debugger.paused` events fired after navigating**, so the resume handler is needed even with `setSkipAllPauses`.
- **Finish:** clean detach, no errors. **Tab close:** `onDetach` fires `target_closed`, and a following `chrome.debugger.detach` rejects with "No tab with given id". That is harmless, but it needs a catch.

## 3. The limit on "every script"

On a local page where scripts leave no live functions, after a forced GC, replay showed only the script with a retained function. The one-shot external file, inline script and eval were gone. On real sites after forced GC:

| Site | Loaded but not replayed | Inline after GC | Empty URL after GC |
|---|---|---|---|
| Safe | `_ssgManifest.js` (1 of 54) | 0 | 1 (likely ours) |
| CoW | `w.appzi.io/bootstrap/bundle.js` (1 of 24) | 0 | 14, of which about 3 ours |
| revoke.cash | `/431852cb494ae7c6/script.js` (1 of 56) | 0, from 5 | 1 |

Forced GC is the worst case. Without it, a page 5 seconds after load had 0 loaded files missing on all sites. Natural GC will land somewhere between, and this likely explains the unexplained revoke.cash variance in `IDEA.md`.

**What it means:**

- Code that leaves a live function behind, as a chunk that registers modules or a patch to a function does, is still seen. One-shot code that ran and left nothing is not. An attacker who knows this could use it.
- A site could read **Partial today and Matches after a GC**, because uncompared scripts disappear. Absence of inline scripts is not evidence.
- **Cheap partial fix:** compare `performance.getEntriesByType('resource')` against the parsed URLs, and report any loaded `.js` that wasn't replayed as uncompared. This was the cross-check used here, and it caught all 3 files above. It cannot detect gone inline or eval scripts. `Page.getResourceTree` may be a way to do it without evaluating in the page, but that is untested.

## 4. Corrections to the PRD

**`classify`**, replacing rules 1 and 2:

1. `executionContextAuxData.type === 'isolated'`, or a `chrome-extension://` URL with `hasSourceURL` false: **ignored**.
2. `scriptLanguage === 'WebAssembly'`, `hasSourceURL`, empty URL, nonzero `startLine` or `startColumn`, or any non-http(s) URL: **uncompared**.

Evidence for each change:

- **Spoof, confirmed.** `eval("...\n//# sourceURL=chrome-extension://aaa.../inpage.js")` reports that URL with `hasSourceURL: true`, `isDefault: true`, `type: default`. The PRD's rule 1 reads it as ignored, so a page could hide code. Real extension scripts have `hasSourceURL: false`, and `embedderName` is also `chrome-extension://...` for them and empty for the spoof.
- **Do not test `!isDefault`.** Worker and service worker scripts have **no `executionContextAuxData` at all**, so that test would ignore page workers. Only the real content script reported `isDefault: false`, `type: isolated`. Same-origin iframes, same-origin `srcdoc` and out-of-process iframes all report `true/default`.
- **Inline start position, confirmed.** All external files are at 0,0: Safe 58/58, CoW 15/15, revoke.cash 53/53, third-party 17/17. All HTML inline scripts are nonzero: revoke.cash 5/5 (for example line 8, column 244700), plus 5 locally including `srcdoc`. Inline `url` is the document URL **at parse time**, so one inline script before `pushState` and one after reported different URLs on the same page. `getFrameTree` only returns the latest, so URL matching cannot work.
- **Scripts created at runtime** (`createElement` with `textContent`, and `document.write`) report an empty URL at 0,0, so the empty-URL rule catches them. This is inferred from the row count on the test page, as I did not read those two rows' source.
- **Other schemes.** `blob:` same-origin reads as **file** under the PRD. `data:`, `wasm://` and `about:srcdoc` read as thirdParty with a meaningless host, which would give a false Not seen. All should be uncompared.

**Wasm.** `getScriptSource` returned `bytecode` (base64) with an empty `scriptSource`, as documented, and `url` was `wasm://wasm/<id>`.

**Not in the PRD, needed:**

- **`Target.setAutoAttach {autoAttach:true, waitForDebuggerOnStart:false, flatten:true}`.** Without it the root session misses workers, service workers and cross-origin iframes. Each child needs its own `Debugger.enable`, `setSkipAllPauses`, and `setAutoAttach` (not recursive). `chrome.debugger` allowed all of these: worker, service worker and iframe sessions all worked.
- **Counting cross-origin frames.** `Page.getFrameTree` on the root **does not list out-of-process iframes**, and the 127.0.0.1 frame was missing locally. Count `Target.attachedToTarget` with `type: iframe`. CoW has one (a Google Tag Manager `ns.html` frame, with no scripts in it).
- **Do not use `Runtime.evaluate` in the tab during the check.** Each call shows up as an empty-URL script, which would make Safe read Partial because of our own extension.
- **Witness seeds.** `workbox-5ef02f26.js` and CoW's `service-worker.js` are not in `crawl_probe.json`. They would read Not seen on every check, so Safe could not read Matches. Add them to `seeds`, or decide service workers are out of scope and say so in the popup.
- **Navigation.** There is no `Debugger.scriptsCleared` in the protocol, so reset on `Page.frameNavigated` for the main frame.

**Permissions.** Attaching worked with no toolbar gesture, so `activeTab` is not needed for `chrome.debugger`. It is only needed for reading the tab's URL in the popup. `debugger`, `storage` and `alarms` are the essentials. Chrome's install warning for `debugger` was not checked here.

**Optional speedup.** `scriptParsed.hash` is a full SHA-256, and its first 128 bits equalled ours on 497 of 497 scripts, so a verdict could skip fetching source. `surface()` and diffs still need `getScriptSource`. `Debugger.enable` takes nearly all the time and hashing adds only 1 to 32 ms, so I would keep hashing ourselves.

## 5. Wallet extensions

Test extension, on a local page and on Safe:

| How it injects | `url` | `isDefault` / `type` | `hasSourceURL` | PRD result |
|---|---|---|---|---|
| Content script, default world | `chrome-extension://id/iso.js` | false / isolated | false | ignored |
| Content script, `world: MAIN` | `chrome-extension://id/inpage-main.js` | true / default | false | ignored, by URL |
| `<script src>` of a web-accessible file | `chrome-extension://id/inpage-war.js` | true / default | false | ignored, by URL |
| Inline tag added from an MV3 content script | never appeared | | | |

With these loaded, Safe's result didn't change: 58/58 files, and 3 ignored. The inline tag not appearing is probably the MV3 isolated-world CSP, but I did not confirm that.

**Not tested:** a real wallet. If a wallet's main-world code calls `eval` or builds an inline script, it would be an empty-URL script, indistinguishable from the page's, and Safe would read Partial. Try this by hand with MetaMask and Rabby before the demo.

## 6. The debugger banner (branded Chrome 157)

Screenshots: `out/branded-before.png`, `branded-attached.png`, `branded-othertab.png`.

- Text: **'Second Witness gate spike' started debugging this browser**, with a Cancel button and a close X. It says "this browser", not this tab, and that reads badly to someone about to sign.
- **It pushes the page down by about 56 CSS px**, measured between screenshots. The layout moves when the button is pressed, so anything under the cursor shifts.
- **It shows on other tabs too.** Confirmed on another tab in the same window while attached to Safe. Other windows are not tested.
- **It lingers after detach.** Still there 1.5 s after a successful detach, gone by about 6.5 s.
- Chrome for Testing shows its own infobar and did **not** show the debugger banner, so banner behaviour can only be judged in branded Chrome.
- **Cancel not clicked.** Docs say it ends the session with `canceled_by_user`. The product must handle that as "stopped checking" and must not leave a stale verdict up.

**Feel:** tolerable for a deliberate "Check before signing" press. It is alarming if unexplained, so the popup should say it is expected before it appears, and Finish should be prominent so it doesn't sit there.

## 7. How this was run

- **Harness:** raw CDP instead of Playwright, for the worker test. Each button press is a real `click()` on the popup's button, in a popup page opened as a tab. The harness steps off the page before the extension attaches.
- **Branded Chrome** ignores `--load-extension`, so it is loaded via `--remote-debugging-pipe --enable-unsafe-extension-debugging` and `Extensions.loadUnpacked`. The extension then drives itself and reports to a local server.
- **Sites were only viewed.** No sign-in, no wallet, and Safe's consent dialog was left unanswered. The read-only Safe view used Bybit's public cold wallet address.

## 8. Docs notes

- `chrome.debugger`: flat sessions since Chrome 125, `onDetach` reasons `target_closed` and `canceled_by_user`, and the API page does not mention the banner.
- Service worker: 30 s idle stop, and "Chrome 118: an active debugger session keeps the worker alive". Measured above, and it holds.
- `chrome.storage.session`: 10 MB, memory only, cleared on reload or browser restart.
- `Debugger.scriptParsed` fields used: `url, startLine, startColumn, hash, executionContextAuxData {isDefault, type, frameId}, hasSourceURL, isModule, length, scriptLanguage, embedderName`.
