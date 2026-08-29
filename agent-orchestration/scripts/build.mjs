import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = process.env.AO_BUILD_OUTDIR || join(root, "dist");
const require = createRequire(import.meta.url);
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  logLevel: "info",
  legalComments: "external",
  packages: "bundle",
};
const cjsApplication = {
  ...common,
  format: "cjs",
  define: { "import.meta.url": "__aoImportMetaUrl" },
  banner: { js: "const __aoImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
};
const isolateClaudeSettings = {
  name: "isolate-claude-settings",
  setup(context) {
    context.onLoad({ filter: /claude-agent-acp[\\/]dist[\\/]acp-agent\.js$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      const unsafeDefault = 'settingSources: ["user", "project", "local"]';
      const occurrences = source.split(unsafeDefault).length - 1;
      if (occurrences !== 1) throw new Error(`Expected one Claude settingSources default, found ${occurrences}.`);
      return { contents: source.replace(unsafeDefault, "settingSources: []"), loader: "js" };
    });
  },
};

/// The Claude Agent SDK ships a static model table that lags the CLI: Opus 5 is accepted by
/// `claude --model claude-opus-5` today but is absent from every published SDK build, so a route
/// to it would run with the wrong context window and capability metadata. Clone the newest Opus
/// entry under the new id at bundle time. Fails loudly if the table shape changes or upstream
/// adds the model itself, so this stops being applied the moment it stops being needed.
const declareOpus5 = {
  name: "declare-opus-5",
  setup(context) {
    context.onLoad({ filter: /claude-agent-sdk[\\/](sdk|bridge|browser-sdk)\.(mjs|js)$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      if (/id:\s*"claude-opus-5"/.test(source)) return { contents: source, loader: "js" };
      const match = /\{\s*id:\s*"claude-opus-4-8".*?\}\s*(?=,\s*\{\s*id:|\s*\])/s.exec(source);
      if (!match) throw new Error(`Could not find the claude-opus-4-8 model entry in ${path}.`);
      const clone = match[0].replace(/claude-opus-4-8/g, "claude-opus-5").replace(/"Opus 4\.8"/g, '"Opus 5"');
      return { contents: source.replace(match[0], `${clone}, ${match[0]}`), loader: "js" };
    });
  },
};

await Promise.all([
  build({ ...cjsApplication, entryPoints: [join(root, "src", "mcp.mjs")], outfile: join(outdir, "mcp.cjs") }),
  build({ ...cjsApplication, entryPoints: [join(root, "src", "host-launcher.mjs")], outfile: join(outdir, "host-launcher.cjs") }),
  build({ ...cjsApplication, entryPoints: [join(root, "src", "cli.mjs")], outfile: join(outdir, "cli.cjs") }),
  build({ ...cjsApplication, entryPoints: [join(root, "src", "provider-sandbox.mjs")], outfile: join(outdir, "provider-sandbox.cjs") }),
  build({ ...cjsApplication, entryPoints: [join(root, "src", "runtime", "probe-worker.mjs")], outfile: join(outdir, "probe-worker.cjs") }),
  build({
    ...common,
    entryPoints: [require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js")],
    outfile: join(outdir, "claude-agent-acp.mjs"),
    format: "esm",
    plugins: [isolateClaudeSettings, declareOpus5],
    banner: { js: "import { createRequire as __aoCreateRequire } from 'node:module'; const require = __aoCreateRequire(import.meta.url);" },
  }),
]);

const codexBridgeSource = await readFile(require.resolve("@agentclientprotocol/codex-acp/dist/index.js"), "utf8");
const unsafeWindowsCodexLaunch = 'codex = process.platform === "win32" ? spawn(`"${codexPath}" app-server`, { shell: true, env: spawnEnv }) : spawn(codexPath, ["app-server"], { env: spawnEnv });';
const safeCodexLaunch = 'codex = spawn(codexPath, ["app-server"], { env: spawnEnv, windowsHide: true, shell: false });';
const codexLaunchOccurrences = codexBridgeSource.split(unsafeWindowsCodexLaunch).length - 1;
if (codexLaunchOccurrences !== 1) throw new Error(`Expected one unsafe Windows Codex launch, found ${codexLaunchOccurrences}.`);
await writeFile(join(outdir, "codex-acp.mjs"), codexBridgeSource.replace(unsafeWindowsCodexLaunch, safeCodexLaunch));

await cp(join(root, "session-ui", "mockup"), join(outdir, "session-ui"), { recursive: true });

// Keep committed install artifacts compatible with repository whitespace
// gates, including third-party bridge output that contains trailing blanks.
for (const name of ["mcp.cjs", "host-launcher.cjs", "cli.cjs", "provider-sandbox.cjs", "probe-worker.cjs", "claude-agent-acp.mjs", "codex-acp.mjs"]) {
  const path = join(outdir, name);
  const source = await readFile(path, "utf8");
  await writeFile(path, `${source.replace(/[ \t]+$/gm, "").replace(/\n*$/, "")}\n`);
}
