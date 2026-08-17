---
name: design-system-scaffold
description: Create a new site already wrapped in the ByteDesk family design system — Next.js App Router starter, --bd-* tokens and the site's own profile vendored at .context/design-system by /design-system-sync, product accent set, and IMPECCABLE_CONTEXT_DIR pointed at that profile. Use when starting a new ByteDesk site or web app from scratch, or when asked to "scaffold a site", "create a new ByteDesk site", or "/design-system-scaffold <name>".
---

# Scaffold a ByteDesk site

You are wrapping the family design system around a site's content. The
scaffolder produces the wrapper — chrome, tokens, accent, profile. Everything it
leaves behind is a placeholder for content that only you and the user can write.

## Before running

Settle three things. Ask only what you cannot infer from the request.

1. **Slug** — lowercase kebab-case, and the directory name. `agent-browser-site`,
   not `AgentBrowserSite`.
2. **Product accent** — one of `platform`, `gateway`, `vault`, `store`,
   `workforce`, `agent-browser`, `agent-memory`, `capture`. Pick the product the
   site is *about*. If the site speaks for the suite rather than one product,
   use `platform`. Do not invent an accent: the list is the set of
   `[data-bd-product]` rules in `tokens/css/bytedesk.css`.
3. **Display name** — how the site names itself in chrome and metadata.

## Run it

From a checkout of `ByteDeskAI/design-system` (it carries the starter
templates):

```bash
node scaffold/create.mjs <target-dir> <app-slug> --accent <product> --name "Display Name" --no-submodule
```

Equivalently `./bin/create-bytedesk-site <target-dir> <app-slug> …`.

Useful flags: `--template <name>` (default `nextjs-site`), `--no-profile` to
skip seeding the upstream profile, `--force` to write into a directory that
already has files.

`--no-submodule` is not optional here. Delivery is **vendored committed files**,
not a submodule pin — the sync writes into the same `.context/design-system`
path the templates already import from. Vendor it, then verify the site builds;
a scaffold that does not build is not a deliverable:

```bash
cd <target-dir>
node <design-system-plugin>/scripts/design-system-sync.mjs --app <app-slug>
npm install
npm run build
git add .context/design-system && git commit -m "vendor the design system"
```

## What it produced

- `.context/design-system` — the tokens plus **this site's own profile**, plain
  committed files written by `/design-system-sync`. Read-only: token and profile
  changes land upstream in `ByteDeskAI/design-system`, are published into the
  plugin payload, and arrive here on the next sync.
- `src/app/globals.css` — `@import "tailwindcss"`, then the family token CSS and
  the Tailwind v4 adapter **from `.context/design-system`**, then a local
  `@theme inline` block whose names alias `--bd-*`.
- `src/app/layout.tsx` — family chrome, with `data-bd-product="<accent>"` on
  `<html>`. That attribute is the single declaration of product identity.
- `src/components/{Header,Footer}.tsx` — the wrapper.
- `src/content/site.ts` — typed content stub, rendered by `src/app/page.tsx`.
- `.envrc` — `IMPECCABLE_CONTEXT_DIR=.context/design-system/profiles/<slug>`.
- `DESIGN.md` + `.context/README.md` — the consumer adapter files.
- `profiles/<slug>/{DESIGN.md,PRODUCT.md}` **in the design-system repository** —
  a starter profile so the new site has an impeccable context from day one.

## Rules to carry into everything you add next

- **Consume `--bd-*`; never restate a literal.** A hex code in the generated
  repository is drift, not a decision. If the value you need is not a token,
  that is a foundation change and it lands upstream first.
- **Vendor only your own profile.** `.context/design-system/profiles/` holds one
  directory: this site's. Another app's profile appearing there is a bug.
- **The accent is identity, not status.** `--bd-accent` marks the product —
  marks, chips, section headers, active states. Semantic state uses
  `--bd-success` / `--bd-warning` / `--bd-danger`, and status is always a dot
  **plus a word**, never colour alone. This matters most where the accent and a
  semantic colour are the same hue (vault/amber, store/green).
- **Content lives typed in `src/content/`.** Components render it; they do not
  inline copy.
- **Extend the shared vocabulary in `globals.css`** before writing new CSS.

## Hand off

The shell exists; the design decisions for *this* site do not. Finish by handing
off to `$impeccable` for content-specific craft, working against the new
profile:

1. Author `profiles/<slug>/DESIGN.md` and `PRODUCT.md` upstream — the generated
   files are prompts, not decisions. Replace the north star, density call,
   accent–status rule, and bans with real ones.
2. Catalog the profile in `catalog.json` (`sourceRepository`, a full 40-char
   `sourceCommit`, `path`) and run `node scripts/validate.mjs` — an uncataloged
   profile fails CI.
3. Commit upstream, run `node scripts/publish-plugin.mjs` to refresh the plugin
   payload, then re-run `/design-system-sync` in the new site and commit the
   updated `.context/design-system`.
4. Only then write the site's content and pages.
