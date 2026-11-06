# Why Arkiv

## If we swapped Arkiv for Postgres, what would users lose?

The product. Second Witness exists so a signer doesn't have to trust one party's server about what a website served.

- **Nobody can rewrite history, including us.** Observations are `readonly`, and the extension drops any record whose `$updatedAt` differs from `$createdAt`. In Postgres, whoever holds the database can quietly change what was "first seen".
- **Each record is signed by its witness.** `$creator` is the witness's address, and it's checked against the ENS roster in the browser. In Postgres, we'd be the one saying who wrote what.
- **There is no server to learn what you check.** The extension reads from Arkiv with CORS and no API key, and pulls the whole catalogue. A server of ours would see every signer's IP, at the very moment they're about to move money.
- **It outlives us.** Stop paying for Postgres and the check dies. Here the records stay readable for 180 days and any fork can keep reading them.

## What we kept off Arkiv

- **Which sites you check:** it never leaves the browser.
- **File bodies:** witnesses cache them locally. Only hashes, and up to 16 KiB of changed region, go on chain. A 3 MB Safe bundle has no business in a database, and the hash is all the comparison needs.
- **The roster:** it's on ENS, so admitting and revoking a witness has one public owner and a name people can read.
- **The site list:** it's bundled with the extension, so an attacker can't add a site by writing a record.
