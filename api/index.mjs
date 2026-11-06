// The site as one Vercel function. Same server as `npm run demo`.
import { createDemoServer } from '../demo-site/server.mjs';

const server = createDemoServer();

export default function handler(req, res) {
  server.emit('request', req, res);
}
