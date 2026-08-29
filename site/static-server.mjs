import fs from 'node:fs';
import path from 'node:path';

export const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createStaticHandler(root, { transformHtml } = {}) {
  return (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = path.normalize(path.join(root, urlPath));
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const stat = fs.statSync(filePath);
    const headers = {
      'content-type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
      'last-modified': stat.mtime.toUTCString(),
      'cache-control': 'no-cache',
    };
    let body = fs.readFileSync(filePath);
    if (transformHtml && headers['content-type'].startsWith('text/html')) {
      body = transformHtml(body, urlPath, stat.mtime);
    }
    res.writeHead(200, headers);
    res.end(body);
  };
}
