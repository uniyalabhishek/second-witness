// Read-only, needs no key. node ens/read-roster.mjs
import { client, NAME, ROSTER } from './config.mjs'
import { readRoster } from './roster.mjs'

for (const { name, address } of await readRoster(client, NAME, ROSTER)) {
  console.log(`${name}  ${address ?? 'null (empty or revoked)'}`)
}
