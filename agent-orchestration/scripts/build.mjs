import { build } from "esbuild";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
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
    plugins: [isolateClaudeSettings],
    banner: { js: "import { createRequire as __aoCreateRequire } from 'node:module'; const require = __aoCreateRequire(import.meta.url);" },
  }),
]);

await copyFile(
  require.resolve("@agentclientprotocol/codex-acp/dist/index.js"),
  join(outdir, "codex-acp.mjs"),
);

await cp(join(root, "session-ui", "mockup"), join(outdir, "session-ui"), { recursive: true });

// Keep committed install artifacts compatible with repository whitespace
// gates, including third-party bridge output that contains trailing blanks.
for (const name of ["mcp.cjs", "host-launcher.cjs", "cli.cjs", "provider-sandbox.cjs", "probe-worker.cjs", "claude-agent-acp.mjs", "codex-acp.mjs"]) {
  const path = join(outdir, name);
  const source = await readFile(path, "utf8");
  await writeFile(path, `${source.replace(/[ \t]+$/gm, "").replace(/\n*$/, "")}\n`);
}
