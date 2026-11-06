# Second Witness design

## Principles
1. **The word is the product.** A signer under pressure reads one word. Everything else is evidence below it.
2. **A sign carries the meaning colour can't.** Each result pairs its word with a comparison sign, so it reads in greyscale, for colour-blind users and in the toolbar badge: `=` Same code, `≠` Don't sign, `?` Not seen, `+` New release, `≈` Partial, `∅` Can't check.
3. **Say what to do.** Red is an instruction: "Don't sign." A false stop costs minutes, and a miss cost $1.5B. Only Don't sign fills a plate. Same code is a green word on the plain page, with no tick and no banner. Lists and records name the same results Matches and Changed.
4. **Colour only means a result.** No brand colour, no accent. The primary button is ink. Any other colour on screen would dilute red.
5. **Evidence is always exact.** Mono for every hash, address, path and host. Addresses stay whole wherever they fit, because shortened addresses are how poisoning works.

## Palette
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#1a1c1f` | Page |
| `--surface` | `#f3f4f5` | `#25282c` | Changed region only |
| `--ink` | `#16181b` | `#eceef0` | Text, primary button, focus |
| `--ink-2` | `#565a61` | `#a9adb3` | Labels, notes |
| `--rule` | `#d8dadd` | `#3a3d42` | Hairlines |
| `--rule-strong` | `#868a91` | `#7f838a` | Section rules, outlined button |
| `--green` | `#0b6b4f` | `#52c79f` | Same code. Leans teal to separate from red for colour-blind users |
| `--amber` | `#875400` | `#e3ad4a` | Not seen, New release, Partial |
| `--red` | `#b4260f` | `#ff8f78` | Don't sign as text. Leans orange, same reason |
| `--grey` | `#565a61` | `#a9adb3` | Can't check |
| `--red-fill`, `--on-red` | `#b4260f`, `#ffffff` | `#c0301a`, `#ffffff` | Don't sign plate |

## Type and space
- Sans: `system-ui` stack. Mono: `ui-monospace` stack. No web fonts, because the privacy claim forbids third-party requests.
- Sizes: 12 (labels, mono), 14 (body), 18 (page titles, progress count), 28 (result word, amount). Weights: 400, 600.
- Space: 4, 8, 16, 24, 48. Radius: 3px, buttons only. Rule: 1px.
- Motion: none.

## Result block anatomy
`.result[data-result]` holds `.result-head` (sign in mono regular, word in sans 600, both 28px) and `.result-text` (one or two plain sentences, 14px). Set `data-result` to `matches`, `changed`, `not-seen`, `new-release`, `partial` or `cant-check`. Evidence follows as `.row` label and value pairs or `.list`. `.result-inline` is the same pair at text size for tables and lines.

Values: `.value` is a button. It cuts in the middle only when short of room, keeping the tail. `.value--hash` always shows 8 and 8. Click copies the full value, focus reveals it in place, and selecting text copies the whole value because the cut is CSS only. Lift the copy script at the end of any mock.

Badge: set the toolbar badge text to the sign and its background to the result colour.

## Layout
**Popup:** 360px wide, under 560px tall (tallest state 524px). Order: host in mono, result, evidence, then a sticky footer with the attached line and Finish. Regions scroll at 96px and never sideways.

**Feed:** 1120px max. Each section is a 200px side column (title, one line) and a main column, split by a strong hairline. Below 720px it becomes one column with a 16px gutter and tables stack. Order: Witnesses, Sites, Changed, Bybit replay. The replay's memorable piece is the true-time axis, with signs placed at real capture times and a bracket from `≠` to the theft. It is hidden on phones, and the ledger below carries the same facts for every width and for screen readers.

**Demo Treasury:** 560px single column. Amount at 28px, then ruled rows, then Sign payment. Keep `id="recipient"`, since the altered code swaps it.

