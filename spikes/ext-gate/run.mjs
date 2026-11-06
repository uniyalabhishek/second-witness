// One command: node spikes/ext-gate/run.mjs [local|sw|real|wallet|all]. Writes out/*.json and prints a summary.
import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
import { launch, sleep, hash128, classOf, prdClassify, tally, OUT, screencap } from './lib.mjs';
import { serve } from './site/server.mjs';
const SAFE_VIEW = 'eth:0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4'; // Bybit's public cold wallet, read-only view, no wallet connected
const save = (n, o) => writeFileSync(join(OUT, n + '.json'), JSON.stringify(o, null, 1));
const P = +(process.env.PORT_BASE || 9471), Q = P + 1, A = `http://localhost:${P}`, B = `http://127.0.0.1:${Q}`;
async function servers() { const a = await serve(P, 'localhost', `127.0.0.1:${Q}`), b = await serve(Q, '127.0.0.1', `localhost:${P}`); return () => { a.close(); b.close(); }; }

async function compareFiles(b, tabId, files) { const out = { same: 0, diff: [], fetchFail: [] };
  await Promise.all(files.map(async r => { try { const res = await fetch(r.url, { signal: AbortSignal.timeout(25000) }); const buf = Buffer.from(await res.arrayBuffer()); const text = buf.toString('utf8'); const noBom = text.replace(/^﻿/, '');
      if (!res.ok) { out.fetchFail.push({ url: r.url, status: res.status }); return; }
      const h = hash128(Buffer.from(noBom)); if (h === r.hash) { out.same++; return; }
      const src = await b.msg({ type: 'source', tabId, n: r.n }); let i = 0; while (src && i < src.length && src[i] === noBom[i]) i++;
      out.diff.push({ url: r.url, engine: r.hash, fetch: h, rawBytes: hash128(buf), engineChars: src?.length, fetchChars: noBom.length, ct: res.headers.get('content-type'), firstDiffAt: i, engineAround: src?.slice(i, i + 60), fetchAround: noBom.slice(i, i + 60) });
    } catch (e) { out.fetchFail.push({ url: r.url, err: e.message }); } })); return out; }
const startCols = xs => ({ zero: xs.filter(r => r.startLine === 0 && r.startColumn === 0).length, nonzero: xs.filter(r => r.startLine !== 0 || r.startColumn !== 0).map(r => [r.url.slice(-60), r.startLine, r.startColumn]) });

