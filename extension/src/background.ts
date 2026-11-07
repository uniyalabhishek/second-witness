// Attaches only when asked, on listed sites only, and compares locally. Verdicts live in memory on
// purpose: a restarted worker has nothing to show, so it can't present an old result as current.
import { classify } from '../../core/src/classify.ts';
import { hashCode } from '../../core/src/hash.ts';
import { siteForUrl } from '../../core/src/sites.ts';
import type { Catalogue, ParsedScript, ResultKind, Site } from '../../core/src/types.ts';
import { verdict } from '../../core/src/verdict.ts';
import { ARKIV_RPC, fetchCatalogue, fetchRoster, SEPOLIA_RPC } from '../../reader/src/index.ts';
import { RESULTS } from './format.ts';
import type { PopupState } from './state.ts';

type Source = chrome.debugger.DebuggerSession;
type Idle = { lastCheck?: { result: ResultKind; finishedAt: number }; checkedHost?: string; attachFailed?: boolean };

interface Check {
  tabId: number;
  site: Site;
  tabUrl: string;
  mainFrameId?: string;
  startedAt: number;
  /** Session -> scriptId -> script. */
  sessions: Map<string, Map<string, ParsedScript>>;
  /** Sessions that ended. What they ran still counts until the next navigation, or a brief worker could clear a result. */
  gone: Set<string>;
  /** Frames, worklets and failed workers: code running in this tab that was not read. */
  unread: Set<string>;
  /** Enables and source reads in flight. No result is shown while this is above zero. */
  pending: number;
  reads: { done: number; total: number };
  generation: number;
  ready: boolean;
  /** No result is shown while the page is still loading, so its first few files can't read as the whole page. */
  loaded: boolean;
  timer?: ReturnType<typeof setTimeout>;
  state: PopupState;
}

const ROOT = 'root';
const REFRESH_ALARM = 'refresh';
const ATTACHED_ALARM = 'refresh-attached';
const WORKERS = new Set(['worker', 'shared_worker', 'service_worker']);
/** A page whose load event never comes still gets a result. Code arriving later updates it. */
const LOAD_WAIT_MS = 15_000;
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
const BADGE: Record<ResultKind, string> = {
  matches: '#0b6b4f',
  changed: '#b4260f',
  notSeen: '#875400',
  newRelease: '#875400',
  partial: '#875400',
  cantCheck: '#5f6368',
};

const checks = new Map<number, Check>();
let catalogue: Catalogue | null = null;
let refreshing: Promise<void> | null = null;

const ignore = () => {};
const send = <T = unknown>(source: Source, method: string, params?: object) =>
  chrome.debugger.sendCommand(source, method, params) as Promise<T>;
const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? '').host;
  } catch {
    return '';
  }
};
const catalogueAge = () => (catalogue ? (Date.now() - catalogue.fetchedAt) / 1000 : null);
/** The popup re-reads its state whenever storage changes. */
const notifyPopup = () => chrome.storage.session.set({ tick: Date.now() }).catch(ignore);

/** A restarted worker has lost its checks. End any debugger session it left behind rather than resume it. */
const boot = (async () => {
  catalogue = ((await chrome.storage.local.get('catalogue')).catalogue as Catalogue | undefined) ?? null;
  for (const target of await chrome.debugger.getTargets()) {
    if (!target.attached || target.tabId === undefined) continue;
    await chrome.debugger.detach({ tabId: target.tabId }).catch(ignore);
    await chrome.action.setBadgeText({ tabId: target.tabId, text: '' }).catch(ignore);
  }
})();

function refresh(): Promise<void> {
  refreshing ??= (async () => {
    try {
      const roster = await fetchRoster(SEPOLIA_RPC);
      // Applied before the records are read, so a revocation counts even if that read fails.
      if (catalogue) catalogue = { ...catalogue, roster };
      catalogue = await fetchCatalogue(ARKIV_RPC, roster, Date.now());
    } catch (error) {
      // The last good catalogue stands until it's an hour old, then the verdict reads Can't check.
      console.warn('Second Witness: refresh failed', (error as Error).message);
    } finally {
      await chrome.storage.local.set({ catalogue }).catch(ignore);
      refreshing = null;
    }
    for (const check of checks.values()) schedule(check);
    await notifyPopup();
  })();
  return refreshing;
}

function schedule(check: Check): void {
  check.timer ??= setTimeout(() => flush(check), 100);
}

