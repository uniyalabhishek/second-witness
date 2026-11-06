// The Demo Treasury as one Vercel function. Same server as `npm run demo`.
import { createDemoServer } from '../demo-site/server.mjs';

const { server } = createDemoServer({ key: process.env.CONTROL_KEY });

export default function handler(req, res) {
  server.emit('request', req, res);
}