async function site(b, url, { spa = [], name, idleMs = 2500 } = {}) {
  const o = await b.open(url); const res = { url, name, browser: b.version, didLoad: o.didLoad, baseline: o.baseline };
  const t = Date.now(); const start = await b.click('check', o.tabId); res.start = start;
  const s0 = await b.waitDone(o.tabId); res.wallMs = Date.now() - t;
  Object.assign(res, { attachMs: s0?.attachMs, enableMs: s0?.enableMs, rootDoneMs: s0?.rootDoneMs, doneMs: s0?.doneMs, atDoneCount: s0?.scripts?.length });
  await sleep(idleMs);
  const t1 = Date.now(); res.loc = await b.pageEval(o.tabId, 'location.href'); res.evalRoundtripMs = Date.now() - t1;
  res.mon = await b.pageEval(o.tabId, '({raf:__mon.raf,maxRaf:Math.round(__mon.maxRaf),maxTimer:Math.round(__mon.maxTimer),h:innerHeight,w:innerWidth,vis:document.visibilityState})');
  res.shot = await b.shot(o.tabId, `${name}.png`).catch(e => 'shot failed: ' + e.message);
  res.osShot = screencap(`${name}-os.png`);
  const frames = await b.msg({ type: 'cmd', tabId: o.tabId, method: 'Page.getFrameTree' }); const fl = []; (function w(n) { fl.push({ url: n.frame.url, origin: n.frame.securityOrigin, cross: n.frame.crossOriginIsolatedContextType }); (n.childFrames || []).forEach(w); })(frames.frameTree);
  const origin = new URL(res.loc).origin; res.frames = fl; res.crossOriginFrames = fl.filter(f => f.origin !== origin).length;
  res.targets = (await b.msg({ type: 'targets' })).filter(t => t.tabId === o.tabId || t.type !== 'page').map(t => ({ type: t.type, url: t.url.slice(0, 80), attached: t.attached }));
  let s = await b.state(o.tabId); const before = s.scripts.length;
  const analyse = (st, pageUrl) => { const cls = r => classOf(r, origin, st.docUrls); const rows = st.scripts; const files = rows.filter(r => cls(r) === 'file');
    return { n: rows.length, byClass: tally(rows, cls), bySession: tally(rows, r => r.sessionType), prd: tally(rows, r => prdClassify(r, pageUrl, origin)), errs: rows.filter(r => r.err).map(r => [r.url, r.err]).slice(0, 10), ctx: tally(rows, r => `${r.isDefault}/${r.ctxType}`),
      startFiles: startCols(files), startInline: startCols(rows.filter(r => cls(r) === 'inline')), thirdParty: [...new Set(rows.filter(r => cls(r) === 'thirdParty').map(r => { try { return new URL(r.url).host; } catch { return r.url; } }))], thirdPartyNonzero: rows.filter(r => cls(r) === 'thirdParty' && (r.startLine || r.startColumn)).length, wasm: rows.filter(r => r.wasm).map(r => [r.url.slice(0, 80), r.bytecodeLen]), inlineUrls: [...new Set(rows.filter(r => cls(r) === 'inline').map(r => r.url))], evalNamed: rows.filter(r => r.hasSourceURL).map(r => r.url.slice(0, 80)).slice(0, 15) }; };
  res.resourceScripts = await b.pageEval(o.tabId, `performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script'||e.name.split('?')[0].endsWith('.js')).map(e=>e.name)`).catch(() => []);
  { const seen = new Set(s.scripts.map(r => r.url)); res.loadedNotParsed = res.resourceScripts.filter(u => !seen.has(u)); }
  res.first = analyse(s, res.loc); res.compare = await compareFiles(b, o.tabId, s.scripts.filter(r => classOf(r, origin, s.docUrls) === 'file'));
  res.sessions = s.sessions; res.paused = s.paused; res.errors = s.errors;
  // later code while attached
  res.spa = [];
  for (const path of spa) { const c0 = (await b.state(o.tabId)).scripts.length; const ok = await b.pageEval(o.tabId, `(async()=>{const before=location.pathname; await window.next.router.push(${JSON.stringify(path)}); await new Promise(r=>setTimeout(r,3500)); return {before,after:location.pathname+location.search,title:document.title,text:document.body.innerText.slice(0,80)}})()`, 20000).catch(e => ({ err: e.message })); await sleep(800);
    const st = await b.state(o.tabId); const later = st.scripts.slice(c0); const cmp = await compareFiles(b, o.tabId, later.filter(r => classOf(r, origin, st.docUrls) === 'file')); res.spa.push({ path, ok, newScripts: later.length, byClass: tally(later, r => classOf(r, origin, st.docUrls)), compare: cmp, sampleNew: later.slice(0, 3).map(r => r.url.slice(-50)) }); }
  s = await b.state(o.tabId); const finalUrl = await b.pageEval(o.tabId, 'location.href');
  res.final = analyse(s, finalUrl); res.finalUrl = finalUrl; res.scripts = s.scripts; res.frameEvents = s.frameEvents; res.docUrls = s.docUrls;
  res.afterShot = await b.shot(o.tabId, `${name}-after.png`).catch(e => 'shot failed: ' + e.message);
  res.mon2 = await b.pageEval(o.tabId, '({raf:__mon.raf,maxRaf:Math.round(__mon.maxRaf),maxTimer:Math.round(__mon.maxTimer)})');
  res.finish = await b.click('finish', o.tabId); await sleep(300); res.detach = (await b.state(o.tabId)).detach;
  await b.send('Target.closeTarget', { targetId: o.targetId }); return res; }
const brief = r => ({ name: r.name, load: r.didLoad, attachMs: r.attachMs, enableMs: r.enableMs, rootDoneMs: r.rootDoneMs, doneMs: r.doneMs, atDone: r.atDoneCount, n: r.first.n, cls: r.first.byClass, sess: r.first.bySession, ctx: r.first.ctx, tp: r.first.thirdParty, base: r.baseline, mon: r.mon, evalMs: r.evalRoundtripMs, crossFrames: r.crossOriginFrames, resScripts: r.resourceScripts?.length, loadedNotParsed: r.loadedNotParsed?.length, compare: { same: r.compare.same, diff: r.compare.diff.length, fail: r.compare.fetchFail.length }, startFiles: { zero: r.first.startFiles.zero, nonzero: r.first.startFiles.nonzero.length }, startInline: { zero: r.first.startInline.zero, nonzero: r.first.startInline.nonzero.length }, spa: r.spa.map(x => ({ p: x.path, n: x.newScripts, cls: x.byClass, same: x.compare.same, diff: x.compare.diff.length, ok: x.ok?.after || x.ok?.err })), finalCls: r.final.byClass, finalPrd: r.final.prd, finish: r.finish, detach: r.detach, paused: r.paused, errors: r.errors, sessions: Object.values(r.sessions).map(x => x.type + (x.err ? ' ERR ' + x.err : '')) });

