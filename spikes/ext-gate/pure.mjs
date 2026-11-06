// No CDP client on the page or worker at all: the extension drives itself and reports to a local server. Branded Chrome ignores --load-extension, so it is loaded over --remote-debugging-pipe with Extensions.loadUnpacked.
// node pure.mjs testing | node pure.mjs branded
import { spawn, execFileSync } from 'node:child_process'; import { createServer } from 'node:http'; import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs'; import { tmpdir, homedir } from 'node:os'; import { join } from 'node:path';
import { HERE, OUT, sleep } from './lib.mjs';
const mode = process.argv[2] || 'testing', label = mode; const AUTO = join(HERE, 'ext-auto'); rmSync(AUTO, { recursive: true, force: true }); cpSync(join(HERE, 'ext'), AUTO, { recursive: true });
const PORT = 9473; const urls = (process.argv[3] || 'https://app.safe.global/').split(',');
writeFileSync(join(AUTO, 'sw.js'), readFileSync(join(AUTO, 'sw.js'), 'utf8') + `
const post = (p, o) => fetch('http://127.0.0.1:${PORT}/' + p, { method: 'POST', body: JSON.stringify(o) });
const wait = ms => new Promise(r => setTimeout(r, ms));
chrome.runtime.onInstalled.addListener(async () => { for (const url of ${JSON.stringify(urls)}) { try {
  const tab = await chrome.tabs.create({ url }); await new Promise(r => { const f = (id, c) => { if (id === tab.id && c.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); r(); } }; chrome.tabs.onUpdated.addListener(f); });
  await wait(5000); await post('shot', { name: '${label}-before' }); await wait(500);
  const sr = await start(tab.id); const cmd = (m, p) => chrome.debugger.sendCommand({ tabId: tab.id }, m, p); const ev = async e => (await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
  const h0 = await ev('innerHeight'); const st = tabs.get(tab.id); for (let i = 0; i < 400 && st.doneMs == null; i++) await wait(25);
  await wait(2000); const h1 = await ev('innerHeight'); await post('shot', { name: '${label}-attached' }); await wait(500);
  const tick = await ev('new Promise(r=>{let n=0;const f=()=>{if(++n==30)r(n);else requestAnimationFrame(f)};const t=performance.now();requestAnimationFrame(f)}).then(n=>n)');
  const emptyRows = st.scripts.filter(s => !s.url).map(s => [s.length, (sources.get(st.tabId + ':' + s.n) || '').slice(0, 50)]); await post('result', { emptyRows, url, ua: navigator.userAgent, attachMs: st.attachMs, enableMs: st.enableMs, rootDoneMs: st.rootDoneMs, doneMs: st.doneMs, n: st.scripts.length, errs: st.errors, h0, h1, rafOk: tick, loc: await ev('location.href'), hashErrs: st.scripts.filter(s => s.err).length, sessions: Object.values(st.sessions).map(s => s.type) });
  await post('result', { step: 'pre-detach', attached: st.attached }); await wait(3000); const all = await chrome.tabs.query({}); const other = all.find(t => t.id !== tab.id); if (other) { await chrome.tabs.update(other.id, { active: true }); await wait(800); await post('shot', { name: '${label}-othertab' }); await chrome.tabs.update(tab.id, { active: true }); await wait(500); } const r = await chrome.debugger.detach({ tabId: tab.id }).then(() => 'ok', e => e.message); await wait(1500); await post('shot', { name: '${label}-finished' }); await wait(5000); await post('shot', { name: '${label}-finished6s' }); await wait(5000); await post('shot', { name: '${label}-finished11s' }); await post('result', { detach: r });
  await chrome.tabs.remove(tab.id);
} catch (e) { await post('result', { url, err: e.message }); } } await post('end', {}); });
`);
let ended; const end = new Promise(r => { ended = r; });
const srv = createServer((q, s) => { s.setHeader('access-control-allow-origin', '*'); let b = ''; q.on('data', d => b += d); q.on('end', () => { const o = b ? JSON.parse(b) : {}; if (q.url === '/shot') { try { const id = execFileSync(join(OUT, 'winid'), [mode === 'branded' ? 'Google Chrome' : 'Google Chrome for Testing', String(proc.pid)]).toString().trim(); execFileSync('screencapture', ['-x', '-o', '-l' + id, join(OUT, o.name + '.png')]); } catch (e) { console.log('shot', e.message); } }
  if (q.url === '/result') console.log(JSON.stringify(o)); if (q.url === '/end') ended(); s.end('ok'); }); }); srv.listen(PORT, '127.0.0.1');
const profile = mkdtempSync(join(tmpdir(), 'ext-pure-')); const common = [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', '--window-size=1280,900', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', 'about:blank'];
let proc;
if (mode === 'branded') { proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--remote-debugging-pipe', '--enable-unsafe-extension-debugging', ...common], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let buf = ''; proc.stdio[4].on('data', d => { buf += d; let i; while ((i = buf.indexOf('\0')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id === 1) console.log('loadUnpacked', JSON.stringify(m.result || m.error)); } });
  await sleep(2000); proc.stdio[3].write(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: AUTO } }) + '\0');
} else { const base = join(homedir(), 'Library/Caches/ms-playwright'); const d = readdirSync(base).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1])[0];
  proc = spawn(join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), [`--load-extension=${AUTO}`, `--disable-extensions-except=${AUTO}`, ...common], { stdio: 'ignore' }); }
await Promise.race([end, sleep(+(process.env.LIMIT || 45000)).then(() => console.log('timed out'))]); proc.kill(); srv.close(); await sleep(500); rmSync(profile, { recursive: true, force: true }); process.exit(0);
