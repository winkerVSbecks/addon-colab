import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./pages/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
export function serve(port = 0) {
  const server = http.createServer(async (req, res) => {
    const p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    try { const body = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }).end(body); }
    catch { res.writeHead(404).end('nf'); }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}
if (import.meta.url === `file://${process.argv[1]}`) { const { origin } = await serve(Number(process.env.PORT || 4848)); console.log(origin); }
