// Smallest real path: attach, Debugger.enable, skip pauses, resume on paused, hash every scriptParsed. No timers that outlive a flush, so nothing here keeps the worker alive by itself.
const BOOT = { id: crypto.randomUUID(), at: Date.now() };
const tabs = new Map();      // tabId -> state
const sources = new Map();   // `${tabId}:${n}` -> source, for mismatch diagnosis only
const keyOf = s => s.sessionId || 'root';
const hashText = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const hex = buf => [...new Uint8Array(buf).slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
const flush = st => { if (st.timer) return; st.timer = setTimeout(() => { st.timer = null; write(st); }, 100); };
const write = st => chrome.storage.session.set({ ['tab:' + st.tabId]: { tabId: st.tabId, boot: BOOT, attachMs: st.attachMs, enableMs: st.enableMs, rootDoneMs: st.rootDoneMs, doneMs: st.doneMs,
  paused: st.paused, errors: st.errors, sessions: st.sessions, frameEvents: st.frameEvents, docUrls: [...st.docUrls], gen: st.gen, detach: st.detach, scripts: st.scripts } }).catch(e => st.errors.push('storage:' + e.message));
const check = st => { const now = performance.now() - st.t0;
  if (st.rootReady && st.pendingRoot === 0 && st.rootDoneMs == null) st.rootDoneMs = Math.round(now);
  if (st.allReady && st.pending === 0 && st.doneMs == null) { st.doneMs = Math.round(now); write(st); } flush(st); };

async function enableOn(st, source) {
  await chrome.debugger.sendCommand(source, 'Debugger.enable');
  await chrome.debugger.sendCommand(source, 'Debugger.setSkipAllPauses', { skip: true });
}
async function start(tabId, opts) { opts = opts || {};
  const prev = tabs.get(tabId); if (prev?.attached) return { already: true };
  const st = { tabId, t0: performance.now(), attached: false, pending: 0, pendingRoot: 0, paused: 0, errors: [], sessions: { root: { type: 'page' } }, scripts: [], frameEvents: [], docUrls: new Set(), gen: 0, seq: 0, detach: null };
  tabs.set(tabId, st);
  await chrome.debugger.attach({ tabId }, '1.3');
  st.attached = true; st.attachMs = Math.round(performance.now() - st.t0);
  await enableOn(st, { tabId });
  st.enableMs = Math.round(performance.now() - st.t0); st.rootReady = true; check(st);
  try { await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    const { frameTree } = await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree');
    (function walk(n) { st.docUrls.add(n.frame.url); (n.childFrames || []).forEach(walk); })(frameTree);
    if (opts.autoAttach !== false) await chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  } catch (e) { st.errors.push('setup:' + e.message); }
  st.allReady = true; check(st);
  return { ok: true, attachMs: st.attachMs, enableMs: st.enableMs, boot: BOOT };
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  const st = tabs.get(source.tabId); if (!st) return;
  if (method === 'Debugger.paused') { st.paused++; chrome.debugger.sendCommand(source, 'Debugger.resume').catch(e => st.errors.push('resume:' + e.message)); return; }
  if (method === 'Target.attachedToTarget') { const { sessionId, targetInfo } = params;
    st.sessions[sessionId] = { type: targetInfo.type, url: targetInfo.url }; if (targetInfo.type === 'iframe') st.docUrls.add(targetInfo.url);
    const child = { tabId: source.tabId, sessionId };
    st.pending++; enableOn(st, child).catch(e => { st.sessions[sessionId].err = e.message; }).finally(() => { st.pending--; check(st); });
    chrome.debugger.sendCommand(child, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    return; }
  if (method === 'Target.detachedFromTarget') { const s = st.sessions[params.sessionId]; if (s) s.gone = true; return; }
  if (method === 'Page.frameNavigated') { st.docUrls.add(params.frame.url); st.frameEvents.push({ ms: Math.round(performance.now() - st.t0), url: params.frame.url, main: !params.frame.parentId }); if (!params.frame.parentId) st.gen++; flush(st); return; }
  if (method === 'Page.navigatedWithinDocument') { st.frameEvents.push({ ms: Math.round(performance.now() - st.t0), url: params.url, spa: true }); return; }
  if (method !== 'Debugger.scriptParsed') return;
  const session = keyOf(source), gen = st.gen, n = st.seq++; st.pending++; if (session === 'root') st.pendingRoot++;
  const a = params.executionContextAuxData || {};
  const rec = { n, url: params.url, length: params.length, isDefault: a.isDefault, ctxType: a.type, hasSourceURL: !!params.hasSourceURL, language: params.scriptLanguage, isModule: !!params.isModule, session, sessionType: st.sessions[session]?.type, gen, startLine: params.startLine, startColumn: params.startColumn, embedderName: params.embedderName, v8hash: params.hash, buildId: params.buildId };
  chrome.debugger.sendCommand(source, 'Debugger.getScriptSource', { scriptId: params.scriptId }).then(async r => {
    if (params.scriptLanguage === 'WebAssembly' || r.bytecode) { rec.wasm = true; rec.bytecodeLen = r.bytecode?.length; rec.hash = await hashText(r.bytecode || ''); }
    else { rec.hash = await hashText(r.scriptSource); rec.chars = r.scriptSource.length; sources.set(`${st.tabId}:${n}`, r.scriptSource); }
  }).catch(e => { rec.err = e.message; }).finally(() => { rec.ms = Math.round(performance.now() - st.t0); st.scripts.push(rec); st.pending--; if (session === 'root') st.pendingRoot--; check(st); });
});
chrome.debugger.onDetach.addListener((source, reason) => { const st = tabs.get(source.tabId); if (!st) return; st.attached = false; st.detach = { ...(st.detach || {}), reason, ms: Math.round(performance.now() - st.t0) }; write(st); });
chrome.tabs.onRemoved.addListener(async tabId => { const st = tabs.get(tabId); if (!st) return; const wasAttached = st.attached; let err = null;
  if (wasAttached) { try { await chrome.debugger.detach({ tabId }); } catch (e) { err = e.message; } } st.attached = false; st.detach = { ...(st.detach || {}), onRemoved: true, wasAttached, err }; write(st); });
chrome.runtime.onMessage.addListener((m, _s, reply) => { (async () => {
  if (m.type === 'start') return start(m.tabId, m.opts);
  if (m.type === 'boot') return BOOT;
  if (m.type === 'finish') { const st = tabs.get(m.tabId); let err = null; try { await chrome.debugger.detach({ tabId: m.tabId }); } catch (e) { err = e.message; } if (st) { st.attached = false; st.detach = { ...(st.detach || {}), finish: true, err }; await write(st); } return { err }; }
  if (m.type === 'cmd') return chrome.debugger.sendCommand({ tabId: m.tabId, ...(m.sessionId ? { sessionId: m.sessionId } : {}) }, m.method, m.params);   // spike-only: lets the harness evaluate and screenshot through the extension's own session
  if (m.type === 'source') return sources.get(`${m.tabId}:${m.n}`) ?? null;
  if (m.type === 'targets') return chrome.debugger.getTargets();
})().then(r => reply({ ok: true, r }), e => reply({ ok: false, err: e.message })); return true; });
