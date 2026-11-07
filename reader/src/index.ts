// Read side shared by the witness, the extension and the feed. RPC failures throw, so a caller
// can't mistake an outage for an empty roster or an empty catalogue.
import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { asc } from '@arkiv-network/sdk/query';
import { createPublicClient as createEthClient, hexToBytes, http } from 'viem';
import { getEnsAddress } from 'viem/actions';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';
import { acceptChange, acceptObservation, acceptStatus, type RawEntity } from '../../core/src/entities.ts';
import { SCHEMA_CHANGE, SCHEMA_OBS, SCHEMA_STATUS, type Catalogue, type RosterEntry } from '../../core/src/types.ts';

export const ARKIV_RPC = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
export const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const ENS_PARENT = 'secondwitness.eth';
const LABELS = ['w1', 'w2', 'w3', 'w4', 'w5'];

const PAGE = 100;
/** A listed witness flooding records fails the read, which ends in Can't check rather than a partial catalogue. */
const MAX_PAGES = 200;

/** Empty or revoked names are left out. */
export async function fetchRoster(sepoliaRpc: string, parent = ENS_PARENT): Promise<RosterEntry[]> {
  const client = createEthClient({ chain: sepolia, transport: http(sepoliaRpc) });
  const names = await Promise.all(
    LABELS.map(async label => ({ label, address: await getEnsAddress(client, { name: normalize(`${label}.${parent}`) }) })),
  );
  return names.flatMap(({ label, address }) => (address ? [{ label, address: address.toLowerCase() }] : []));
}

type Row = {
  $key?: unknown;
  $creator?: unknown;
  $createdAt?: unknown;
  $updatedAt?: unknown;
  $creationFlags?: { readonly?: unknown };
  $attributes?: Record<string, { type?: unknown; value?: unknown }>;
};

/** Hostile rows are expected here. Anything malformed returns null and the rest of the page still counts. */
export function rowToEntity(row: Row): RawEntity | null {
  try {
    const { $key: key, $creator: creator, $attributes: attributes } = row;
    if (typeof key !== 'string' || typeof creator !== 'string' || !attributes) return null;
    const attrs: Record<string, unknown> = {};
    for (const [name, attr] of Object.entries(attributes)) attrs[name] = attr.value;
    const body = attrs.body;
    delete attrs.body;
    return {
      key,
      creator: creator.toLowerCase(),
      createdAtBlock: Number(row.$createdAt),
      updatedAtBlock: Number(row.$updatedAt),
      readonly: row.$creationFlags?.readonly === true,
      attrs,
      ...(typeof body === 'string' && body.startsWith('0x') ? { bodyBytes: hexToBytes(body as `0x${string}`) } : {}),
    };
  } catch {
    return null;
  }
}

const SELECT = { $key: true, $creator: true, $createdAt: true, $updatedAt: true, $creationFlags: true, $attributes: true };

function arkivClient(arkivRpc: string) {
  return createPublicClient({ chain: rabdi({ accessKey: '' }), transport: http(arkivRpc) });
}

/** Every entity of a schema by these creators. Pages by key, because offsets shift when rows are written mid-read. */
export async function fetchEntities(arkivRpc: string, schema: string, creators: string[]): Promise<RawEntity[]> {
  if (creators.length === 0) return [];
  const client = arkivClient(arkivRpc);
  const base = `arkiv.schema = str('${schema}') AND (${creators.map(c => `$creator = addr(${c})`).join(' OR ')})`;
  const entities: RawEntity[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = after ? `${base} AND $key > key(${after})` : base;
    const result = await client.query(query, { select: SELECT, orderBy: asc('$key'), limit: PAGE });
    for (const row of result.entities as Row[]) {
      const entity = rowToEntity(row);
      if (entity) entities.push(entity);
    }
    if (result.entities.length < PAGE) return entities;
    after = (result.entities.at(-1) as Row).$key as string;
  }
  throw new Error(`more than ${MAX_PAGES} pages of ${schema}`);
}

export async function fetchCatalogue(arkivRpc: string, roster: RosterEntry[], now: number): Promise<Catalogue> {
  const creators = roster.map(r => r.address);
  const allowed = new Set(creators);
  const [obs, changes, statuses] = await Promise.all(
    [SCHEMA_OBS, SCHEMA_CHANGE, SCHEMA_STATUS].map(schema => fetchEntities(arkivRpc, schema, creators)),
  );
  const head = await arkivClient(arkivRpc).getBlock();
  return {
    fetchedAt: now,
    // Both from one block. A lagging query answers with an older block, which would make old records look new.
    headBlock: Number(head.number),
    headTime: Number(head.timestamp),
    roster,
    observations: obs!.flatMap(e => acceptObservation(e, allowed) ?? []),
    changes: changes!.flatMap(e => acceptChange(e, allowed) ?? []),
    statuses: statuses!.flatMap(e => acceptStatus(e, allowed) ?? []),
  };
}
