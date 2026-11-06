# How we use Arkiv

## Do the filters, edit rights and expiry fit the app?

- **Filters:** the extension filters on `arkiv.schema` and `$creator` only, and pages by `$key`, because offsets shift when rows land mid-read. Filtering on `site` would be cheaper and would tell the RPC what you're checking, so we don't. `site` and `observedAt` are indexed for everyone else: anyone can pull one site's history with the query in the [README](../README.md#arkiv).
- **Edit rights:** the owner is the witness. Observations and changes are `readonly`, because a witness's record is only worth something if it can't change later. Status is the one mutable entity, because it says "I checked just now" and needs a fresh `$updatedAt`.
- **Expiry:** 180 days. That's long enough to hold "first seen" through normal release cycles without keeping dead files forever. A file still being served when its record expires is simply observed again.

## Does each feature change something users see?

| Arkiv feature | What the signer sees |
|---|---|
| `$creator` with the ENS roster | A record from anyone else never counts. Clear `w2` on ENS and the popup changes. |
| `readonly` and `$updatedAt == $createdAt` | An edited record is dropped, so Don't sign can't be edited away. |
| `$createdAt` | "Newest file 3 days old", the 72-hour New release window, and which version came first when a fixed-name file holds two. |
| `$updatedAt` on status | "2 witnesses checked in the last hour", or Partial when they haven't. |
| Query block number and block time | A frozen or lagging RPC reads Can't check instead of a stale green. |
| Browser reads with CORS and no key | The check works with no backend, and the feed is a static page. |

## Real numbers

From the current baseline on Rabdi, 7 Nov 2026: 8 observations and 2 statuses, holding 571 file and hash pairs across 4 sites. A full baseline for both witnesses took 8 creates. A run with nothing new writes one status patch. Both witnesses have spent about 0.05 test tokens across about 100 transactions, including early tests.
