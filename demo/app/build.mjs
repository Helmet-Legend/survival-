// Construit l'aperçu web de l'interface mobile en un seul fichier HTML :
//   node demo/app/build.mjs [sortie.html]
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(process.argv[2] ?? resolve(here, 'dist/resilios-app.html'));
const wasmDir = resolve(
  root,
  'node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm',
);

const result = await build({
  entryPoints: [resolve(here, 'main.tsx')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
  jsx: 'automatic',
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  mainFields: ['browser', 'module', 'main'],
  alias: {
    'react-native': 'react-native-web',
    '@sqlite.org/sqlite-wasm': resolve(wasmDir, 'sqlite3-bundler-friendly.mjs'),
  },
  define: {
    __DEV__: 'false',
    'process.env.NODE_ENV': '"production"',
  },
  loader: { '.js': 'jsx' },
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const wasm = readFileSync(resolve(wasmDir, 'sqlite3.wasm')).toString('base64');
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ResiliOS</title>
<style>
  html, body, #root { height: 100%; margin: 0; background: #000; }
  #root { display: flex; max-width: 480px; margin: 0 auto; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
</style>
<div id="root"></div>
<script type="module">window.__RESILIOS_WASM__=${JSON.stringify(wasm)};
${js}</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024 / 1024).toFixed(2)} Mo)`);
