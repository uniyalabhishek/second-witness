// Drives the built extension in a real browser against the real sites and real records. Raw CDP, and only on
// the extension's own page: attaching to a checked tab, or evaluating in it, would show up as code in that tab.
// Needs: npm run build, the demo site at DEMO_ORIGIN, and witnesses already run.
// node extension/test/e2e.mjs [safe cow revoke demo loading debugger privacy extensions release ens listed]
// `listed` checks the home page of every other listed site, and must be named.
// `release` and `ens` spend testnet gas and must be named. After `release`, the demo site id reads New release for
// 72 hours, so bump it in core/src/sites.ts, rebuild and rerun the witnesses.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ORIGIN, SITES } from '../../core/src/sites.ts';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const SHOTS = process.env.E2E_SHOTS ?? join(tmpdir(), 'second-witness-e2e');
const DEMO = DEMO_ORIGIN;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const steps = process.argv.slice(2).length ? process.argv.slice(2) : ['safe', 'cow', 'revoke', 'demo', 'worker', 'loading', 'debugger', 'privacy', 'extensions'];
const run = (...args) => {
  const r = spawnSync('node', ['--env-file=.env', ...args], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr.slice(-400)}`);
  return r.stdout;
};
mkdirSync(SHOTS, { recursive: true });

// `tabs` is added to this copy only: the test opens the popup as a page, which gets no activeTab grant.
const extDir = mkdtempSync(join(tmpdir(), 'sw-ext-'));
cpSync(DIST, extDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.permissions.push('tabs');
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));

// A stand-in wallet with the two kinds of script real ones inject: one in the page's world, one in its own.
const wallet = mkdtempSync(join(tmpdir(), 'sw-wallet-'));
writeFileSync(join(wallet, 'inpage.js'), 'globalThis.standInWallet = true;\n');
writeFileSync(join(wallet, 'content.js'), '// Stand-in content script\n');
writeFileSync(join(wallet, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Stand-in wallet', version: '1',
  content_scripts: [{ matches: [`${DEMO}/*`], run_at: 'document_start', world: 'MAIN', js: ['inpage.js'] }, { matches: [`${DEMO}/*`], run_at: 'document_start', js: ['content.js'] }],
}));
const loaded = steps.includes('extensions') ? `${extDir},${wallet}` : extDir;

const base = join(homedir(), 'Library/Caches/ms-playwright');
const build = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1])[0];
const chrome = process.env.CHROME_BIN ?? join(base, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const profile = mkdtempSync(join(tmpdir(), 'sw-profile-'));
const port = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(chrome, [
  ...(process.env.E2E_HEADED ? [] : ['--headless=new']), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-search-engine-choice-screen', '--window-size=1280,900', `--disable-extensions-except=${loaded}`, `--load-extension=${loaded}`, 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => proc.kill());

let version;
for (let i = 0; i < 80 && !version; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  } catch {
    await sleep(250);
  }
}
if (!version) throw new Error('browser did not start');

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const waiting = new Map();
const requests = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request);
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

// Built-in component extensions also have workers named background.js, so ask each one its name.
let extId;
for (let i = 0; i < 120 && !extId; i++) {
  const { targetInfos } = await send('Target.getTargets');
  for (const t of targetInfos.filter(t => t.type === 'service_worker' && t.url.endsWith('/background.js'))) {
    const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const { result: r } = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, sessionId);
    await send('Target.detachFromTarget', { sessionId });
    if (r.value === manifest.name) extId = new URL(t.url).host;
  }
  if (!extId) await sleep(250);
}
if (!extId) throw new Error('extension did not load');

// The control page: the only thing this harness attaches to.
const { targetId: controlId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
const { sessionId: control } = await send('Target.attachToTarget', { targetId: controlId, flatten: true });
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: false }, control);
await sleep(500);
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, control);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
for (let i = 0; i < 40 && !(await ev(`Boolean(globalThis.chrome?.storage)`)); i++) await sleep(250);
if (!(await ev(`Boolean(globalThis.chrome?.storage)`))) throw new Error(`control page has no extension APIs: ${await ev('location.href')}`);
const message = (type, tabId) => ev(`chrome.runtime.sendMessage(${JSON.stringify({ type, tabId })})`);

const openTab = async url => {
  const tabId = await ev(`chrome.tabs.create({ url: ${JSON.stringify(url)}, active: true }).then(t => t.id)`);
  await waitLoaded(tabId);
  return tabId;
};
const waitLoaded = async tabId => {
  for (let i = 0; i < 120; i++) {
    if ((await ev(`chrome.tabs.get(${tabId}).then(t => t.status)`)) === 'complete') return;
    await sleep(250);
  }
};
const goTo = async (tabId, url) => {
  await ev(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} }).then(() => 1)`);
  await sleep(300);
  await waitLoaded(tabId);
};

/** Waits for the attached phase and for the result to hold still, or until `tries` polls for the wanted result. */
async function result(tabId, want = null, tries = 120) {
  let last, stable = 0;
  for (let i = 0; i < tries && (want || stable < 6); i++) {
    const s = await message('getState', tabId);
    const r = s?.phase === 'attached' ? s.verdict.result : null;
    stable = r && r === last ? stable + 1 : 0;
    last = r;
    if (want && r === want && stable >= 2) break;
    await sleep(250);
  }
  return message('getState', tabId);
}

async function shot(name, tabId) {
  await send('Page.navigate', { url: `chrome-extension://${extId}/popup.html?tab=${tabId}` }, control);
  await sleep(500);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, control);
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

let failures = 0;
function report(name, state, ok) {
  const v = state?.verdict;
  const u = v?.uncompared;
  const detail = v
    ? `${v.result}${v.cantCheckReason ? `/${v.cantCheckReason}` : ''} files=${v.filesCompared} scripts=${state.scriptsSeen} changed=${v.changed.length} notSeen=${v.notSeen.length} unknownHosts=${v.unknownHosts.length} inline=${u.inline} eval=${u.eval} wasm=${u.wasm} thirdParty=${u.thirdParty.length} frames=${u.frames} witnesses=${v.freshWitnesses}${v.release ? ` release=+${v.release.totals.addrs}addr` : ''}`
    : JSON.stringify(state);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok && v?.notSeen.length) console.log('  notSeen', v.notSeen.slice(0, 8));
  if (!ok && v?.unknownHosts.length) console.log('  unknownHosts', v.unknownHosts);
}

