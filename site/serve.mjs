import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from './static-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../_site');
const port = Number(process.argv[2] ?? 4173);

http.createServer(createStaticHandler(root)).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root}`);
  console.log(`  http://127.0.0.1:${port}/                  (landing page)`);
  console.log(`  http://127.0.0.1:${port}/docs/agda-editor/  (docs)`);
  console.log(`  http://127.0.0.1:${port}/agda-editor/       (app)`);
});