function flush(check: Check): void {
  check.timer = undefined;
  if (checks.get(check.tabId) !== check) return;
  const host = hostOf(check.tabUrl);
  if (!check.ready || !check.loaded || check.pending > 0) {
    check.state = { phase: 'checking', host, hashed: check.reads.done, total: check.reads.total, startedAt: check.startedAt, catalogueAgeSeconds: catalogueAge() };
    void chrome.action.setBadgeText({ tabId: check.tabId, text: '' }).catch(ignore);
  } else {
    const scripts = [...check.sessions.values()].flatMap(session => [...session.values()]);
    const v = verdict({ scripts, catalogue, site: check.site, tabUrl: check.tabUrl, crossOriginFrames: check.unread.size, now: Date.now() });
    check.state = { phase: 'attached', host, verdict: v, scriptsSeen: scripts.length, updatedAt: Date.now() };
    void chrome.action.setBadgeText({ tabId: check.tabId, text: RESULTS[v.result].sign }).catch(ignore);
    void chrome.action.setBadgeBackgroundColor({ tabId: check.tabId, color: BADGE[v.result] }).catch(ignore);
  }
  void notifyPopup();
}

async function enable(source: Source): Promise<void> {
  await send(source, 'Debugger.enable');
  await send(source, 'Debugger.setSkipAllPauses', { skip: true });
}

function onScript(check: Check, source: Source, p: any): void {
  const key = source.sessionId ?? ROOT;
  const session = check.sessions.get(key) ?? new Map<string, ParsedScript>();
  check.sessions.set(key, session);
  const script: ParsedScript = {
    url: p.url,
    embedderName: p.embedderName,
    isolated: p.executionContextAuxData?.type === 'isolated',
    hasSourceURL: Boolean(p.hasSourceURL),
    startLine: p.startLine,
    startColumn: p.startColumn,
    language: p.scriptLanguage,
  };
  session.set(p.scriptId, script);
  schedule(check);
  if (classify(script, check.site).kind !== 'file') return;

  const generation = check.generation;
  check.pending++;
  check.reads.total++;
  send<{ scriptSource: string; bytecode?: string }>(source, 'Debugger.getScriptSource', { scriptId: p.scriptId })
    // An unread source leaves no hash, which reads Not seen.
    .then(async ({ scriptSource, bytecode }) => {
      if (!bytecode) script.hash = await hashCode(scriptSource);
    })
    .catch(ignore)
    .finally(() => {
      check.pending--;
      if (generation === check.generation) check.reads.done++;
      schedule(check);
    });
}

function onTargetAttached(check: Check, source: Source, { sessionId, targetInfo }: any): void {
  // Only workers run this site's files. Anything else counts as uncompared rather than being compared to the wrong list.
  if (!WORKERS.has(targetInfo.type)) {
    check.unread.add(sessionId);
    schedule(check);
    return;
  }
  const child: Source = { tabId: source.tabId, sessionId };
  check.pending++;
  enable(child)
    .then(() => send(child, 'Target.setAutoAttach', AUTO_ATTACH))
    .catch(() => check.unread.add(sessionId))
    .finally(() => {
      check.pending--;
      schedule(check);
    });
}

function waitForLoad(check: Check): void {
  const { generation } = check;
  setTimeout(() => {
    if (generation !== check.generation) return;
    check.loaded = true;
    schedule(check);
  }, LOAD_WAIT_MS);
}

function onMainFrameNavigated(check: Check, frame: { id: string; url: string }): void {
  const site = siteForUrl(frame.url);
  if (!site) {
    void endCheck(check.tabId);
    return;
  }
  check.site = site;
  check.tabUrl = frame.url;
  check.mainFrameId = frame.id;
  check.generation++;
  check.loaded = false;
  waitForLoad(check);
  check.reads = { done: 0, total: 0 };
  // Service workers outlive the page, so only the page's own session is cleared.
  check.sessions.delete(ROOT);
  for (const id of check.gone) check.sessions.delete(id);
  check.gone.clear();
  schedule(check);
}

chrome.debugger.onEvent.addListener((source, method, params: any) => {
  const check = source.tabId === undefined ? undefined : checks.get(source.tabId);
  if (!check) return;
  const isRoot = !(source as Source).sessionId;
  if (method === 'Debugger.scriptParsed') onScript(check, source, params);
  else if (method === 'Debugger.paused') send(source, 'Debugger.resume').catch(ignore);
  else if (method === 'Target.attachedToTarget') onTargetAttached(check, source, params);
  else if (method === 'Target.detachedFromTarget') {
    check.gone.add(params.sessionId);
    check.unread.delete(params.sessionId);
    schedule(check);
  } else if (method === 'Page.loadEventFired' && isRoot) {
    check.loaded = true;
    schedule(check);
  } else if (method === 'Page.frameNavigated' && isRoot && !params.frame.parentId) onMainFrameNavigated(check, params.frame);
  else if (method === 'Page.navigatedWithinDocument' && isRoot && params.frameId === check.mainFrameId) {
    check.tabUrl = params.url;
    schedule(check);
  }
});

