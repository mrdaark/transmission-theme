import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep) || pathname.split('/').some(p => p.startsWith('.')) || !(await stat(file)).isFile()) throw new Error('Not found');
    const contentType = types[extname(file)];
    if (!contentType) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? '' : await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
const portIndex = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (portIndex >= 0 ? process.argv[portIndex + 1] : 3000));
server.listen(port, '0.0.0.0', () => console.log(`Transmission theme preview on port ${server.address().port}. Open /?demo=1 for sample data.`));
