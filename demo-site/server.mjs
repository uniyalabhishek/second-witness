// Demo target for Second Witness. A generic treasury page with no wallet and no real funds.
// It can serve altered code to one browser, by cookie, or publish a renamed file to everyone.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP_PATH = '/assets/app-0123456789abcdef.js';
export const RELEASE_PATH = '/assets/app-fedcba9876543210.js';
export const RECIPIENT = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
export const OTHER = '0x5e1f00000000000000000000000000000000dead';

const css = name => readFileSync(new URL(`../design/${name}`, import.meta.url));
const COOKIE = 'sw_target';
const SLOW_MS = 3000;

const app = recipient => `// Demo Treasury
const recipient = "${recipient}";
document.getElementById("recipient").textContent = recipient;
document.getElementById("sign").addEventListener("click", () => {
  document.getElementById("sign-note").textContent = "This demo has no wallet, so signing does nothing.";
});
`;

const page = appPath => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo Treasury</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/base.css">
<link rel="stylesheet" href="/treasury.css">
</head>
<body>
<main class="tr">
  <header class="tr-top"><h1>Demo Treasury</h1><p class="small quiet">Demo site. No wallet, no real funds.</p></header>
  <section class="tr-pay">
    <div>
      <h2 class="small quiet">Payment waiting for your signature</h2>
      <p class="tr-amount">250,000.00 USDC</p>
    </div>
    <dl>
      <div class="row"><dt>Recipient</dt><dd><span class="tr-recipient" id="recipient"></span></dd></div>
      <div class="row"><dt>From</dt><dd>Operations account</dd></div>
      <div class="row"><dt>Reference</dt><dd>Vendor invoice 4417</dd></div>
      <div class="row"><dt>Signatures</dt><dd><span class="num">1 of 3</span></dd></div>
    </dl>
    <div class="tr-actions">
      <button type="button" class="button" id="sign">Sign payment</button>
      <p class="small quiet" id="sign-note" role="status"></p>
    </div>
  </section>
</main>
<script src="${appPath}"></script>
</body>
</html>
`;

// A check must not freeze a page that hits debugger statements, at load or later.
const DEBUGGER_PAGE = `<!doctype html><title>0</title><script>let ticks = 0; debugger; setInterval(() => { debugger; document.title = String(++ticks); }, 100);</script>`;

// Stays loading for a while, so the browser test can check that no result shows until it's done.
const SLOW_PAGE = `<!doctype html><title>Slow</title><script src="${APP_PATH}"></script><script src="/slow.js"></script>`;

const TREASURY_CSS = `.tr { max-width: 560px; margin: 0 auto; padding: var(--space-4) var(--space-3) var(--space-5); display: grid; gap: var(--space-4); }
.tr-top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.tr-top h1 { font-size: var(--text-l); line-height: var(--leading-tight); }
.tr-pay { display: grid; gap: var(--space-3); }
.tr-amount { font-size: var(--text-xl); font-weight: var(--weight-strong); line-height: var(--leading-tight); font-variant-numeric: tabular-nums; }
.tr .row { --row-label: 96px; font-size: var(--text-m); }
.tr-recipient { font-family: var(--font-mono); font-size: var(--text-s); overflow-wrap: anywhere; font-weight: var(--weight-strong); }
.tr-actions { display: grid; gap: var(--space-2); justify-items: start; }
@media (max-width: 520px) {
  .tr-top { flex-wrap: wrap; gap: var(--space-1); }
  .tr .row { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); }
}
`;

const button = (action, label, key) => `<form method="post" action="${action}">${key ? '<input type="password" name="key" placeholder="Control key" required> ' : ''}<button class="button button--quiet">${label}</button></form>`;

const control = (release, targeted, refresh) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo control</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/base.css">
<link rel="stylesheet" href="/treasury.css">
</head>
<body>
<main class="tr">
  <header class="tr-top"><h1>Demo control</h1><p class="small quiet">This browser: ${targeted ? 'altered' : 'clean'}. Everyone: release ${release}.</p></header>
  <section class="tr-actions">
    ${button('/control/target', 'Serve this browser altered code')}
    ${button('/control/clean', 'Clean the server for this browser')}
    ${button('/control/refetch', 'Replace the cached copy with clean code')}
    ${button('/control/release', 'Publish renamed file to everyone', true)}
    ${button('/control/rollback', 'Roll everyone back', true)}
    <p class="small"><a href="/">Open Demo Treasury</a></p>
  </section>
</main>
${refresh ? `<script>fetch(${JSON.stringify(APP_PATH)},{cache:'reload'}).then(function(){location.replace('/')})</script>` : ''}
</body>
</html>
`;

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024) reject(new Error('too large'));
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

