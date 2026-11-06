// Fills public/ for hosting: the feed at /feed/ and the extension as a zip anyone can load. Run after any change to either.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

execFileSync('npm', ['run', '-s', 'build'], { stdio: 'inherit' });
rmSync('public', { recursive: true, force: true });
mkdirSync('public');
cpSync('feed/dist', 'public/feed', { recursive: true });
execFileSync('zip', ['-qr', '../../public/second-witness-extension.zip', '.'], { cwd: 'extension/dist' });
