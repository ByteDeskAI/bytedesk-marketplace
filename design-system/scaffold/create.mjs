#!/usr/bin/env node
/**
 * create-bytedesk-site — scaffold a new site already wrapped in the ByteDesk
 * design system.
 *
 * Usage:
 *   node scaffold/create.mjs <target-dir> <app-slug> [options]
 *
 * Options:
 *   --accent <product>   Product accent slug (default: platform).
 *                        One of the data-bd-product values in
 *                        tokens/css/bytedesk.css.
 *   --name "Display"     Display name (default: derived from the slug).
 *   --template <name>    Template under scaffold/templates (default: nextjs-site).
 *   --no-submodule       Skip `git submodule add` (offline / vendored setups).
 *   --no-profile         Skip creating profiles/<slug>/ in this repository.
 *   --force              Write into a target directory that already has files.
 *
 * Zero dependencies: Node ESM + git, matching the repository's other
 * `node scripts/*.mjs` tooling.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBMODULE_URL = "https://github.com/ByteDeskAI/design-system.git";
const SUBMODULE_PATH = ".context/design-system";
const DEFAULT_TEMPLATE = "nextjs-site";
const DEFAULT_ACCENT = "platform";

// Kept in step with the [data-bd-product] rules in tokens/css/bytedesk.css.
const PRODUCT_ACCENTS = [
  "platform",
  "gateway",
  "vault",
  "store",
  "workforce",
  "agent-browser",
  "agent-memory",
  "capture",
];

class UsageError extends Error {}

function usage() {
  return [
    "Usage: create-bytedesk-site <target-dir> <app-slug> [options]",
    "",
    "Options:",
    "  --accent <product>   product accent slug (default: platform)",
    `                       one of: ${PRODUCT_ACCENTS.join(", ")}`,
    '  --name "Display"     display name (default: derived from the slug)',
    `  --template <name>    template to use (default: ${DEFAULT_TEMPLATE})`,
    "  --no-submodule       skip `git submodule add`",
    "  --no-profile         skip creating profiles/<slug>/ upstream",
    "  --force              allow a non-empty target directory",
  ].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    accent: DEFAULT_ACCENT,
    name: null,
    template: DEFAULT_TEMPLATE,
    submodule: true,
    profile: true,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--accent":
      case "--name":
      case "--template": {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new UsageError(`${arg} requires a value`);
        }
        options[arg.slice(2)] = value;
        index += 1;
        break;
      }
      case "--no-submodule":
        options.submodule = false;
        break;
      case "--no-profile":
        options.profile = false;
        break;
      case "--force":
        options.force = true;
        break;
      case "-h":
      case "--help":
        console.log(usage());
        process.exit(0);
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  const [targetDir, slug] = positional;
  if (!targetDir || !slug) throw new UsageError("target-dir and app-slug are both required");
  if (positional.length > 2) throw new UsageError(`unexpected argument: ${positional[2]}`);
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    throw new UsageError(`app-slug must be lowercase kebab-case: ${slug}`);
  }
  if (!PRODUCT_ACCENTS.includes(options.accent)) {
    throw new UsageError(
      `unknown accent "${options.accent}" — expected one of: ${PRODUCT_ACCENTS.join(", ")}`,
    );
  }

  return { targetDir: path.resolve(targetDir), slug, ...options };
}

function titleCase(slug) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function tryRun(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0;
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

// Never rewritten or traversed. `.context` matters most: the submodule is
// read-only from the consumer, and a placeholder pass over it would corrupt
// the design system itself.
const SKIP_DIRECTORIES = new Set([".git", ".context", "node_modules", ".next", "out"]);

/** Every path under `directory`, relative and POSIX-separated. */
async function walk(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      output.push(...(await walk(path.join(directory, entry.name), relativePath)));
    } else {
      output.push(relativePath);
    }
  }
  return output;
}

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".js",
  ".ts",
  ".tsx",
  "",
]);

