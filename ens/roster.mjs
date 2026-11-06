// Browser-safe roster read: viem only, no node imports, no key. The extension and feed can import this.
import { getEnsAddress } from 'viem/actions'
import { normalize } from 'viem/ens'

// Returns [{ label, name, address }]. address === null means that slot is empty or revoked.
// RPC failures throw, so callers can't mistake an outage for a revocation.
export function readRoster(client, parent = 'secondwitness.eth', labels = ['w1', 'w2', 'w3', 'w4', 'w5']) {
  return Promise.all(labels.map(async (label) => {
    const name = normalize(`${label}.${parent}`)
    return { label, name, address: await getEnsAddress(client, { name }) }
  }))
}
