// Computes WCAG contrast for the token pairs the surfaces actually use. Run: node design/contrast.mjs
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const grab = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
const light = grab(css.slice(0, css.indexOf('@media')));
const dark = grab(css.slice(css.indexOf(':root[data-theme="dark"]')));
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['ink', 'bg', 4.5], ['ink', 'surface', 4.5], ['ink-2', 'bg', 4.5], ['ink-2', 'surface', 4.5], ['bg', 'ink', 4.5], ['green', 'bg', 4.5], ['amber', 'bg', 4.5], ['red', 'bg', 4.5], ['grey', 'bg', 4.5], ['on-red', 'red-fill', 4.5], ['rule-strong', 'bg', 3]];
let fail = 0;
console.log('| Text on background | Light | Dark | Needs |\n|---|---|---|---|');
for (const [f, b, need] of pairs) { const l = ratio(light[f], light[b]); const d = ratio(dark[f], dark[b]); if (l < need || d < need) fail++; console.log(`| ${f} on ${b} | ${l.toFixed(2)} | ${d.toFixed(2)} | ${need} |`); }
console.log(fail ? `FAILED: ${fail}` : 'All pairs pass.');
process.exit(fail ? 1 : 0);
