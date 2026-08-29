import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outDir = path.join(repoRoot, '_site');

const marked = new Marked({ gfm: true });
const template = fs.readFileSync(path.join(here, 'template.html'), 'utf8');

function collectMdFiles(dir) {
  const files = [];
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectMdFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function pageTitle(md) {
  for (const line of md.split('\n')) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match) {
      return match[1]
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replaceAll(/[*`_]/g, '')
        .trim();
    }
  }
  return 'Untitled';
}

function rewriteMdLinks(html) {
  return html.replaceAll(/href="([^"]*)"/g, (attr, url) => {
    const match = /^(.*?\.md)(#.*)?$/.exec(url);
    if (!match) return attr;
    return `href="${match[1].replace(/\.md$/, '.html')}${match[2] ?? ''}"`;
  });
}

function collectPages() {
  const pages = [{ source: path.join(here, 'index.md'), output: 'index.html' }];
  for (const group of ['apps', 'packages']) {
    const groupDir = path.join(repoRoot, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const docsDir = path.join(groupDir, entry.name, 'docs');
      if (!fs.existsSync(docsDir)) continue;
      for (const md of collectMdFiles(docsDir)) {
        const rel = path.relative(docsDir, md).split(path.sep).join('/');
        pages.push({
          source: md,
          output: `docs/${entry.name}/${rel.replace(/\.md$/, '.html')}`,
        });
      }
    }
  }
  return pages;
}

function renderPage(page) {
  const md = fs.readFileSync(page.source, 'utf8');
  const body = rewriteMdLinks(marked.parse(md, { async: false }));
  const depth = page.output.split('/').length - 1;
  const home = '../'.repeat(depth) || './';
  const crumbParts = path
    .dirname(page.output)
    .split('/')
    .filter(part => part !== '.');
  const title = pageTitle(md);
  const html = template
    .split('{{pagetitle}}')
    .join(depth === 0 ? title : `${title} · Playground`)
    .split('{{crumb}}')
    .join(crumbParts.join(' / '))
    .split('{{home}}')
    .join(home)
    .split('{{content}}')
    .join(body);
  return html;
}

fs.rmSync(path.join(outDir, 'index.html'), { force: true });
fs.rmSync(path.join(outDir, 'docs'), { recursive: true, force: true });
for (const page of collectPages()) {
  const target = path.join(outDir, page.output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderPage(page));
  console.log(`wrote _site/${page.output}`);
}
