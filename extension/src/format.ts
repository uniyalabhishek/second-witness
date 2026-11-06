// Shared by the popup and the feed. Every value from a witness record reaches HTML through esc().
import type { ResultKind } from '../../core/src/types.ts';

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, c => ENTITIES[c]!);
}

function unit(n: number, name: string): string {
  return `${n} ${name}${n === 1 ? '' : 's'}`;
}

function span(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return unit(s, 'second');
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour');
  return unit(Math.floor(s / 86400), 'day');
}

export const ago = (seconds: number): string => `${span(seconds)} ago`;
export const age = (seconds: number): string => `${span(seconds)} old`;

/** A grouped number, escaped. */
export const num = (n: number): string => esc(Number(n).toLocaleString('en-US'));

/** "1 file", "1,994 files", escaped. */
export const count = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** `head` is what a signer reads on their own tab. `word` names the result in lists and records. */
export const RESULTS: Record<ResultKind, { slug: string; sign: string; word: string; head: string }> = {
  matches: { slug: 'matches', sign: '=', word: 'Matches', head: 'Same code' },
  changed: { slug: 'changed', sign: '≠', word: 'Changed', head: "Don't sign" },
  notSeen: { slug: 'not-seen', sign: '?', word: 'Not seen', head: 'Not seen' },
  newRelease: { slug: 'new-release', sign: '+', word: 'New release', head: 'New release' },
  partial: { slug: 'partial', sign: '≈', word: 'Partial', head: 'Partial' },
  cantCheck: { slug: 'cant-check', sign: '∅', word: "Can't check", head: "Can't check" },
};

/** An unknown kind reads Can't check, never a word it didn't earn. */
export const resultOf = (kind: string) => RESULTS[kind as ResultKind] ?? RESULTS.cantCheck;

export function inline(kind: string, as: 'word' | 'head' = 'word'): string {
  const r = resultOf(kind);
  return `<span class="result-inline" data-result="${r.slug}"><span class="result-sign" aria-hidden="true">${r.sign}</span>${r[as]}</span>`;
}

const MAX_TAIL = 28;

/** Copyable mono value. The HTML always holds the whole value, and CSS does any cutting. */
export function value(v: string, kind: 'path' | 'hash' | 'plain' = 'plain'): string {
  const s = String(v);
  const slash = kind === 'path' ? s.lastIndexOf('/') : -1;
  const cut = slash >= 0 ? Math.max(slash, s.length - MAX_TAIL) : Math.max(0, s.length - 8);
  const cls = kind === 'hash' ? 'value value--hash' : 'value';
  return `<button type="button" class="${cls}" data-copy="${esc(s)}" title="${esc(s)}"><span class="value-head">${esc(s.slice(0, cut))}</span><span class="value-tail">${esc(s.slice(cut))}</span></button>`;
}

/** Click copies the whole value. */
export function installCopy(): void {
  document.addEventListener('click', e => {
    const v = (e.target as Element).closest<HTMLElement>('[data-copy]');
    if (!v) return;
    navigator.clipboard?.writeText(v.dataset.copy ?? '');
    v.dataset.copied = '';
    setTimeout(() => delete v.dataset.copied, 1500);
  });
}