async function rewritePlaceholders(root, replacements) {
  for (const relativePath of await walk(root)) {
    if (!TEXT_EXTENSIONS.has(path.extname(relativePath))) continue;
    const absolutePath = path.join(root, relativePath);
    const original = await readFile(absolutePath, "utf8");
    let rewritten = original;
    for (const [token, value] of Object.entries(replacements)) {
      rewritten = rewritten.split(token).join(value);
    }
    if (rewritten !== original) await writeFile(absolutePath, rewritten);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const installedPlugin = existsSync(path.join(repoRoot, "payload", ".payload-manifest.json"));
  if (installedPlugin) {
    options.submodule = false;
    options.profile = false;
  }
  const { targetDir, slug, accent, template, force } = options;
  const appName = options.name ?? titleCase(slug);

  const templateDir = path.join(repoRoot, "scaffold", "templates", template);
  if (!(await isDirectory(templateDir))) {
    const available = (await readdir(path.join(repoRoot, "scaffold", "templates"))).join(", ");
    throw new UsageError(`unknown template "${template}" — available: ${available}`);
  }

  if (await isDirectory(targetDir)) {
    const existing = await readdir(targetDir);
    const meaningful = existing.filter((entry) => entry !== ".git");
    if (meaningful.length > 0 && !force) {
      throw new UsageError(`target directory is not empty: ${targetDir} (use --force)`);
    }
  }

  console.log(`Scaffolding ${appName} (${slug}) into ${targetDir}`);
  console.log(`  template: ${template}   accent: ${accent}`);

  // 1. Copy the template.
  await mkdir(targetDir, { recursive: true });
  await cp(templateDir, targetDir, { recursive: true });
  if (existsSync(path.join(targetDir, "_gitignore"))) {
    await rename(path.join(targetDir, "_gitignore"), path.join(targetDir, ".gitignore"));
  }

  // 2. Make it a git repository so the submodule has somewhere to land.
  if (!existsSync(path.join(targetDir, ".git"))) {
    run("git", ["init", "--quiet"], targetDir);
  }

  // 3. Mount the design system.
  const submoduleAbsolute = path.join(targetDir, SUBMODULE_PATH);
  let submoduleMounted = existsSync(submoduleAbsolute);
  if (options.submodule && !submoduleMounted) {
    await mkdir(path.dirname(submoduleAbsolute), { recursive: true });
    // -c protocol.file.allow=always keeps local-path clones working too.
    submoduleMounted = tryRun(
      "git",
      ["submodule", "add", "--force", SUBMODULE_URL, SUBMODULE_PATH],
      targetDir,
    );
    if (!submoduleMounted) {
      console.warn(
        `  ! git submodule add failed (offline or no access to ${SUBMODULE_URL}).\n` +
          `    Mount it by hand:\n` +
          `      git submodule add ${SUBMODULE_URL} ${SUBMODULE_PATH}`,
      );
    }
  }

  // 4. Rewrite placeholders, including the token import paths, which are
  //    relative to src/app/globals.css inside the generated repository.
  const tokensPrefix = path.posix.join("../..", SUBMODULE_PATH, "tokens");
  await rewritePlaceholders(targetDir, {
    __BD_TOKENS_CSS__: `${tokensPrefix}/css/bytedesk.css`,
    __BD_TOKENS_TAILWIND__: `${tokensPrefix}/tailwind/theme.css`,
    __APP_NAME__: appName,
    __SLUG__: slug,
    __ACCENT__: accent,
  });

  // 5. Consumer adapter files: .envrc, .context/README.md, root DESIGN.md.
  const profileDir = path.posix.join(SUBMODULE_PATH, "profiles", slug);
  await writeFile(
    path.join(targetDir, ".envrc"),
    [
      "# direnv: this repository's impeccable context is its profile inside the",
      "# design-system submodule. Run `direnv allow` once after cloning.",
      `export IMPECCABLE_CONTEXT_DIR=${profileDir}`,
      "",
    ].join("\n"),
  );

  const consumerTemplates = path.join(repoRoot, "templates", "consumer");
  await mkdir(path.join(targetDir, ".context"), { recursive: true });
  await writeFile(
    path.join(targetDir, ".context", "README.md"),
    (await readFile(path.join(consumerTemplates, "context-readme.md"), "utf8")).replaceAll(
      "PRODUCT_SLUG",
      slug,
    ),
  );
  await writeFile(
    path.join(targetDir, "DESIGN.md"),
    (await readFile(path.join(consumerTemplates, "DESIGN.md"), "utf8"))
      .replaceAll("PRODUCT_SLUG", slug)
      .replace("PATH_TO_TOKEN_ROOT", "`src/app/globals.css` (`@theme inline` alias block)")
      .replace("DESIGN_VALIDATION_COMMAND", "`npm run build`"),
  );

  // 6. Seed the upstream profile only from the canonical authoring checkout.
  let profileCreated = false;
  const upstreamProfileDir = path.join(repoRoot, "profiles", slug);
  if (options.profile && !(await isDirectory(upstreamProfileDir))) {
    await mkdir(upstreamProfileDir, { recursive: true });
    await writeFile(
      path.join(upstreamProfileDir, "DESIGN.md"),
      starterProfileDesign(appName, slug, accent),
    );
    await writeFile(
      path.join(upstreamProfileDir, "PRODUCT.md"),
      starterProfileProduct(appName, slug),
    );
    profileCreated = true;
  }

  const stepNumber = (function counter() {
    let value = 0;
    return () => (value += 1);
  })();

  console.log("\nScaffolded. Next steps:\n");
  console.log(`  ${stepNumber()}. cd ${targetDir}`);
  if (!options.submodule) {
    console.log(`  ${stepNumber()}. Run design-system-init --app ${slug} from the installed ByteDesk plugin`);
  } else if (submoduleMounted) {
    console.log(`  ${stepNumber()}. git submodule update --init --recursive`);
  } else {
    console.log(
      `  ${stepNumber()}. git submodule add ${SUBMODULE_URL} ${SUBMODULE_PATH}` +
        "   # required: the token CSS lives here",
    );
  }
  console.log(`  ${stepNumber()}. npm install && npm run build`);
  console.log(`  ${stepNumber()}. direnv allow    # sets IMPECCABLE_CONTEXT_DIR=${profileDir}`);
  console.log(`  ${stepNumber()}. Fill in src/content/site.ts — the chrome is done, the content is not.`);

  if (profileCreated) {
    console.log(
      `\n  A starter design profile was written to ${path.relative(process.cwd(), upstreamProfileDir)}` +
        ` in the design-system repository.\n` +
        `  Author it (accent, density, bans), catalog it in catalog.json, run` +
        ` \`node scripts/validate.mjs\`, and commit upstream —\n` +
        `  then re-pin the submodule in ${path.basename(targetDir)}.`,
    );
  } else if (options.profile) {
    console.log(
      `\n  profiles/${slug}/ already exists upstream; left untouched.`,
    );
  }

  console.log(
    "\n  Design rule for everything you add: consume --bd-*, never restate a literal.\n" +
      `  The product accent is declared once, as data-bd-product="${accent}" on <html>.`,
  );
}

function starterProfileDesign(appName, slug, accent) {
  return `# Design — ${appName}

Canonical design profile for \`${slug}\`. Read after the
[shared foundation](../../DESIGN.md); the consumer repository's root
\`DESIGN.md\` carries only local exceptions and enforcement commands.

> **Starter profile.** Generated by \`scaffold/create.mjs\`. Every section below
> is a prompt, not a decision. Author it before the site ships, and delete this
> note when you do.

## Product stance

**Creative north star: "…"** — name the one image this site should leave behind.

Say what ${appName} is, who reads it, and what register it speaks in (brand,
marketing, console, admin). Product direction lives in [\`PRODUCT.md\`](PRODUCT.md).

## Token source

- Family value layer: \`tokens/css/bytedesk.css\` + \`tokens/tailwind/theme.css\`
  from this repository, consumed from the mounted submodule at
  \`.context/design-system\`.
- Consumer token root: the site's \`@theme inline {}\` block in
  \`src/app/globals.css\`. Local \`--color-*\` names **alias** \`--bd-*\` values;
  they never restate literals.
- Product accent: resolved by \`data-bd-product="${accent}"\` on the root element.
  Components read \`--bd-accent\`, never the hex.
- Validation: \`npm run build\` (type-check + lint gate).
- Foundation value changes land in this repository first, then the site re-pins
  the submodule.

## Visual language

**Palette roles.** Ground is \`--bd-bg-base\`; bands step through
\`--bd-bg-subtle\` / \`--bd-bg-surface\` / \`--bd-bg-elevated\`. Text runs the
\`--bd-text-*\` ramp; rules use \`--bd-border-*\`.

- **Product accent** (\`--bd-accent\`): identity only — the mark, chips, section
  headers, active navigation. Well under 10% of any surface.
- **Interactive blue** (\`--bd-interactive-blue\`): links, focus rings, primary
  action fills.
- **Semantic ok / warn / danger** (\`--bd-success\` / \`--bd-warning\` /
  \`--bd-danger\`): status only, never decoration.

**The accent–status separation rule.** State whether this site's accent collides
with a semantic colour. If it does, status is always dot **plus word**, and the
accent never appears as a bare status dot.

**Typography.** IBM Plex Sans (\`--bd-font-sans\`) for all UI text; IBM Plex Mono
(\`--bd-font-mono\`) only for machine-generated values — commands, identifiers,
code. Fluid scale via \`--bd-text-*\`.

**Density.** Decide: marketing density (looser) or console density (tighter).
The ladder lives in the token aliases, not in components.

**Layout.** Describe the composition. The starter renders full-width bands
separated by 1px rules inside a bounded reading column.

**Elevation.** Flat by default; depth is tonal.

**Motion.** 120–300ms on \`--bd-ease-out-expo\`, for state changes only.
\`prefers-reduced-motion\` is honored by the token layer.

## Component and composition rules

- Components reference tokens or token-backed utilities, never one-off literals.
- Extend the shared vocabulary in \`globals.css\` before inventing new CSS.
- Content lives typed in \`src/content/\`; components render it, never inline copy.

## Accessibility

Shared WCAG 2.2 AA foundation applies. Add this site's specific requirements —
contrast on any non-default band, colour-independence of status, reduced-motion
degradation.

## Exceptions to the shared foundation

None yet. Add only explicit, reviewed exceptions; never copy inherited prose here.

## Bans (absolute)

Restated colour literals. Side-stripe accent borders. Gradient text as identity.
Glassmorphism stacks. Hero-metric tiles. Fake proof of any kind — logos,
testimonials, metrics, "trusted by" strips. Vague AI language with no workflow,
artifact, or operator outcome behind it.
`;
}

function starterProfileProduct(appName, slug) {
  return `# Product — ${appName}

Product direction for \`${slug}\`. The design contract lives beside this file in
[\`DESIGN.md\`](DESIGN.md).

> **Starter profile.** Generated by \`scaffold/create.mjs\`. Answer each prompt
> below with something specific enough to argue with, then delete this note.

## What it is

One paragraph. What ${appName} is, and what a reader can do after visiting.

## Who it is for

Name the audiences and what each one arrives wanting. An audience you cannot
name is an audience you cannot write for.

## Journeys

For each audience: what they land on, what they read, what they do next, and
what the site owes them at each step.

## Proof policy

What this site may claim, and what it must be able to show. Maturity labels
(v0.x, beta, self-host) are system metadata and are stated plainly. No fabricated
customers, metrics, or endorsements.

## Voice

Plain, technical, specific. Say the thing. No marketing gloss, no em dashes in
UI copy.

## Out of scope

What this site deliberately does not try to do.
`;
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`error: ${error.message}\n`);
    console.error(usage());
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
