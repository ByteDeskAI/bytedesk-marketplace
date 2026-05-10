// fleet/web/build.mjs — bundle the Preact SPA into ../server/dist/.
//
// Two outputs:
//   server/dist/app.js   — bundled JS (Preact + components) ESM, minified.
//   server/dist/app.css  — bundled CSS (design tokens + base styles).
//   server/dist/index.html — handwritten template (loads app.js + app.css).
//
// The Go server (`fleet/web/server/`) embeds this dir via //go:embed and
// serves it at `/`. Run `npm run build` before `go build` (build.sh chains
// them).

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'server', 'dist');
const watch = process.argv.includes('--watch');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>fleet</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;

function cleanAndPrep() {
  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), indexHtml);
}

const jsOpts = {
  entryPoints: [path.join(SRC, 'main.tsx')],
  outfile: path.join(OUT, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  minify: !watch,
  sourcemap: true,
  logLevel: 'info',
};

const cssOpts = {
  entryPoints: [path.join(SRC, 'styles.css')],
  outfile: path.join(OUT, 'app.css'),
  bundle: true,
  minify: !watch,
  logLevel: 'info',
};

cleanAndPrep();

if (watch) {
  const [jsCtx, cssCtx] = await Promise.all([
    esbuild.context(jsOpts),
    esbuild.context(cssOpts),
  ]);
  await Promise.all([jsCtx.watch(), cssCtx.watch()]);
  console.log(`watching ${SRC} → ${OUT}`);
} else {
  await Promise.all([esbuild.build(jsOpts), esbuild.build(cssOpts)]);
  console.log(`built → ${OUT}`);
}