const phases = {
  async gcreal() { const b = await launch(); // worst case for replay: force GC before the button, then see which loaded files are gone
    for (const url of ['https://app.safe.global/', 'https://swap.cow.fi/', 'https://revoke.cash/']) { const g = await b.open(url); const { sessionId } = await b.send('Target.attachToTarget', { targetId: g.targetId, flatten: true }); await b.send('HeapProfiler.enable', {}, sessionId); for (let i = 0; i < 4; i++) await b.send('HeapProfiler.collectGarbage', {}, sessionId, 20000); await b.send('Target.detachFromTarget', { sessionId });
      await b.click('check', g.tabId); await b.waitDone(g.tabId); await sleep(500); const s = await b.state(g.tabId); const res = await b.pageEval(g.tabId, `[...new Set(performance.getEntriesByType('resource').filter(e=>e.name.split('?')[0].endsWith('.js')).map(e=>e.name))]`); const seen = new Set(s.scripts.map(r => r.url)); const gone = res.filter(u => !seen.has(u));
      console.log(url, JSON.stringify({ parsed: s.scripts.length, jsResources: res.length, loadedButGoneAfterGC: gone.length, gone: gone.map(u => u.slice(-60)).slice(0, 12), empty: s.scripts.filter(r => !r.url).length, inline: s.scripts.filter(r => r.startLine || r.startColumn).length, doneMs: s.doneMs })); await b.click('finish', g.tabId); await b.send('Target.closeTarget', { targetId: g.targetId }); }
    await b.close(); },
  async real() { const b = await launch(); const out = {};
    const targets = [
      ['safe-landing', 'https://app.safe.global/', { spa: ['/welcome/spaces', '/settings', '/licenses'] }],
      ['safe-accounts', 'https://app.safe.global/welcome/accounts', {}],
      ['safe-full', `https://app.safe.global/home?safe=${SAFE_VIEW}`, { spa: [`/balances?safe=${SAFE_VIEW}`, `/transactions/history?safe=${SAFE_VIEW}`, `/apps?safe=${SAFE_VIEW}`] }],
      ['safe-app', `https://app.safe.global/apps/open?safe=${SAFE_VIEW}&appUrl=${encodeURIComponent('https://apps-portal.safe.global/tx-builder')}`, {}], ['cow', 'https://swap.cow.fi/', {}], ['revoke', 'https://revoke.cash/', {}]];
    for (const [name, url, o] of targets) { const only = process.env.ONLY; if (only && !only.split(',').includes(name)) continue; try { const r = await Promise.race([site(b, url, { ...o, name }), sleep(150000).then(() => { throw new Error('site over 150s: frozen?'); })]); out[name] = r; save('real-' + name, r); console.log(JSON.stringify(brief(r))); } catch (e) { console.log(name, 'FAILED', e.message); out[name] = { err: e.message }; } }
    await b.close(); },
  async wallet() { const b = await launch({ exts: ['ext', 'ext2'] });
    const close = await servers();
    for (const [name, url] of [['wallet-local', `${A}/quiet`], ['wallet-safe', 'https://app.safe.global/']]) { const r = await site(b, url, { name }); save(name, r); console.log(JSON.stringify(brief(r))); console.log(name, 'non-file rows', JSON.stringify(r.scripts.filter(x => /chrome-extension|^$/.test(x.url) || x.ctxType !== 'default').map(x => ({ url: x.url.slice(0, 70), d: x.isDefault, t: x.ctxType, sU: x.hasSourceURL, l: x.startLine, c: x.startColumn, emb: x.embedderName?.slice(0, 40) })))); console.log(name, 'prd', JSON.stringify(r.first.prd)); }
    await b.close(); close(); },
  async local() { const b = await launch(); const close = await servers();
    // full matrix of script kinds
    const r = await site(b, `${A}/all`, { name: 'local-all' }); save('local-all', r); console.log(JSON.stringify(brief(r)));
    console.log('rows:'); for (const x of r.scripts) console.log(' ', JSON.stringify({ url: x.url.slice(0, 72), d: x.isDefault, t: x.ctxType, sU: x.hasSourceURL, lang: x.language, mod: x.isModule, l: x.startLine, c: x.startColumn, sess: x.sessionType, wasm: x.wasm, blen: x.bytecodeLen, err: x.err, cls: classOf(x, A, r.docUrls), prd: prdClassify(x, `${A}/all`, A) }));
    const sp = await b.open(`${A}/spa`, 800); await b.click('check', sp.tabId); await b.waitDone(sp.tabId); await sleep(300); const ss = await b.state(sp.tabId);
    const ft = await b.msg({ type: 'cmd', tabId: sp.tabId, method: 'Page.getFrameTree' }); const navName = await b.pageEval(sp.tabId, "performance.getEntriesByType('navigation')[0].name");
    console.log('spa', JSON.stringify({ loc: await b.pageEval(sp.tabId, 'location.href'), frameUrl: ft.frameTree.frame.url, navEntry: navName, docUrls: ss.docUrls, rows: ss.scripts.filter(x => !x.url || x.url.includes('spa') || x.url.includes('file')).map(x => [x.url, x.startLine, x.startColumn, x.hasSourceURL]) })); await b.click('finish', sp.tabId);
    // debugger statement + navigation while attached
    const o = await b.open(`${A}/debugger`, 1000); await b.click('check', o.tabId); const s = await b.waitDone(o.tabId); await sleep(500);
    const t1 = await b.pageEval(o.tabId, 'globalThis.t'); await sleep(800); const t2 = await b.pageEval(o.tabId, 'globalThis.t');
    await b.msg({ type: 'cmd', tabId: o.tabId, method: 'Page.navigate', params: { url: `${A}/next` } }); await sleep(1500);
    const s2 = await b.state(o.tabId); const t3 = await b.pageEval(o.tabId, 'globalThis.t'); await sleep(800); const t4 = await b.pageEval(o.tabId, 'globalThis.t');
    console.log('debugger page', JSON.stringify({ doneMs: s.doneMs, ticks: [t1, t2], paused: s.paused, afterNav: { ticks: [t3, t4], paused: s2.paused, gen: s2.gen, scripts: s2.scripts.map(x => [x.url, x.gen]), frames: s2.frameEvents, stillAttached: !s2.detach } }));
    // tab close while attached
    await b.send('Target.closeTarget', { targetId: o.targetId }); await sleep(800); console.log('tab close detach', JSON.stringify((await b.state(o.tabId)).detach));
    // does replay include scripts V8 has already collected?
    const g = await b.open(`${A}/gc`, 800);
    { const { sessionId } = await b.send('Target.attachToTarget', { targetId: g.targetId, flatten: true }); await b.send('HeapProfiler.enable', {}, sessionId); for (let i = 0; i < 4; i++) await b.send('HeapProfiler.collectGarbage', {}, sessionId, 15000); await b.send('Target.detachFromTarget', { sessionId }); }
    await b.click('check', g.tabId); const gs = await b.waitDone(g.tabId); await sleep(300); const gg = await b.state(g.tabId);
    const srcs = []; for (const x of gg.scripts) srcs.push(((await b.msg({ type: 'source', tabId: g.tabId, n: x.n })) || '').slice(0, 60)); console.log('after forced GC, replay saw', JSON.stringify(gg.scripts.map((x, i) => [x.url, srcs[i]])));
    await b.click('finish', g.tabId);
    await b.close(); close(); },
  async sw() { const b = await launch(); const close = await servers();
    const alive = async () => (await b.send('Target.getTargets')).targetInfos.some(t => t.type === 'service_worker' && t.url.endsWith('/sw.js'));
    const watch = async (label, ms) => { const t = Date.now(); let dead = null; while (Date.now() - t < ms) { if (!(await alive())) { dead = Math.round((Date.now() - t) / 1000); break; } await sleep(2000); } console.log(label, dead == null ? `alive after ${ms / 1000}s` : `worker gone after ${dead}s`); return dead; };
    const boot0 = await b.msg({ type: 'boot' });
    console.log('control, no session:', await watch('  control', 60000));
    const o = await b.open(`${A}/quiet`, 500); await b.click('check', o.tabId); const boot1 = await b.msg({ type: 'boot' }); await sleep(100);
    const d = await watch('  attached, quiet page', 75000); const boot2 = await b.msg({ type: 'boot' }); const s = await b.state(o.tabId);
    console.log(JSON.stringify({ sameBoot: boot1.id === boot2.id, ctlRestarted: boot0.id !== boot1.id, attached: !s.detach, d }));
    // late script after the idle period: does an event still reach the hashing path?
    await b.pageEval(o.tabId, `(0,eval)('globalThis.late=()=>1 //late')`); await sleep(300); const s2 = await b.state(o.tabId); console.log('late eval seen after idle:', s2.scripts.length, 'boot same', s2.boot.id === boot1.id);
    await b.click('finish', o.tabId); const d2 = await watch('  after Finish', 60000); console.log({ afterFinish: d2 });
    await b.close(); close(); } };
const which = process.argv[2] || 'all'; for (const p of which === 'all' ? ['local', 'wallet', 'sw', 'real'] : [which]) { console.log('== ' + p); await phases[p](); }
process.exit(0);
