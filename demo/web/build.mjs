// Construit la démo web en un seul fichier HTML autonome :
//   node demo/web/build.mjs [sortie.html]
// Le binaire SQLite WebAssembly est embarqué en base64 : aucune ressource
// n'est téléchargée à l'exécution, hormis les polices.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(
  process.argv[2] ?? resolve(here, 'dist/resilios-demo.html'),
);
const wasmDir = resolve(
  root,
  'node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm',
);

const result = await build({
  entryPoints: [resolve(here, 'main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
  // Le chargeur « bundler-friendly » seul, sans le worker de promesses.
  alias: {
    '@sqlite.org/sqlite-wasm': resolve(wasmDir, 'sqlite3-bundler-friendly.mjs'),
  },
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const wasm = readFileSync(resolve(wasmDir, 'sqlite3.wasm')).toString('base64');
const template = readFileSync(resolve(here, 'template.html'), 'utf8');
const html = template.replace(
  '<!--APP-->',
  () =>
    `<script type="module">window.__RESILIOS_WASM__=${JSON.stringify(
      wasm,
    )};\n${js}</script>`,
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024 / 1024).toFixed(2)} Mo)`);
