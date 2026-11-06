// Pure: catalogue and replay in, HTML out. Records come from third parties, so all of it goes through esc().
import { SITES } from '../../core/src/sites.ts';
import { BLOCK_SECONDS, WITNESS_FRESH_SECONDS } from '../../core/src/types.ts';
import type { Catalogue, ChangeRecord } from '../../core/src/types.ts';
import { indexVersions } from '../../core/src/verdict.ts';
import { ago, count, esc, inline, num, resultOf, value } from '../../extension/src/format.ts';
import type { runReplay } from '../../replay/run.ts';

export type ReplayData = Awaited<ReturnType<typeof runReplay>>;

const PARENT = 'secondwitness.eth';
/** Records last 180 days, so ones for a retired site id are still on chain. Only sites the code lists are shown, by host. */
const SITE_HOSTS = new Map(SITES.map(s => [s.id, new URL(s.origins[0]!).host]));
const BYBIT_COLD_WALLET = '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const when = (ms: number) => {
  const d = new Date(ms);
  return `${day(ms)} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** Text with the given addresses marked. Every piece is escaped, so marks are the only tags that can appear. */
export function highlight(text: string, addrs: string[]): string {
  if (addrs.length === 0) return esc(text);
  const pattern = new RegExp(`(${addrs.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(pattern).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

const section = (id: string, title: string, side: string, main: string) =>
  `<section class="feed-section" id="${id}"><div class="feed-side"><h2>${title}</h2><p class="small quiet">${side}</p></div><div class="feed-main">${main}</div></section>`;

const row = (label: string, html: string) => `<div class="row"><dt>${label}</dt><dd>${html}</dd></div>`;

const TOP = `<header class="feed-top"><h1>Second Witness</h1><p class="quiet">What witnesses recorded for each site. This page only reads public records from Arkiv and ENS. The extension's check works with this page switched off.</p></header>`;

const page = (body: string) => `<main class="feed">${TOP}${body}</main>`;

/** Seconds since a block, on the chain's clock plus the time since the catalogue was fetched. */
function blockAge(c: Catalogue, block: number, now: number): number {
  return Math.max(0, (c.headBlock - block) * BLOCK_SECONDS + (now - c.fetchedAt) / 1000);
}

function latestStatus(c: Catalogue, witness: string, site?: string): number | null {
  const blocks = c.statuses.filter(s => s.witness === witness && (site === undefined || s.ok.includes(site))).map(s => s.updatedAtBlock);
  return blocks.length ? Math.max(...blocks) : null;
}

function witnesses(c: Catalogue, now: number): string {
  const body = c.roster
    .map(r => {
      const block = latestStatus(c, r.address);
      const checked = block === null ? 'No record yet' : ago(blockAge(c, block, now));
      return `<tr><td><span class="mono">${esc(r.label)}.${PARENT}</span><br>${value(r.address)}</td><td class="feed-right num">${esc(checked)}</td></tr>`;
    })
    .join('');
  const table = body
    ? `<table class="table table--stack"><thead><tr><th>Name and wallet</th><th class="feed-right">Last checked</th></tr></thead><tbody>${body}</tbody></table>`
    : '<p>No witnesses are listed.</p>';
  return section(
    'witnesses',
    'Witnesses',
    `Listed under <span class="mono">${PARENT}</span>. Clearing a name removes that witness.`,
    `${table}<p class="small quiet">Both witnesses are run by this project today. The code is open and the ENS roster is how others join.</p>`,
  );
}

function sites(c: Catalogue, now: number): string {
  const ids = [...new Set(c.observations.map(o => o.site))].filter(id => SITE_HOSTS.has(id)).sort();
  const body = ids
    .map(id => {
      const versions = [...indexVersions(c, id).values()].filter(v => v.size > 0);
      const firstSeen = versions.flatMap(v => [...v.values()].map(i => i.firstSeenBlock));
      const fresh = c.roster.filter(r => {
        const block = latestStatus(c, r.address, id);
        return block !== null && (c.headBlock - block) * BLOCK_SECONDS < WITNESS_FRESH_SECONDS;
      }).length;
      const last = firstSeen.length ? ago(blockAge(c, Math.max(...firstSeen), now)) : 'None yet';
      return `<tr><td class="mono" style="overflow-wrap:anywhere">${esc(SITE_HOSTS.get(id))}</td><td class="feed-right num feed-hide-phone">${num(versions.length)}</td><td class="feed-right num">${num(fresh)} of ${num(c.roster.length)}</td><td class="feed-right num">${esc(last)}</td></tr>`;
    })
    .join('');
  const table = body
    ? `<table class="table"><thead><tr><th>Site</th><th class="feed-right feed-hide-phone">Files</th><th class="feed-right">Witnesses</th><th class="feed-right">Last new code</th></tr></thead><tbody>${body}</tbody></table>`
    : '<p>No observations are recorded yet.</p>';
  return section('sites', 'Sites', 'The last observation per site.', table);
}

function changeEvent(c: Catalogue, records: ChangeRecord[]): string {
  const first = records[0]!;
  const blockMs = c.fetchedAt - (c.headBlock - first.createdAtBlock) * BLOCK_SECONDS * 1000;
  const name = (address: string) => {
    const r = c.roster.find(x => x.address === address);
    return r ? `${r.label}.${PARENT}` : address;
  };
  const named = records
    .map(r => `${value(name(r.witness))}${r.region === null ? '' : ' <span class="quiet">recorded the region</span>'}`)
    .join('<br>');
  const region = records.find(r => r.region !== null)?.region ?? null;
  const addrs = region === null ? [] : [...new Set(region.match(/0x[0-9a-fA-F]{40}/g) ?? [])];
  return `<article class="event"><div class="event-head">${inline('changed')}<span class="mono">${esc(SITE_HOSTS.get(first.site))}</span><span class="small quiet num">${esc(when(blockMs))} UTC, block ${num(first.createdAtBlock)}</span></div><dl class="rows-tight">${row('File', value(first.path, 'path'))}${row('Was', `${value(first.oldHash, 'hash')} <span class="quiet num">${count(first.sizes[0], 'byte')}</span>`)}${row('Now', `${value(first.newHash, 'hash')} <span class="quiet num">${count(first.sizes[1], 'byte')}</span>`)}${row('Witnesses', named)}${region === null ? row('Region', 'Witnesses kept no changed region for this file.') : ''}</dl>${region === null ? '' : `<details open><summary>Witnessed region, ${count(region.length, 'character')}</summary><pre class="region" tabindex="0">${highlight(region, addrs)}</pre></details>`}</article>`;
}

function changes(c: Catalogue): string {
  const listed = new Set(c.roster.map(r => r.address));
  const groups = new Map<string, ChangeRecord[]>();
  for (const r of [...c.changes].sort((a, b) => b.createdAtBlock - a.createdAtBlock)) {
    if (!listed.has(r.witness) || !SITE_HOSTS.has(r.site)) continue;
    const key = JSON.stringify([r.site, r.path, r.oldHash, r.newHash]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const body = [...groups.values()].map(g => changeEvent(c, g)).join('');
  return section(
    'changes',
    'Changed',
    'Files whose name promises fixed content, recorded with a new hash.',
    body || '<p>No changes are recorded.</p>',
  );
}

function axis(r: ReplayData): string {
  const theft = Date.parse(r.theft.time);
  const times = r.steps.map(s => Date.parse(s.time));
  const start = Math.min(...times, theft);
  const end = Math.max(...times, theft);
  const at = (ms: number) => (((ms - start) / (end - start)) * 100).toFixed(2);
  const altered = r.steps.find(s => s.altered);
  const span = altered
    ? `<span class="axis-span" style="left:${at(Date.parse(altered.time))}%;width:${(Number(at(theft)) - Number(at(Date.parse(altered.time)))).toFixed(2)}%"></span><span class="axis-span-label" style="left:${at(Date.parse(altered.time))}%">${esc(altered.hoursBeforeTheft)} hours</span>`
    : '';
  const signs = r.steps
    .map((s, i) => `<span class="axis-sign" data-result="${resultOf(s.result).slug}" style="left:${at(times[i]!)}%">${resultOf(s.result).sign}</span>`)
    .join('');
  // One date per day, and the last day sits at the end of the axis.
  const labelled = new Map<string, number>();
  for (const t of times) if (!labelled.has(day(t))) labelled.set(day(t), t);
  labelled.set(day(end), end);
  const dates = [...labelled].map(([d, t]) => `<span class="axis-date small quiet" style="left:${at(t)}%">${esc(d)}</span>`).join('');
  return `<div class="axis" aria-hidden="true">${span}${signs}<span class="axis-theft" style="left:${at(theft)}%"></span><span class="axis-line"></span>${dates}<span class="axis-date small quiet" style="left:${at(theft)}%">${esc(day(theft))}, theft</span></div>`;
}

function replayTable(r: ReplayData): string {
  const altered = r.steps.find(s => s.altered);
  const theftRow = `<tr class="replay-theft"><td class="num">${esc(when(Date.parse(r.theft.time)))}</td><td colspan="3"><strong>Theft transaction.</strong>${altered ? ` ${esc(altered.hoursBeforeTheft)} hours after the altered capture.` : ''}</td></tr>`;
  const items = r.steps.map(s => ({
    at: Date.parse(s.time),
    html: `<tr${s.altered ? ' class="replay-altered"' : ''}><td class="num">${esc(when(Date.parse(s.time)))}</td><td>${inline(s.result, 'head')}</td><td>${value(s.hash, 'hash')}</td><td class="num mono feed-right">${num(s.bytes)}</td></tr>`,
  }));
  items.push({ at: Date.parse(r.theft.time), html: theftRow });
  const body = items.sort((a, b) => a.at - b.at).map(i => i.html).join('');
  return `<table class="table table--stack table--replay"><thead><tr><th>Captured, UTC</th><th>A tab would read</th><th>Hash</th><th class="feed-right">Bytes</th></tr></thead><tbody>${body}</tbody></table>`;
}

function replay(r: ReplayData): string {
  const e = r.evidence;
  const alteredAt = r.steps.findIndex(s => s.altered);
  const altered = r.steps[alteredAt];
  const later = r.steps.slice(alteredAt + 1);
  const hours = altered ? esc(altered.hoursBeforeTheft) : '';
  const cold = r.asNewRelease.added.addrs.includes(BYBIT_COLD_WALLET)
    ? ` Its changed region names Bybit's cold wallet, <span class="mono" style="overflow-wrap:anywhere">${BYBIT_COLD_WALLET}</span>.`
    : '';
  const back = later[0]?.hash === e.cleanHash ? ' The file was back to the first hash by the next capture.' : '';
  const still = later.some(s => s.hash === e.cleanHash && s.result === 'changed')
    ? " A tab with the original keeps reading Don't sign for 72 hours, because witnesses had by then recorded two versions of a file whose name promises fixed content."
    : '';
  return section(
    'replay',
    'Bybit replay',
    'Seven archived captures of one file, re-read after the fact. No witness saw these live and they are not in the catalogue.',
    `${axis(r)}<dl class="rows-tight">${row('File', value(r.path, 'path'))}</dl>${replayTable(r)}` +
      `<p>The altered capture is ${count(e.bytesAdded, 'byte')} larger.${cold}${back}${still}</p>` +
      `<div class="replay-added"><h3 class="list-title">Changed region: ${count(e.region.length, 'character')}, with net growth of ${count(e.bytesAdded, 'byte')}.</h3>` +
      `<p class="small quiet">It runs from the first differing character to the last, so it includes code that did not change. The ${num(r.asNewRelease.totals.addrs)} addresses it added are underlined.</p>` +
      `<pre class="region replay-region" tabindex="0">${highlight(e.region, r.asNewRelease.added.addrs)}</pre></div>` +
      `<p class="small quiet">This shows when the alert would have fired: ${hours} hours before the theft. Safe{Wallet} disputes that its frontend was compromised and points to a developer machine.</p>`,
  );
}

export function renderFeed({ catalogue, replay: data, now }: { catalogue: Catalogue; replay: ReplayData; now: number }): string {
  return page(witnesses(catalogue, now) + sites(catalogue, now) + changes(catalogue) + replay(data));
}

/** The replay alone, under one plain line, while records are loading or when they can't be read. */
export function renderWithoutRecords(data: ReplayData, line: string): string {
  return page(`<p class="feed-records">${esc(line)}</p>${replay(data)}`);
}
