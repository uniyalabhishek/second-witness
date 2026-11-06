// Bundles the popup, and the service worker and manifest once they exist.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL(p, import.meta.url));
const dist = at('./dist/');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const entryPoints = [at('./src/popup.ts'), at('./src/popup.css')];
if (existsSync(at('./src/background.ts'))) entryPoints.push(at('./src/background.ts'));
await build({ entryPoints, bundle: true, outdir: dist, entryNames: '[name]', format: 'iife', target: 'chrome120', logLevel: 'warning' });

copyFileSync(at('./src/popup.html'), `${dist}popup.html`);
if (existsSync(at('./manifest.json'))) copyFileSync(at('./manifest.json'), `${dist}manifest.json`);
