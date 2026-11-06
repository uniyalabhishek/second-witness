// The contract every part of Second Witness shares. Pure types, no runtime code.

export const BLOCK_SECONDS = 2;
export const WITNESS_FRESH_SECONDS = 3600;
export const CATALOGUE_FRESH_SECONDS = 3600;
export const NEW_RELEASE_SECONDS = 72 * 3600;
/** Code first seen this recently isn't green yet, even with nothing added. */
export const NEW_CODE_SECONDS = 3600;
/** How far the chain head may sit from the local clock when records are read. */
export const HEAD_BEHIND_SECONDS = 300;
export const HEAD_AHEAD_SECONDS = 60;
export const MIN_WITNESSES = 2;

export const SCHEMA_OBS = 'sw.obs.v2';
export const SCHEMA_CHANGE = 'sw.change.v2';
export const SCHEMA_STATUS = 'sw.status.v2';

/** A listed frontend. */
export interface Site {
  /** Key, also the `site` attribute on Arkiv. */
  id: string;
  /** Origins whose scripts count as first-party files. */
  origins: string[];
  /** Pattern for paths whose name promises fixed content. Other files compare by exact hash only. */
  immutable: string;
  /** Hosts allowed to serve third-party scripts. Their code is uncompared. Any other host reads Not seen. */
  thirdParty: string[];
  /** Paths the crawl misses. */
  seeds: string[];
  /** Page the crawl starts from, when the root doesn't load the app. */
  home?: string;
}

/** The fields of CDP `Debugger.scriptParsed` we rely on, plus the hash once source is read. */
export interface ParsedScript {
  url: string;
  /** Where the browser loaded this from. A page can't set it, and it's empty for code built at runtime. */
  embedderName?: string;
  /** `executionContextAuxData.type === 'isolated'`. Worker scripts have no aux data at all, so they read false. */
  isolated: boolean;
  hasSourceURL: boolean;
  startLine: number;
  startColumn: number;
  /** `scriptLanguage`, 'JavaScript' or 'WebAssembly'. */
  language?: string;
  /** `hashCode(source)`. Absent until read, or when the source couldn't be read. */
  hash?: string;
}

export type UncomparedReason = 'inline' | 'eval' | 'wasm';

export type ScriptClass =
  | { kind: 'ignored' }
  | { kind: 'uncompared'; reason: UncomparedReason }
  | { kind: 'thirdParty'; host: string; listed: boolean }
  | { kind: 'file'; path: string };

export interface Surface {
  addrs: string[];
  hosts: string[];
}

/** One `sw.obs.v2` entity after trust checks. */
export interface Observation {
  witness: string;
  site: string;
  createdAtBlock: number;
  files: [path: string, hash: string][];
  added: Surface;
  /** Totals before the 50-per-kind cap on `added`. */
  addedTotals: { addrs: number; hosts: number };
}

/** One `sw.change.v2` entity after trust checks. */
export interface ChangeRecord {
  witness: string;
  site: string;
  createdAtBlock: number;
  path: string;
  oldHash: string;
  newHash: string;
  sizes: [oldSize: number, newSize: number];
  /** Changed region of the new file, capped at 16 KiB. Null if the old file wasn't cached. */
  region: string | null;
  /** Byte offset in characters where the region starts. */
  offset: number | null;
}

/** One `sw.status.v2` entity after trust checks. */
export interface WitnessStatus {
  witness: string;
  updatedAtBlock: number;
  ok: string[];
}

export interface RosterEntry {
  /** ENS label such as `w1`. */
  label: string;
  /** Lowercase address. */
  address: string;
}

/** Everything the comparison needs. Built only from roster-accepted entities. */
export interface Catalogue {
  /** Local clock when this catalogue was fetched, in milliseconds. */
  fetchedAt: number;
  headBlock: number;
  /** Chain time of the head block, in seconds. A frozen RPC can't fake this against the local clock. */
  headTime: number;
  roster: RosterEntry[];
  observations: Observation[];
  changes: ChangeRecord[];
  statuses: WitnessStatus[];
}

export type ResultKind = 'matches' | 'changed' | 'notSeen' | 'newRelease' | 'partial' | 'cantCheck';

export interface ChangedFile {
  path: string;
  tabHash: string;
  /** Hashes at this path that reached the witness threshold. */
  witnessedHashes: string[];
  /** This tab holds the first recorded version, and a later one appeared in the last 72 hours. */
  original?: boolean;
  evidence?: ChangeRecord;
}

export interface AddedItem {
  value: string;
  /** True when this address also appears in the tab's URL, such as your Safe. */
  inTabUrl: boolean;
}

export interface Verdict {
  result: ResultKind;
  /** Short machine reason when the result is cantCheck. */
  cantCheckReason?: 'siteNotListed' | 'catalogueStale' | 'noRoster' | 'noCatalogue';
  /** Witnesses behind the weakest matched file. */
  witnessCount: number;
  /** Age of the newest matched file by first-seen block. Plain information, never a judgement. */
  newestFileAgeSeconds: number | null;
  /** First-party files compared in this tab. */
  filesCompared: number;
  changed: ChangedFile[];
  notSeen: string[];
  /** Fixed-name files in this tab where one listed witness recorded a different version. */
  disputed: string[];
  /** Script hosts not on the site's list. */
  unknownHosts: string[];
  uncompared: {
    inline: number;
    eval: number;
    wasm: number;
    /** Listed third-party hosts with a count of their scripts. */
    thirdParty: { host: string; scripts: number }[];
    /** Frames, worklets and workers the check couldn't read. */
    frames: number;
  };
  /** Scripts other extensions put in this tab, such as a wallet's. Left out of the comparison, and shown so the count adds up. */
  extensionScripts: number;
  /** Set when a release this tab holds added addresses or hosts in the last 72 hours, or its code is under an hour old. */
  release?: {
    ageSeconds: number;
    addrs: AddedItem[];
    hosts: AddedItem[];
    totals: { addrs: number; hosts: number };
  };
  /** Witnesses with a fresh status for this site. */
  freshWitnesses: number;
  /** Seconds since the most recent witness status for this site. Null if none. */
  lastCheckedSeconds: number | null;
}