## Popup copy
**Idle:** "Check the code in this tab against what everyone else got." Button: "Check before signing". Note: "Attaches Chrome's debugger to this tab until you press Finish. The comparison runs in this browser. Witness records updated 6 minutes ago."
**After Finish:** "Last check: = Matches, 4 minutes ago. Code loaded since then was not compared."
**Checking:** "Hashing 31 of 54 scripts". "No result yet. Witness records updated 6 minutes ago."
**Attached footer, every result:** "Updated 12 seconds ago. Chrome shows a debugger bar until you finish." Button: "Finish".
**Attached, updated by itself:** row "Before: ? Not seen until 3 min ago". Row "Compared: 56 of 56 scripts, 2 loaded after you started".
**Same code:** "This tab is running what everyone else got. Newest file 3 days old." Row "Compared: 60 files from 62 scripts. 2 from browser extensions, not compared."
**Don't sign:** "This tab is running different code from what everyone else got." Then "Tell the other signers. Check again from another device." Heading: "Witnessed change, 2 min ago".
**Don't sign, tab holds the later version:** "This file's name promises fixed content, and this tab is running a changed version." No region: "Witnesses kept no changed region for this file."
**Don't sign, tab holds the original:** "This file's name promises fixed content, and witnesses recorded a changed version in the last 72 hours. This tab has the original, but the site has served different code."
**Not seen:** "Don't sign yet. Two witnesses have not recorded this code. New files usually clear within 30 minutes. This updates on its own, no reload needed." Only a host: "A script here comes from a host not on this site's list. Check it before signing. Witnesses only record the site's own files, so this stays until the list is updated." Both: the first two sentences, then "A host not on this site's list stays until the list is updated." Lists: "First-party file, 1 of 2 witnesses", "Host not on this site's list".
**New release:** "Witnesses saw this code. Its release added addresses and a host in the last 72 hours. Check what it added before signing." Nothing added: "Witnesses first saw this code 10 minutes ago, and it added no addresses or hosts. This clears after an hour." Lists, in order: "Added, and in this tab's URL", "Also added, 4 addresses", "Added, 1 host".
**Partial, uncompared:** "14 files match 2 witnesses. Other code is running here that was not compared." Lists: "Not compared", "Scripts from 3 listed hosts".
**Partial, one witness differs:** "54 files match 2 witnesses. One witness recorded a different version of a file whose name promises fixed content." List: "File one witness recorded differently".
**Partial, witnesses behind:** "54 files match 2 witnesses. Fewer than 2 witnesses checked this site in the last hour."
**Several amber reasons:** the worst result heads the popup, then row "Also: ≈ Partial" and its list.
**Can't check, not listed:** "This site isn't on the witness list, so there is nothing to compare with." "The debugger was not attached."
**Can't check, stale:** "The witness records in this browser are 3 hours old. They need to be under 1 hour old."
**Can't check, roster:** "The witness roster on secondwitness.eth can't be read right now, so no record can be counted."

## Contrast
Output of `node design/contrast.mjs`:

| Text on background | Light | Dark | Needs |
|---|---|---|---|
| ink on bg | 17.79 | 14.68 | 4.5 |
| ink on surface | 16.15 | 12.73 | 4.5 |
| ink-2 on bg | 6.93 | 7.57 | 4.5 |
| ink-2 on surface | 6.29 | 6.57 | 4.5 |
| bg on ink | 17.79 | 14.68 | 4.5 |
| green on bg | 6.50 | 8.15 | 4.5 |
| amber on bg | 6.37 | 8.41 | 4.5 |
| red on bg | 6.51 | 7.69 | 4.5 |
| grey on bg | 6.93 | 7.57 | 4.5 |
| on-red on red-fill | 6.51 | 5.71 | 4.5 |
| rule-strong on bg | 3.47 | 4.49 | 3 |
All pairs pass.

## Do not
- Use safe, hacked, secure, verified, protected, trusted, malicious or attack in result copy, or write anything implying a transaction is OK to sign.
- Fill Same code, or add a tick, a shield or a "you're good" line.
- Add a colour, gradient, shadow, icon set, pill, uppercase label, card, or web font.
- Show a result word without its sign, or cut an address that fits.
- Show a stale result as current. After Finish it becomes "Last check", with its age.

## Data in the mocks
The Bybit file path, hashes, byte counts, times, addresses and added code are real, computed from `replay/captures`. Everything else is sample data.
