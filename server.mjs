import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = import.meta.dirname;
const port = Number(process.env.PORT || 5174);
const publicFiles = new Set(['/index.html', '/style.css', '/src/game.js', '/src/rules.js']);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/index.html';
    if (!publicFiles.has(pathname)) {
      response.writeHead(404).end('Not found');
      return;
    }

    const body = await readFile(resolve(root, `.${pathname}`));
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(pathname)],
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 500).end('Unable to serve file');
  }
});

server.on('error', (error) => {
  console.error(`Cannot start Pinball Dungeon Crawl on port ${port}: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Pinball Dungeon Crawl: http://localhost:${server.address().port}`);
});