async function start(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id;
  const site = siteForUrl(tab.url ?? '');
  if (tabId === undefined || !site || checks.has(tabId)) return;

  const startedAt = Date.now();
  const check: Check = {
    tabId,
    site,
    tabUrl: tab.url!,
    startedAt,
    sessions: new Map(),
    gone: new Set(),
    unread: new Set(),
    pending: 0,
    reads: { done: 0, total: 0 },
    generation: 0,
    ready: false,
    loaded: false,
    state: { phase: 'checking', host: hostOf(tab.url), hashed: 0, total: 0, startedAt, catalogueAgeSeconds: catalogueAge() },
  };
  checks.set(tabId, check);
  await chrome.storage.session.remove(`idle:${tabId}`);
  void notifyPopup();

  try {
    const root: Source = { tabId };
    await chrome.debugger.attach(root, '1.3');
    await enable(root);
    await send(root, 'Page.enable');
    if ((await chrome.tabs.get(tabId)).status === 'complete') check.loaded = true;
    else waitForLoad(check);
    const { frameTree } = await send<{ frameTree: { frame: { id: string; url: string } } }>(root, 'Page.getFrameTree');
    check.mainFrameId = frameTree.frame.id;
    check.tabUrl = frameTree.frame.url;
    await send(root, 'Target.setAutoAttach', AUTO_ATTACH);
    check.ready = true;
    schedule(check);
    void chrome.alarms.create(ATTACHED_ALARM, { periodInMinutes: 1 });
    void refresh();
  } catch (error) {
    console.warn('Second Witness: attach failed', (error as Error).message);
    checks.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(ignore);
    await chrome.storage.session.set({ [`idle:${tabId}`]: { attachFailed: true } satisfies Idle });
    void notifyPopup();
  }
}

/** Finish, the debugger bar's Cancel, or navigating to an unlisted site. The badge never outlives the check. */
async function endCheck(tabId: number): Promise<void> {
  const check = checks.get(tabId);
  if (!check) return;
  checks.delete(tabId);
  clearTimeout(check.timer);
  const idle: Idle = check.state.phase === 'attached' ? { lastCheck: { result: check.state.verdict.result, finishedAt: Date.now() }, checkedHost: hostOf(check.tabUrl) } : {};
  await chrome.storage.session.set({ [`idle:${tabId}`]: idle });
  await chrome.debugger.detach({ tabId }).catch(ignore);
  await chrome.action.setBadgeText({ tabId, text: '' }).catch(ignore);
  if (checks.size === 0) await chrome.alarms.clear(ATTACHED_ALARM);
  void notifyPopup();
}

async function stateFor(tab: chrome.tabs.Tab): Promise<PopupState> {
  const check = tab.id === undefined ? undefined : checks.get(tab.id);
  if (check) return check.state;
  const key = `idle:${tab.id}`;
  const { lastCheck, checkedHost, attachFailed } = ((await chrome.storage.session.get(key))[key] as Idle | undefined) ?? {};
  const host = hostOf(tab.url);
  // A last result belongs to the site it was read on, not to whatever this tab shows now.
  return { phase: 'idle', host, listed: siteForUrl(tab.url ?? '') !== null, catalogueAgeSeconds: catalogueAge(), attachFailed, lastCheck: checkedHost === host ? lastCheck : undefined };
}

async function handle(message: { type?: string; tabId?: number }): Promise<PopupState | undefined> {
  await boot;
  const tab = message.tabId ? await chrome.tabs.get(message.tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return undefined;
  if (message.type === 'start') await start(tab);
  else if (message.type === 'finish' && tab.id !== undefined) await endCheck(tab.id);
  return stateFor(tab);
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  handle(message).then(reply, () => reply(undefined));
  return true;
});

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId !== undefined) void endCheck(source.tabId);
});

chrome.tabs.onRemoved.addListener(tabId => {
  void endCheck(tabId).then(() => chrome.storage.session.remove(`idle:${tabId}`));
});

function keepFresh(): void {
  void chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 15 });
  void boot.then(refresh);
}
chrome.runtime.onInstalled.addListener(keepFresh);
chrome.runtime.onStartup.addListener(keepFresh);
chrome.alarms.onAlarm.addListener(() => void boot.then(refresh));