async function checkSite(name, url, allowed, solid = false) {
  const tabId = await openTab(url);
  await sleep(5000);
  await shot(`${name}-before`, tabId);
  await message('start', tabId);
  const state = await result(tabId);
  const v = state?.verdict;
  report(name, state, allowed.includes(v?.result) && (!solid || (v.filesCompared > 0 && v.freshWitnesses >= 2)));
  await shot(name, tabId);
  await message('finish', tabId);
  const after = await message('getState', tabId);
  report(`${name} after Finish`, after, after?.phase === 'idle' && after.lastCheck?.result === state?.verdict?.result);
  await ev(`chrome.tabs.remove(${tabId})`);
}

/** The demo's controls are plain form posts, so a helper tab runs them with this profile's cookies. */
async function control_(path) {
  const tabId = await openTab(`${DEMO}/?helper`);
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(t => t.type === 'page' && t.url.startsWith(`${DEMO}/?helper`));
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await send('Runtime.evaluate', {
    expression: `fetch(${JSON.stringify(path)}, { method: 'POST' }).then(r => r.status)`,
    awaitPromise: true,
  }, sessionId);
  await sleep(300);
  await send('Target.detachFromTarget', { sessionId });
  return tabId;
}
const closeTab = tabId => ev(`chrome.tabs.remove(${tabId}).then(() => 1)`);

