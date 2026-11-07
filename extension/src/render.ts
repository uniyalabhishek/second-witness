// Pure: PopupState in, HTML out.
import { MIN_WITNESSES } from '../../core/src/types.ts';
import type { ChangedFile, Verdict } from '../../core/src/types.ts';
import type { PopupState } from './state.ts';
import { age, ago, count, esc, inline, num, resultOf, value } from './format.ts';

type Attached = Extract<PopupState, { phase: 'attached' }>;

const IDLE_NOTE = "Attaches Chrome's debugger to this tab until you press Finish. The comparison runs in this browser.";
const DEBUGGER_BAR = 'Chrome shows a debugger bar until you finish.';

const shell = (host: string, body: string) => `<section class="popup"><p class="popup-host mono">${esc(host)}</p>${body}</section>`;

const head = (kind: string, text: string) => {
  const r = resultOf(kind);
  return `<div class="result" data-result="${r.slug}" role="status"><h1 class="result-head"><span class="result-sign" aria-hidden="true">${r.sign}</span><span>${r.head}</span></h1><p class="result-text">${text}</p></div>`;
};

const foot = (line: string) =>
  `<footer class="popup-foot"><p class="small quiet">${line}</p><button type="button" class="button button--quiet" data-action="finish">Finish</button></footer>`;

const row = (label: string, html: string) => `<div class="row"><dt>${label}</dt><dd>${html}</dd></div>`;
const rows = (items: string[], gap = false) => (items.length ? `<dl class="popup-rows${gap ? ' popup-rows--gap' : ''}">${items.join('')}</dl>` : '');
const note = (text: string) => `<p class="popup-note small">${text}</p>`;

function list(title: string, items: string[], first = false): string {
  const lis = items.map(i => `<li>${i}</li>`).join('');
  return `<div class="popup-list${first ? ' popup-list--first' : ''}"><h2 class="list-title">${title}</h2><ul class="list">${lis}</ul></div>`;
}

const records = (seconds: number | null) => (seconds === null ? 'Witness records have not been read yet.' : `Witness records updated ${esc(ago(seconds))}.`);

/** Plain count text, for rows and lists. */
const numText = (html: string) => `<span class="num">${html}</span>`;

const uncomparedCount = (v: Verdict) => {
  const u = v.uncompared;
  return u.inline + u.eval + u.wasm + u.frames + u.thirdParty.length;
};
const witnessesBehind = (v: Verdict) => v.freshWitnesses < MIN_WITNESSES;
const BEHIND = `Fewer than ${MIN_WITNESSES} witnesses checked this site in the last hour.`;
const NO_FILES = 'No first-party files were compared.';
const DISPUTED = 'One witness recorded a different version of a file whose name promises fixed content.';
const SO_DO = 'Tell the other signers. Check again from another device.';
/** Absent from a worker built before the field existed. */
const disputedOf = (v: Verdict) => v.disputed ?? [];

const extensionNote = ({ extensionScripts: n }: Verdict) => (!n ? '' : ` ${n === 1 ? '1 from a browser extension' : `${num(n)} from browser extensions`}, not compared.`);
const comparedRow = (v: Verdict, scriptsSeen: number) => row('Compared', numText(`${count(v.filesCompared, 'file')} from ${count(scriptsSeen, 'script')}.${extensionNote(v)}`));

function witnessesRow(v: Verdict): string {
  const latest = v.lastCheckedSeconds === null ? '' : `, latest ${esc(ago(v.lastCheckedSeconds))}`;
  return row('Witnesses', `${count(v.freshWitnesses, 'witness', 'witnesses')} checked in the last hour${latest}`);
}

/** A new file clears when witnesses reach it. A new host never does: they only record the site's own files. */
function notSeenText({ notSeen, unknownHosts: { length: hosts } }: Verdict): string {
  const files = "Don't sign yet. Two witnesses have not recorded this code. New files usually clear within 30 minutes.";
  if (hosts === 0) return `${files} This updates on its own, no reload needed.`;
  if (notSeen.length > 0) return `${files} ${hosts === 1 ? "A host not on this site's list stays" : "Hosts not on this site's list stay"} until the list is updated.`;
  const opening = hosts === 1 ? 'A script here comes from a host' : `Scripts here come from ${num(hosts)} hosts`;
  return `${opening} not on this site's list. Check ${hosts === 1 ? 'it' : 'them'} before signing. Witnesses only record the site's own files, so this stays until the list is updated.`;
}

function notSeenEvidence(v: Verdict): string {
  const files = v.notSeen.length === 1 ? 'First-party file' : `First-party files, ${num(v.notSeen.length)}`;
  const hosts = v.unknownHosts.length === 1 ? "Host not on this site's list" : `Hosts not on this site's list, ${num(v.unknownHosts.length)}`;
  return (
    (v.notSeen.length ? list(files, v.notSeen.map(p => value(p, 'path'))) : '') +
    (v.unknownHosts.length ? list(hosts, v.unknownHosts.map(h => value(h))) : '')
  );
}

