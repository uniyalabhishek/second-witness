# Schema

All entities are written with `@arkiv-network/sdk` to Rabdi by the witness keys listed on ENS. Bodies are UTF-8 JSON in a `bytes` column.

| Entity | Attributes | Body | Owner | Edits | Expires |
|---|---|---|---|---|---|
| `sw.obs.v2`, one per run with something new | `site` (indexed), `observedAt` (indexed `u64`) | `files`: path and SHA-256 pairs. `added`: up to 50 new addresses and hosts. `totals`: true counts | The witness | Never: `readonly` | 180 days |
| `sw.change.v2`, one per fixed-name file that changed | `site` (indexed), `old`, `new` | `path`, `sizes`, up to 16 KiB of `region`, `offset` | The witness | Never: `readonly` | 180 days |
| `sw.status.v2`, one per witness | none | `ok`: sites reached on the last run | The witness | Patched each run | 180 days |

## What we query

| Who | Filter | Why |
|---|---|---|
| Extension and feed | `arkiv.schema` and `$creator`, paged by `$key` | Pulls the whole catalogue of roster witnesses. It never filters by `site`, so the RPC can't learn which site you're checking. |
| Witness | `arkiv.schema` and its own `$creator` | Finds what it already wrote, and writes only new pairs. |
| Anyone else | `site`, `observedAt` | One site's history, or a time window, with no copy of the catalogue. |

## What we read from each entity

- `$creator`: must be on the ENS roster, or the record is dropped.
- `$creationFlags.readonly` and `$updatedAt == $createdAt`: required on observations and changes, or the record is dropped.
- `$createdAt`: decides when a version was first seen, and so every age the popup shows and the 72-hour window.
- `$updatedAt` on a status: decides whether a witness checked in the last hour.

Malformed records are dropped one at a time, and everything reaches HTML escaped. The code is in [`core/src/entities.ts`](../core/src/entities.ts).
