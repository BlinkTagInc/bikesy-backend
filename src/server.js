import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createAdapter, ApiError } from './adapter.js';
import { loadConfig } from './config.js';

// Exported handler supports contract tests without opening a listening socket.
export function createHandler(config, fetchImpl) {
  const route = createAdapter(config, fetchImpl);
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, data) => { res.statusCode = status; res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); };
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET,HEAD,OPTIONS');
      send(405, { error: 'Method not allowed' }); return;
    }
    const disconnected = new AbortController();
    const cancel = () => { if (!res.writableEnded) disconnected.abort(); };
    req.once?.('aborted', cancel);
    res.once?.('close', cancel);
    try {
      const url = new URL(req.url, 'http://bikesy.local');
      if (['/bounds', '/api/bounds'].includes(url.pathname)) { send(200, config.bounds); return; }
      if (url.pathname === '/health') { send(200, { status: 'ok' }); return; }
      // The published mobile client uses api.php followed by a slash before its query.
      if (!['/', '/route', '/api/route', '/api.php', '/api.php/'].includes(url.pathname)) {
        send(404, { error: 'Not found' });
        return;
      }
      send(200, await route(url.searchParams, disconnected.signal));
    } catch (error) {
      if (res.destroyed) return;
      send(error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : 'Internal server error' });
    } finally {
      req.off?.('aborted', cancel);
      res.off?.('close', cancel);
    }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = http.createServer({ requestTimeout: 30000, headersTimeout: 10000 }, createHandler(loadConfig()));
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Bikesy adapter listening on ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