function releaseRow(v: Verdict): string {
  const r = v.release!;
  const seen = v.witnessCount > 0 ? `, seen by ${count(v.witnessCount, 'witness', 'witnesses')}` : '';
  return row('Released', `${esc(ago(r.ageSeconds))}${seen}`);
}

const andMore = (total: number, listed: number) => (total > listed ? [numText(`and ${num(total - listed)} more`)] : []);

function releaseLists(v: Verdict): string {
  const r = v.release!;
  const inUrl = r.addrs.filter(a => a.inTabUrl);
  const others = r.addrs.filter(a => !a.inTabUrl);
  const othersTotal = r.totals.addrs - inUrl.length;
  let html = '';
  if (inUrl.length) html += list("Added, and in this tab's URL", inUrl.map(a => value(a.value)), true);
  if (othersTotal > 0) {
    const title = `${inUrl.length ? 'Also added' : 'Added'}, ${count(othersTotal, 'address', 'addresses')}`;
    html += list(title, [...others.map(a => value(a.value)), ...andMore(othersTotal, others.length)]);
  }
  if (r.totals.hosts > 0) {
    html += list(`Added, ${count(r.totals.hosts, 'host')}`, [...r.hosts.map(h => value(h.value)), ...andMore(r.totals.hosts, r.hosts.length)]);
  }
  return html;
}

function partialLists(v: Verdict): string {
  const u = v.uncompared;
  const items: string[] = [];
  if (u.inline) items.push(numText(count(u.inline, 'inline script')));
  if (u.eval) items.push(numText(count(u.eval, 'eval script')));
  if (u.wasm) items.push(numText(count(u.wasm, 'WebAssembly module')));
  if (u.frames) items.push(numText(count(u.frames, 'frame or worker', 'frames or workers')));
  const disputed = disputedOf(v);
  const title = disputed.length === 1 ? 'File one witness recorded differently' : `Files one witness recorded differently, ${num(disputed.length)}`;
  return (
    (disputed.length ? list(title, disputed.map(p => value(p, 'path'))) : '') +
    (items.length ? list('Not compared', items) : '') +
    (u.thirdParty.length ? list(`Scripts from ${count(u.thirdParty.length, 'listed host')}`, u.thirdParty.map(t => value(t.host))) : '')
  );
}

function also(kind: string, evidence: string): string {
  return rows([row('Also', inline(kind))], true) + evidence;
}

/** Every amber reason in the verdict other than the one heading the popup. */
function otherReasons(v: Verdict): string {
  let html = '';
  if (v.result !== 'notSeen' && (v.notSeen.length || v.unknownHosts.length)) html += also('notSeen', notSeenEvidence(v));
  if (v.result !== 'newRelease' && v.release) html += also('newRelease', rows([releaseRow(v)]) + releaseLists(v));
  if (v.result !== 'partial' && (uncomparedCount(v) || disputedOf(v).length || witnessesBehind(v) || v.filesCompared === 0)) {
    const notes = (witnessesBehind(v) ? note(BEHIND) : '') + (v.filesCompared === 0 ? note(NO_FILES) : '');
    html += also('partial', partialLists(v) + notes);
  }
  return html;
}

function changedText(v: Verdict): string {
  const n = v.changed.length;
  if (v.changed.some(c => !c.witnessedHashes.includes(c.tabHash))) return 'This tab is running different code from what everyone else got.';
  if (n > 1) return `Witnesses recorded more than one version of ${num(n)} files whose names promise fixed content.`;
  return v.changed[0]?.original
    ? "This file's name promises fixed content, and witnesses recorded a changed version in the last 72 hours. This tab has the original, but the site has served different code."
    : "This file's name promises fixed content, and this tab is running a changed version.";
}

const hashes = (list: string[]) => list.map(h => value(h, 'hash')).join('<br>');

function sizeRow(c: ChangedFile): string {
  const e = c.evidence;
  if (!e || e.newHash !== c.tabHash) return '';
  const diff = e.sizes[1] - e.sizes[0];
  if (diff === 0) return row('Size', numText('Same size in this tab'));
  return row('Size', numText(`${count(Math.abs(diff), 'byte')} ${diff > 0 ? 'larger' : 'smaller'} in this tab`));
}

function changedFile(c: ChangedFile): string {
  const others = c.witnessedHashes.filter(h => h !== c.tabHash);
  const bothWitnessed = c.witnessedHashes.includes(c.tabHash);
  const region = c.evidence?.region ?? null;
  const items = [
    row('File', value(c.path, 'path')),
    row('This tab', value(c.tabHash, 'hash')),
    row(bothWitnessed ? 'Other' : 'Witnesses', hashes(others)),
    sizeRow(c),
  ];
  if (region === null) return rows(items);
  return (
    rows(items) +
    `<div class="popup-list"><h2 class="list-title">Witnessed change, block ${num(c.evidence!.createdAtBlock)}</h2></div>` +
    `<pre class="region popup-region" tabindex="0">${esc(region)}</pre>`
  );
}

