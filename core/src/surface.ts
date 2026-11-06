import type { Surface } from './types.ts';

const ADDRESS = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;
const HOST = /(?:https?|wss?):\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi;

/** Addresses and hosts named in a source file, lowercased, sorted and de-duplicated. */
export function surface(src: string): Surface {
  const addrs = new Set<string>();
  const hosts = new Set<string>();
  for (const m of src.matchAll(ADDRESS)) addrs.add(m[0].toLowerCase());
  for (const m of src.matchAll(HOST)) hosts.add(m[1]!.toLowerCase());
  return { addrs: [...addrs].sort(), hosts: [...hosts].sort() };
}

/** What `next` names that `known` doesn't, capped per kind, with totals before the cap. */
export function addedTo(next: Surface, known: Surface, cap: number): { added: Surface; totals: { addrs: number; hosts: number } } {
  const knownAddrs = new Set(known.addrs);
  const knownHosts = new Set(known.hosts);
  const addrs = next.addrs.filter(a => !knownAddrs.has(a));
  const hosts = next.hosts.filter(h => !knownHosts.has(h));
  return { added: { addrs: addrs.slice(0, cap), hosts: hosts.slice(0, cap) }, totals: { addrs: addrs.length, hosts: hosts.length } };
}

/** The part of `next` that differs from `old`, by common prefix and suffix, capped at `cap` characters. */
export function changedRegion(old: string, next: string, cap: number): { offset: number; region: string } {
  const max = Math.min(old.length, next.length);
  let prefix = 0;
  while (prefix < max && old[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  return { offset: prefix, region: next.slice(prefix, next.length - suffix).slice(0, cap) };
}

/** Addresses in a tab URL, such as the Safe in `?safe=eth:0x...`. */
export function addressesInUrl(url: string): string[] {
  let text = url;
  try {
    text = decodeURIComponent(url);
  } catch {
    // Malformed escapes: search the raw text instead.
  }
  return surface(text).addrs;
}
