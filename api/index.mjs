// The Demo Treasury as one Vercel function. Same server as `npm run demo`.
import { createDemoServer } from '../demo-site/server.mjs';

const { server } = createDemoServer({ key: process.env.CONTROL_KEY });

export default function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.searchParams.get('__path');
  if (path !== null) {
    url.searchParams.delete('__path');
    req.url = `/${path}${url.search}`;
  }
  server.emit('request', req, res);
}
