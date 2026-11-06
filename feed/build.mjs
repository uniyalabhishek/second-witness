// Bundles the feed to static files: index.html, feed.css, main.js. The replay data is inlined.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL(p, import.meta.url));
const dist = at('./dist/');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [at('./src/main.ts'), at('./src/feed.css')],
  bundle: true,
  outdir: dist,
  entryNames: '[name]',
  format: 'esm',
  target: 'es2022',
  logLevel: 'warning',
});

copyFileSync(at('./index.html'), `${dist}index.html`);