function matchesText(v: Verdict): string {
  const newest = v.newestFileAgeSeconds === null ? '' : ` Newest file ${esc(age(v.newestFileAgeSeconds))}.`;
  return `Every file matches what two witnesses recorded.${newest}`;
}

function newReleaseText(v: Verdict): string {
  const { ageSeconds, totals: { addrs, hosts } } = v.release!;
  if (!addrs && !hosts) return `Witnesses first saw this code ${esc(ago(ageSeconds))}, and it added no addresses or hosts. This clears after an hour.`;
  let what: string;
  if (addrs && hosts) what = `${addrs === 1 ? 'an address' : 'addresses'} and ${hosts === 1 ? 'a host' : 'hosts'}`;
  else if (hosts) what = count(hosts, 'host');
  else what = count(addrs, 'address', 'addresses');
  return `Witnesses saw this code. Its release added ${what} in the last 72 hours. Check what it added before signing.`;
}

function partialText(v: Verdict): string {
  const parts = [v.filesCompared > 0 ? `${count(v.filesCompared, 'file')} ${v.filesCompared === 1 ? 'matches' : 'match'} ${count(v.witnessCount, 'witness', 'witnesses')}.` : NO_FILES];
  if (disputedOf(v).length) parts.push(DISPUTED);
  if (uncomparedCount(v)) parts.push('Other code is running here that was not compared.');
  if (witnessesBehind(v)) parts.push(BEHIND);
  return parts.join(' ');
}

const CANT_CHECK: Record<string, string> = {
  siteNotListed: "This site isn't on the witness list, so there is nothing to compare with.",
  catalogueStale: 'The witness records in this browser are too old. They need to be under 1 hour old.',
  noRoster: `The witness roster on ${value('secondwitness.eth')} can't be read right now, so no record can be counted.`,
  noCatalogue: "The witness records haven't reached this browser yet, so there is nothing to compare with.",
};

function attached({ host, verdict: v, scriptsSeen, updatedAt }: Attached, now: number): string {
  const updated = `Updated ${esc(ago((now - updatedAt) / 1000))}. ${DEBUGGER_BAR}`;
  const compared = comparedRow(v, scriptsSeen);
  const body = () => {
    switch (v.result) {
      case 'matches':
        return head('matches', matchesText(v)) + rows([compared, witnessesRow(v)]);
      case 'changed':
        return head('changed', changedText(v)) + note(SO_DO) + v.changed.map(changedFile).join('');
      case 'notSeen':
        return head('notSeen', notSeenText(v)) + rows([compared]) + notSeenEvidence(v);
      case 'newRelease':
        return head('newRelease', newReleaseText(v)) + rows([releaseRow(v), compared]) + releaseLists(v);
      case 'partial':
        return head('partial', partialText(v)) + rows(witnessesBehind(v) ? [compared, witnessesRow(v)] : [compared]) + partialLists(v);
      default:
        return null;
    }
  };
  const main = body();
  if (main === null) {
    // Missing or stale data: no evidence to show, and nothing else in the verdict means anything.
    const reason = v.cantCheckReason ?? 'noCatalogue';
    const line = reason === 'siteNotListed' ? updated : `Retrying every 60 seconds. ${DEBUGGER_BAR}`;
    return shell(host, head('cantCheck', CANT_CHECK[reason] ?? CANT_CHECK.noCatalogue!) + foot(line));
  }
  return shell(host, main + otherReasons(v) + foot(updated));
}

export function render(state: PopupState, now: number): string {
  if (state.phase === 'attached') return attached(state, now);
  if (state.phase === 'checking') {
    return shell(
      state.host,
      `<div class="popup-checking" role="status"><p class="popup-count num">Hashing ${num(state.hashed)} of ${count(state.total, 'script')}</p><p class="small quiet">No result yet. ${records(state.catalogueAgeSeconds)}</p></div>` +
        foot(`Started ${esc(ago((now - state.startedAt) / 1000))}. ${DEBUGGER_BAR}`),
    );
  }
  if (!state.listed) {
    return shell(state.host, head('cantCheck', CANT_CHECK.siteNotListed!) + '<p class="popup-note popup-last small quiet">The debugger was not attached.</p>');
  }
  const last = state.lastCheck;
  const intro = last
    ? `Last check: ${inline(last.result, 'head')}, ${esc(ago((now - last.finishedAt) / 1000))}. Check again before you sign.`
    : 'Check the code in this tab against what everyone else got.';
  return shell(
    state.host,
    `<div class="popup-idle"><p>${intro}</p><button type="button" class="button popup-primary" data-action="start">Check before signing</button>${state.attachFailed ? `<p class="small">Chrome would not attach the debugger to this tab, so nothing was compared. Close other debugging tools and try again.</p>` : ''}<p class="small quiet">${IDLE_NOTE} ${records(state.catalogueAgeSeconds)}</p></div>`,
  );
}

/** Shown when the service worker gives no state. No host is known, and no result is claimed. */
export function renderUnavailable(): string {
  return `<section class="popup">${head('cantCheck', "The extension's background worker did not answer, so nothing was compared.")}<div class="popup-last"></div></section>`;
}
