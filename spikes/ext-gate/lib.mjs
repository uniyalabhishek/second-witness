// Raw CDP harness. No Playwright: Playwright auto-attaches to the service worker, which would keep it alive and void the survival test.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, 'out');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const hash128 = b => createHash('sha256').update(b).digest('hex').slice(0, 32);
function chromium() { if (process.env.CHROME_BIN) return process.env.CHROME_BIN; const base = join(homedir(), 'Library/Caches/ms-playwright');
  const d = readdirSync(base).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1])[0];
  return join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'); }
export async function launch({ exts = ['ext'], port = 9400 + Math.floor(Math.random() * 400) } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'ext-gate-'));
  const proc = spawn(chromium(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', `--load-extension=${exts.map(e => join(HERE, e)).join(',')}`, `--disable-extensions-except=${exts.map(e => join(HERE, e)).join(',')}`, '--window-size=1280,900', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore' });
  let v; for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); } }
  if (!v) throw new Error('browser did not start');
  const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(), subs = new Set();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); } else subs.forEach(f => f(m)); };
  const send = (method, params = {}, sessionId, ms = 15000) => new Promise((r, j) => { const i = ++id; const t = setTimeout(() => { pend.delete(i); j(new Error(`timeout ${method}`)); }, ms);
    pend.set(i, { r: x => { clearTimeout(t); r(x); }, j: x => { clearTimeout(t); j(x); } }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  // extension id from the service worker target, read over HTTP so nothing attaches to it
  let extId; for (let i = 0; i < 40 && !extId; i++) { const ts = (await send('Target.getTargets')).targetInfos; const w = ts.find(t => t.type === 'service_worker' && t.url.endsWith('/sw.js')); if (w) extId = new URL(w.url).host; else await sleep(250); }
  if (!extId) throw new Error('extension service worker not found: --load-extension ignored?');
  const { targetId: ctlId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
  const { sessionId: ctl } = await send('Target.attachToTarget', { targetId: ctlId, flatten: true });
  await sleep(300);
  const ev = async (expression, s = ctl, ms = 20000) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s, ms); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const msg = (m, ms) => ev(`chrome.runtime.sendMessage(${JSON.stringify(m)})`, ctl, ms).then(x => { if (!x?.ok) throw new Error(x?.err || 'no reply'); return x.r; });
  const b = { port, send, list, ev, msg, extId, ctl, ctlId, version: v.Browser, subs,
    close: async () => { try { ws.close(); } catch {} proc.kill(); await sleep(500); try { rmSync(profile, { recursive: true, force: true }); } catch {} } };
  // open url in its own window, wait for load + settle, with no debugger attached by the extension
  b.open = async (url, settle = 4000, loadMs = 25000) => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Page.bringToFront', {}, sessionId).catch(() => {});
    const loaded = new Promise(r => { const f = m => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { subs.delete(f); r(true); } }; subs.add(f); setTimeout(() => { subs.delete(f); r(false); }, loadMs); });
    await send('Page.navigate', { url }, sessionId);
    const didLoad = await loaded; await sleep(settle);
    // frame-gap monitor, so a main-thread stall from Debugger.enable shows up
    await ev(`(()=>{const m=window.__mon={raf:0,maxRaf:0,maxTimer:0,lr:performance.now(),lt:performance.now()};const fr=()=>{const n=performance.now();m.maxRaf=Math.max(m.maxRaf,n-m.lr);m.lr=n;m.raf++;requestAnimationFrame(fr)};requestAnimationFrame(fr);setInterval(()=>{const n=performance.now();m.maxTimer=Math.max(m.maxTimer,n-m.lt);m.lt=n},16);return 1})()`, sessionId).catch(() => {});
    await sleep(1500);
    const baseline = await ev(`({focus:document.hasFocus(),raf:__mon.raf,maxRaf:Math.round(__mon.maxRaf),maxTimer:Math.round(__mon.maxTimer),vis:document.visibilityState,w:innerWidth,h:innerHeight})`, sessionId).catch(e => ({ err: e.message }));
    await ev(`__mon.maxRaf=0;__mon.maxTimer=0;1`, sessionId).catch(() => {});
    await send('Target.detachFromTarget', { sessionId });   // harness steps away; only the extension is attached from here
    const self = await ev(`chrome.windows ? 0 : 0`).catch(() => 0);
    const tabs = await ev(`chrome.tabs.query({}).then(ts=>ts.map(t=>({id:t.id,windowId:t.windowId,active:t.active})))`);
    const me = await ev(`chrome.tabs.getCurrent().then(t=>t.windowId)`);
    const tab = tabs.filter(t => t.windowId !== me && t.active).at(-1);
    return { targetId, tabId: tab.id, didLoad, baseline };
  };
  b.click = (id, tabId, opts) => ev(`(async()=>{globalThis.__tabId=${tabId};globalThis.__opts=${JSON.stringify(opts ?? null)};globalThis.__last=undefined;document.getElementById(${JSON.stringify(id)}).click();for(let i=0;i<400&&globalThis.__last===undefined;i++)await new Promise(r=>setTimeout(r,25));return globalThis.__last})()`);
  b.state = tabId => ev(`chrome.storage.session.get('tab:${tabId}').then(x=>x['tab:${tabId}'])`);
  b.waitDone = async (tabId, ms = 20000) => { const t = Date.now(); for (;;) { const s = await b.state(tabId); if (s?.doneMs != null || Date.now() - t > ms) return s; await sleep(50); } };
  b.pageEval = async (tabId, expression, ms = 8000) => { const r = await msg({ type: 'cmd', tabId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }, ms); return r.result?.value; };
  b.shot = async (tabId, name) => { const r = await msg({ type: 'cmd', tabId, method: 'Page.captureScreenshot', params: { format: 'png' } }, 20000); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); return name; };
  return b;
}
// classes from the brief, with both inline tests the coordinator asked about
export function classOf(r, pageOrigin, docUrls) {
  if (r.language === 'WebAssembly' || r.wasm) return 'wasm';
  if (r.ctxType === 'isolated') return 'isolated';
  if (r.url.startsWith('chrome-extension://') && !r.hasSourceURL) return 'extMain';
  if (r.hasSourceURL) return r.url.startsWith('chrome-extension://') ? 'spoofExt' : 'evalNamed';
  if (!r.url) return 'evalEmpty';
  if (r.startLine || r.startColumn || docUrls.includes(r.url)) return 'inline';   // nonzero start: parsed out of an HTML document
  if (/^(blob|data):/.test(r.url)) return 'blobData';
  let o; try { o = new URL(r.url).origin; } catch { return 'other'; }
  return o === pageOrigin ? 'file' : 'thirdParty';
}
// the PRD's rules taken literally, against the tab's URL at read time
export function prdClassify(r, pageUrl, origin) {
  if (r.isDefault === false || r.url.startsWith('chrome-extension://')) return 'ignored';
  if (r.hasSourceURL || !r.url || r.url === pageUrl) return 'uncompared';
  let o; try { o = new URL(r.url).origin; } catch { return 'thirdParty'; }
  return o !== origin ? 'thirdParty' : 'file';
}
export const tally = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
export function screencap(name) { try { return 'os shot disabled: pure.mjs captures the browser window only'; } catch (e) { return 'failed: ' + e.message; } }
