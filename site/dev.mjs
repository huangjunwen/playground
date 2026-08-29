import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from './static-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outDir = path.join(repoRoot, '_site');
const port = Number(process.env.PORT ?? 4173);

// App mounts proxied to their Vite dev servers (ports pinned via
// `server.port` + `strictPort` in each app's vite.config.ts). Add an entry
// per app.
const appTargets = [{ mount: '/agda-editor', target: 'http://127.0.0.1:5173' }];

// The revision is embedded as a meta tag in the served page (atomic with its
// content) and compared against the response Last-Modified of a HEAD poll —
// so any rebuild after page load is detected, with no baseline race.
const reloadScript = rev => `
<meta name="site-rev" content="${rev}">
<script>
(function () {
  var rev = document.querySelector('meta[name="site-rev"]').content;
  setInterval(function () {
    fetch(location.href, { method: 'HEAD', cache: 'no-store' })
      .then(function (r) {
        var m = r.headers.get('last-modified');
        if (m && m !== rev) location.reload();
      })
      .catch(function () {});
  }, 1000);
})();
</script>`;

const staticHandler = createStaticHandler(outDir, {
  transformHtml: (body, _urlPath, mtime) =>
    body.toString().replace('</body>', `${reloadScript(mtime.toUTCString())}</body>`),
});

function matchTarget(url) {
  return appTargets.find(t => url === t.mount || url.startsWith(`${t.mount}/`));
}

function proxyRequest(target, req, res) {
  const { protocol, hostname, port: targetPort } = new URL(target.target);
  const headers = { ...req.headers, host: `${hostname}:${targetPort}` };
  if (headers.origin) headers.origin = target.target;
  const upstream = http.request(
    { protocol, hostname, port: targetPort, method: req.method, path: req.url, headers },
    upstreamRes => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', err => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      `dev server for ${target.mount} (${target.target}) is not reachable — ` +
        `it may still be starting (${err.code ?? err.message})`,
    );
  });
  req.pipe(upstream);
}

function proxyUpgrade(target, req, socket, head) {
  const { hostname, port: targetPort } = new URL(target.target);
  const headers = { ...req.headers, host: `${hostname}:${targetPort}` };
  if (headers.origin) headers.origin = target.target;
  const upstream = net.connect(Number(targetPort), hostname, () => {
    let request = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [name, value] of Object.entries(headers)) {
      for (const v of Array.isArray(value) ? value : [value]) request += `${name}: ${v}\r\n`;
    }
    upstream.write(`${request}\r\n`);
    if (head?.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

const server = http.createServer((req, res) => {
  const target = matchTarget(req.url);
  if (target) proxyRequest(target, req, res);
  else staticHandler(req, res);
});
server.on('upgrade', (req, socket, head) => {
  const target = matchTarget(req.url);
  if (target) proxyUpgrade(target, req, socket, head);
  else socket.destroy();
});

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['build.mjs'], { cwd: here, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
  });
}

let building = false;
let queued = false;
function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  console.log('[site] sources changed — rebuilding');
  runBuild()
    .catch(err => console.error(`[site] rebuild failed: ${err.message}`))
    .finally(() => {
      building = false;
      if (queued) {
        queued = false;
        rebuild();
      }
    });
}

function watchTrees(dirs, onChange) {
  const watchers = new Map();
  let timer;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  };
  const watchDir = dir => {
    if (watchers.has(dir)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const watcher = fs.watch(dir, event => {
      trigger();
      if (event === 'rename') rescan();
    });
    watcher.on('error', () => {});
    watchers.set(dir, watcher);
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        watchDir(path.join(dir, entry.name));
    }
  };
  const rescan = () => {
    for (const [dir, watcher] of watchers) {
      watcher.close();
      watchers.delete(dir);
    }
    for (const dir of dirs) watchDir(dir);
  };
  for (const dir of dirs) watchDir(dir);
}

const docsDirs = [here];
for (const group of ['apps', 'packages']) {
  const groupDir = path.join(repoRoot, group);
  if (!fs.existsSync(groupDir)) continue;
  for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const docsDir = path.join(groupDir, entry.name, 'docs');
      if (fs.existsSync(docsDir)) docsDirs.push(docsDir);
    }
  }
}

await runBuild();
watchTrees(docsDirs, rebuild);
server.on('error', err => {
  console.error(`[site] cannot listen on port ${port}: ${err.code ?? err.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`[site] dev gateway on http://127.0.0.1:${port}/`);
  console.log('[site]   / + /docs/…   landing page & docs (auto-reload on markdown changes)');
  for (const target of appTargets)
    console.log(`[site]   ${target.mount}/  ->  ${target.target}  (Vite dev server, HMR)`);
});