export function createDemoServer({ key = randomBytes(12).toString('hex') } = {}) {
  let release = 1;

  const server = createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
    const mode = (req.headers.cookie ?? '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const targeted = mode === '1' || mode === 'labelled';
    const send = (status, type, body, headers = {}) => res.writeHead(status, { 'content-type': type, ...headers }).end(body);
    // private: a shared cache must never hold per-cookie code. No Vary: the demo relies on this browser's copy outliving the cookie.
    const js = body => send(200, 'text/javascript; charset=utf-8', body, { 'cache-control': 'private, max-age=31536000, immutable' });
    const cssFile = body => send(200, 'text/css; charset=utf-8', body);
    const html = body => send(200, 'text/html; charset=utf-8', body, { 'cache-control': 'no-store' });
    const redirect = (to, headers = {}) => res.writeHead(303, { location: to, ...headers }).end();

    try {
      if (req.method === 'GET') {
        if (pathname === '/') return html(page(release === 1 ? APP_PATH : RELEASE_PATH));
        if (pathname === APP_PATH) return js(app(targeted ? OTHER : RECIPIENT) + (mode === 'labelled' ? '//# sourceURL=x.js\n' : ''));
        if (pathname === RELEASE_PATH) return js(app(OTHER));
        if (pathname === '/tokens.css') return cssFile(css('tokens.css'));
        if (pathname === '/base.css') return cssFile(css('base.css'));
        if (pathname === '/treasury.css') return cssFile(TREASURY_CSS);
        if (pathname === '/debugger') return html(DEBUGGER_PAGE);
        if (pathname === '/slow') return html(SLOW_PAGE);
        if (pathname === '/slow.js') return setTimeout(() => send(200, 'text/javascript; charset=utf-8', '// Slow\n', { 'cache-control': 'no-store' }), SLOW_MS);
        if (pathname === '/control') return html(control(release, targeted, searchParams.has('refresh')));
        return send(404, 'text/plain', 'Not found');
      }
      if (req.method === 'POST') {
        const form = await readForm(req);
        if (pathname === '/control/target') return redirect('/control?refresh=1', { 'set-cookie': `${COOKIE}=1; Path=/; SameSite=Lax; HttpOnly` });
        if (pathname === '/control/target-labelled') return redirect('/control?refresh=1', { 'set-cookie': `${COOKIE}=labelled; Path=/; SameSite=Lax; HttpOnly` });
        if (pathname === '/control/clean') return redirect('/', { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
        if (pathname === '/control/refetch') return redirect('/control?refresh=1', { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
        if (pathname === '/control/release' || pathname === '/control/rollback') {
          if (form.get('key') !== key) return send(403, 'text/plain', 'Wrong key');
          release = pathname === '/control/release' ? 2 : 1;
          return redirect('/control');
        }
      }
      return send(404, 'text/plain', 'Not found');
    } catch {
      return send(400, 'text/plain', 'Bad request');
    }
  });
  return { server, key };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  const { server, key } = createDemoServer({ key: process.env.CONTROL_KEY });
  const shown = process.env.CONTROL_KEY ? '' : `, key ${key}`; // A key we were given stays out of the logs.
  server.listen(port, () => console.log(`Demo Treasury on http://localhost:${port} (control at /control${shown})`));
}
