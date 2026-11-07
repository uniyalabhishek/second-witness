// The Second Witness site: a homepage, and a fake treasury page that can serve altered code to one browser, by cookie.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP_PATH = '/assets/app-0123456789abcdef.js';
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

const head = title => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/base.css">
<link rel="stylesheet" href="/site.css">
</head>
<body>
`;

const HOME = `${head('Second Witness')}<main class="home">
  <h1>Second Witness</h1>
  <p>A website can run different code in your browser than everyone else gets. The page looks the same, but your money can go somewhere else.</p>
  <p>Second Witness is a button you press before you sign. It compares the code in your tab with what two witnesses recorded. If it's different, don't sign.</p>
  <nav class="home-links">
    <a class="button" href="/demo">Demo</a>
    <a class="button button--quiet" href="/extension">Extension</a>
    <a class="button button--quiet" href="https://github.com/uniyalabhishek/second-witness">GitHub</a>
  </nav>
</main>
</body>
</html>
`;

const EXTENSION = `${head('Install Second Witness')}<main class="home">
  <h1>Install Second Witness</h1>
  <p>It isn't in the Chrome Web Store yet, so you load it by hand.</p>
  <ol class="home-steps">
    <li><a href="/second-witness-extension.zip">Download the zip</a> and unzip it.</li>
    <li>Open <span class="mono">chrome://extensions</span> and turn on Developer mode.</li>
    <li>Press Load unpacked and choose the unzipped folder.</li>
    <li>Open the <a href="/demo">demo</a>, click the extension and press Check before signing.</li>
  </ol>
</main>
</body>
</html>
`;

const button = (action, label) => `<form method="post" action="${action}"><button class="button button--quiet">${label}</button></form>`;

const DEMO = `${head('Demo Treasury')}<main class="tr">
  <header class="tr-top"><h1>Demo Treasury</h1><p class="small quiet">A fake payment page. Altered code changes the recipient.</p></header>
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
  <section class="tr-control">
    ${button('/control/target', 'Serve me altered code')}
    ${button('/control/clean', 'Clean the server')}
    ${button('/control/refetch', 'Restore clean code')}
  </section>
</main>
<script src="${APP_PATH}"></script>
</body>
</html>
`;

// Swaps this browser's cached copy, then returns. On its own page, so the demo page keeps no inline script.
const REFRESH_PAGE = `<!doctype html><title>Demo Treasury</title><script>fetch(${JSON.stringify(APP_PATH)},{cache:'reload'}).finally(function(){location.replace('/demo')})</script>`;

// A check must not freeze a page that hits debugger statements, at load or later.
const DEBUGGER_PAGE = `<!doctype html><title>0</title><script>let ticks = 0; debugger; setInterval(() => { debugger; document.title = String(++ticks); }, 100);</script>`;

// Stays loading for a while, so the browser test can check that no result shows until it's done.
const SLOW_PAGE = `<!doctype html><title>Slow</title><script src="${APP_PATH}"></script><script src="/slow.js"></script>`;

// Starts a worker that is gone seconds later, so the browser test can check its code still counts.
const WORKER_PAGE = `<!doctype html><title>Worker</title><script>setTimeout(() => new Worker('/brief.js'), 2000)</script>`;

const SITE_CSS = `.home { max-width: 560px; margin: 0 auto; padding: var(--space-5) var(--space-3); display: grid; gap: var(--space-3); }
.home h1 { font-size: var(--text-xl); line-height: var(--leading-tight); }
.home p { font-size: var(--text-l); }
.home-links { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.home-links a { text-decoration: none; }
.home-steps { list-style: decimal; padding-left: var(--space-4); display: grid; gap: var(--space-2); font-size: var(--text-l); }
.tr { max-width: 560px; margin: 0 auto; padding: var(--space-4) var(--space-3) var(--space-5); display: grid; gap: var(--space-4); }
.tr-top { display: grid; gap: var(--space-1); }
.tr-top h1 { font-size: var(--text-l); line-height: var(--leading-tight); }
.tr-pay { display: grid; gap: var(--space-3); }
.tr-amount { font-size: var(--text-xl); font-weight: var(--weight-strong); line-height: var(--leading-tight); font-variant-numeric: tabular-nums; }
.tr .row { --row-label: 96px; font-size: var(--text-m); }
.tr-recipient { font-family: var(--font-mono); font-size: var(--text-s); overflow-wrap: anywhere; font-weight: var(--weight-strong); }
.tr-actions { display: grid; gap: var(--space-2); justify-items: start; }
.tr-control { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-top: var(--space-3); border-top: var(--rule-width) solid var(--rule); }
@media (max-width: 520px) {
  .tr .row { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); }
}
`;

export function createDemoServer() {
  return createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const mode = (req.headers.cookie ?? '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const targeted = mode === '1' || mode === 'labelled';
    const send = (status, type, body, headers = {}) => res.writeHead(status, { 'content-type': type, ...headers }).end(body);
    // private: a shared cache must never hold per-cookie code. No Vary: the demo relies on this browser's copy outliving the cookie.
    const js = body => send(200, 'text/javascript; charset=utf-8', body, { 'cache-control': 'private, max-age=31536000, immutable' });
    const cssFile = body => send(200, 'text/css; charset=utf-8', body);
    const html = body => send(200, 'text/html; charset=utf-8', body, { 'cache-control': 'no-store' });
    const redirect = (to, cookie) => res.writeHead(303, { location: to, 'set-cookie': cookie }).end();
    const clear = `${COOKIE}=; Path=/; Max-Age=0`;

    if (req.method === 'GET') {
      if (pathname === '/') return html(HOME);
      if (pathname === '/extension') return html(EXTENSION);
      if (pathname === '/demo') return html(DEMO);
      if (pathname === '/refresh') return html(REFRESH_PAGE);
      if (pathname === APP_PATH) return js(app(targeted ? OTHER : RECIPIENT) + (mode === 'labelled' ? '//# sourceURL=x.js\n' : ''));
      if (pathname === '/tokens.css') return cssFile(css('tokens.css'));
      if (pathname === '/base.css') return cssFile(css('base.css'));
      if (pathname === '/site.css') return cssFile(SITE_CSS);
      if (pathname === '/debugger') return html(DEBUGGER_PAGE);
      if (pathname === '/worker') return html(WORKER_PAGE);
      if (pathname === '/brief.js') return send(200, 'text/javascript; charset=utf-8', 'setTimeout(close, 2000);\n', { 'cache-control': 'no-store' });
      if (pathname === '/slow') return html(SLOW_PAGE);
      if (pathname === '/slow.js') return setTimeout(() => send(200, 'text/javascript; charset=utf-8', '// Slow\n', { 'cache-control': 'no-store' }), SLOW_MS);
    }
    if (req.method === 'POST') {
      if (pathname === '/control/target') return redirect('/refresh', `${COOKIE}=1; Path=/; SameSite=Lax; HttpOnly`);
      if (pathname === '/control/target-labelled') return redirect('/refresh', `${COOKIE}=labelled; Path=/; SameSite=Lax; HttpOnly`);
      if (pathname === '/control/clean') return redirect('/demo', clear);
      if (pathname === '/control/refetch') return redirect('/refresh', clear);
    }
    return send(404, 'text/plain', 'Not found');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  createDemoServer().listen(port, () => console.log(`Demo on http://localhost:${port}/demo`));
}
