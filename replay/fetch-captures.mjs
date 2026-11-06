// Downloads the archived captures once. They're third-party bytes, so they stay out of git.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
const FILE = 'https://app.safe.global/_next/static/chunks/pages/_app-52c9031bfa03da47.js';
const CAPS = ['20250214130614', '20250214190721', '20250217024944', '20250219111919', '20250219172905', '20250222022646', '20250222175509'];
const dir = new URL('./captures/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const ts of CAPS) {
  const path = new URL(`${ts}.bin`, dir);
  if (existsSync(path)) continue;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`https://web.archive.org/web/${ts}id_/${FILE}`).catch(() => null);
    if (r?.status === 200) { writeFileSync(path, Buffer.from(await r.arrayBuffer())); console.log('saved', ts); break; }
    await new Promise(res => setTimeout(res, 4000 * (i + 1)));
  }
}