try {
  // The first refresh runs on install. Give it a moment, then show what it read.
  for (let i = 0; i < 40; i++) {
    const age = await ev(`chrome.storage.local.get('catalogue').then(x => x.catalogue ? x.catalogue.observations.length : -1)`);
    if (age > 0) break;
    await sleep(500);
  }
  console.log('records', await ev(`chrome.storage.local.get('catalogue').then(({ catalogue: c }) => c && ({ roster: c.roster.map(r => r.label), obs: c.observations.length, statuses: c.statuses.length }))`));

  if (steps.includes('safe')) {
    await checkSite('app.safe.global', 'https://app.safe.global/', ['matches']);
    await checkSite('app.safe.global accounts', 'https://app.safe.global/welcome/accounts', ['matches']);
  }
  if (steps.includes('cow')) await checkSite('swap.cow.fi', 'https://swap.cow.fi/', ['partial']);
  if (steps.includes('listed')) {
    for (const s of SITES.slice(4)) await checkSite(s.id, `${s.origins[0]}/`, ['matches', 'partial', 'newRelease'], true);
  }
  if (steps.includes('revoke')) await checkSite('revoke.cash', 'https://revoke.cash/', ['partial']);

  if (steps.includes('extensions')) {
    const tabId = await openTab(`${DEMO}/demo`);
    await message('start', tabId);
    const state = await result(tabId, 'matches');
    await shot('demo-with-wallet', tabId);
    const compared = await ev(`document.querySelector('.popup-rows')?.innerText ?? ''`);
    console.log(`  ${compared.replace(/\s+/g, ' ')}`);
    report('another extension installed', state, state?.verdict?.result === 'matches' && state.verdict.extensionScripts === 2 && compared.includes('2 from browser extensions, not compared.'));
    await message('finish', tabId);
    await closeTab(tabId);
  }

  if (steps.includes('demo')) {
    await checkSite('demo clean', `${DEMO}/demo`, ['matches']);

    // Targeted: this client now gets altered code on the same immutable path, and it stays in this client's cache.
    let helper = await control_('/control/target');
    await closeTab(helper);
    const tabId = await openTab(`${DEMO}/refresh`);
    await sleep(800);
    await goTo(tabId, `${DEMO}/demo`);
    await sleep(500);
    await message('start', tabId);
    let state = await result(tabId, 'changed');
    report('demo targeted', state, state?.verdict?.result === 'changed');
    await shot('demo-changed', tabId);

    // The server is cleaned, but the altered copy still runs from this client's cache.
    helper = await control_('/control/clean');
    await closeTab(helper);
    await goTo(tabId, `${DEMO}/demo`);
    state = await result(tabId, 'changed');
    report('demo after server clean, reload', state, state?.verdict?.result === 'changed');
    await message('finish', tabId);

    // Refetch puts clean code back in this client's cache.
    helper = await control_('/control/refetch');
    await closeTab(helper);
    const refreshed = await openTab(`${DEMO}/refresh`);
    await sleep(800);
    await goTo(refreshed, `${DEMO}/demo`);
    await sleep(500);
    await message('start', refreshed);
    state = await result(refreshed, 'matches');
    report('demo after refetch', state, state?.verdict?.result === 'matches');
    await message('finish', refreshed);
    await closeTab(refreshed);
    await closeTab(tabId);

    // A //# sourceURL label on the altered file must not turn it into an uncounted eval.
    helper = await control_('/control/target-labelled');
    await closeTab(helper);
    const labelled = await openTab(`${DEMO}/refresh`);
    await sleep(800);
    await goTo(labelled, `${DEMO}/demo`);
    await sleep(500);
    await message('start', labelled);
    state = await result(labelled, 'changed');
    report('demo targeted, file labelled with sourceURL', state, state?.verdict?.result === 'changed');
    await message('finish', labelled);
    await closeTab(labelled);
    helper = await control_('/control/refetch');
    await closeTab(helper);
    await closeTab(await openTab(`${DEMO}/refresh`));
  }

  if (steps.includes('loading')) {
    const opened = Date.now();
    const tabId = await ev(`chrome.tabs.create({ url: ${JSON.stringify(`${DEMO}/slow`)}, active: true }).then(t => t.id)`);
    await sleep(500);
    await message('start', tabId);
    let state, first = 0;
    for (let i = 0; i < 200 && !first; i++) {
      state = await message('getState', tabId);
      if (state?.phase === 'attached') first = Date.now() - opened;
      else await sleep(50);
    }
    report(`no result until the page has loaded (first after ${first} ms, page takes 3000)`, state, first >= 2900);
    await ev(`chrome.tabs.reload(${tabId}).then(() => 1)`);
    await sleep(1000);
    const during = await message('getState', tabId);
    report('no result while reloading', during, during?.phase === 'checking');
    state = await result(tabId, 'notSeen');
    report('result returns after reload', state, state?.verdict?.result === 'notSeen');
    await message('finish', tabId);

    // Same tab, new site: the last result must not follow it.
    const before = await message('getState', tabId);
    await goTo(tabId, 'https://revoke.cash/');
    const after = await message('getState', tabId);
    report('last result stays with its site', after, before?.lastCheck?.result === 'notSeen' && after?.phase === 'idle' && after.lastCheck === undefined);
    await closeTab(tabId);
  }

  if (steps.includes('debugger')) {
    const tabId = await openTab(`${DEMO}/debugger`);
    await message('start', tabId);
    const state = await result(tabId);
    const ticks = () => ev(`chrome.tabs.get(${tabId}).then(t => Number(t.title))`);
    const grows = async () => {
      const a = await ticks();
      await sleep(1000);
      const b = await ticks();
      return [a, b, b > a];
    };
    const [a, b, runs] = await grows();
    report(`debugger; page keeps running while attached (${a} -> ${b})`, state, runs);
    await goTo(tabId, `${DEMO}/debugger`);
    const [c, d, reloaded] = await grows();
    report(`debugger; page keeps running after reload (${c} -> ${d})`, state, reloaded);
    await message('finish', tabId);
    await closeTab(tabId);
  }

  if (steps.includes('worker')) {
    const tabId = await openTab(`${DEMO}/worker`);
    await message('start', tabId);
    let state = await result(tabId, 'notSeen');
    report('worker with code nobody recorded reads Not seen', state, state?.verdict?.result === 'notSeen');
    await sleep(6000);
    state = await message('getState', tabId);
    report('still Not seen after that worker is gone', state, state?.verdict?.result === 'notSeen');
    await goTo(tabId, `${DEMO}/demo`);
    state = await result(tabId, 'matches');
    report('navigating to clean code clears it', state, state?.verdict?.result === 'matches');
    await message('finish', tabId);
    await closeTab(tabId);
  }

  if (steps.includes('privacy')) {
    const { targetInfos } = await send('Target.getTargets');
    const worker = targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
    const { sessionId } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
    await send('Network.enable', {}, sessionId);
    const tabId = await openTab('https://app.safe.global/');
    await sleep(3000);
    await message('start', tabId);
    const state = await result(tabId);
    await sleep(65_000); // Long enough for the refresh that runs while attached.
    await message('finish', tabId);
    await closeTab(tabId);
    await send('Target.detachFromTarget', { sessionId });
    const hosts = [...new Set(requests.map(r => new URL(r.url).host))].sort();
    const naming = requests.filter(r => /safe\.global|cow\.fi|revoke\.cash/.test(JSON.stringify(r)));
    console.log(`  extension network: ${requests.length} requests to ${hosts.join(', ')}`);
    report(`no request names a site (${naming.length} did)`, state, requests.length > 0 && naming.length === 0 && hosts.every(h => /arkiv\.network$|publicnode\.com$/.test(h)));
  }

  if (steps.includes('ens')) {
    const w2 = await ev(`chrome.storage.local.get('catalogue').then(({ catalogue: c }) => c.roster.find(r => r.label === 'w2').address)`);
    const tabId = await openTab('https://app.safe.global/');
    await sleep(5000);
    await message('start', tabId);
    let state = await result(tabId, 'matches');
    report('Safe before clearing w2', state, state?.verdict?.result === 'matches');
    // Records can't be read during the flip: a revocation has to count anyway.
    const { targetInfos } = await send('Target.getTargets');
    const worker = targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
    const { sessionId } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
    const fetchedAt = () => ev(`chrome.storage.local.get('catalogue').then(({ catalogue: c }) => c.fetchedAt)`);
    await send('Network.enable', {}, sessionId);
    await send('Network.setBlockedURLs', { urls: ['*arkiv.network*'] }, sessionId);
    await sleep(70_000); // Long enough for any read already under way to finish.
    const blockedAt = await fetchedAt();
    try {
      console.log(' ', run('ens/clear-witness.mjs', 'w2').trim());
      state = await result(tabId, 'notSeen', 480);
      report('Safe after clearing w2, with records unreadable', state, state?.verdict?.result === 'notSeen' && await fetchedAt() === blockedAt);
      await shot('safe-w2-cleared', tabId);
    } finally {
      console.log(' ', run('ens/set-witness.mjs', 'w2', w2).trim());
      await send('Network.setBlockedURLs', { urls: [] }, sessionId);
    }
    state = await result(tabId, 'matches', 480);
    report('Safe after restoring w2', state, state?.verdict?.result === 'matches');
    await message('finish', tabId);
    await closeTab(tabId);
  }
} finally {
  ws.close();
  proc.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  rmSync(extDir, { recursive: true, force: true });
}
console.log(failures ? `${failures} failed` : 'all passed', `screenshots in ${SHOTS}`);
process.exitCode = failures ? 1 : 0;
