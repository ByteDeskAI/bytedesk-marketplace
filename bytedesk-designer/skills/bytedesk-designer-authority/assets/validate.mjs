#!/usr/bin/env node
// Gates for a design authority. Node stdlib only — a validator with a dependency tree is a
// validator that stops running. Prints every failure, not just the first: stopping at the
// first error makes fixing ten problems take ten runs.
//
// Fill in TOKENS/CSS/CATALOG below and delete any gate that doesn't apply. Then break the
// repo once per gate and confirm each one fails. A gate nobody has seen fail is a guess.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(ROOT, 'tokens/design.tokens.json');
const CSS = join(ROOT, 'tokens/css/design.css');
const CATALOG = join(ROOT, 'catalog.json');
const README = join(ROOT, 'README.md');

const failures = [];
const notes = [];
const fail = (gate, msg) => failures.push(`${gate}: ${msg}`);

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

// DTCG tokens nest arbitrarily; flatten to `color.accent` -> value.
function flatten(node, prefix = [], out = {}) {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue;
    if (v && typeof v === 'object' && '$value' in v) out[[...prefix, k].join('.')] = v.$value;
    else if (v && typeof v === 'object') flatten(v, [...prefix, k], out);
  }
  return out;
}

// `color.textMuted` -> `--ds-color-text-muted`. Kebab-case, because that is what a CSS
// generator produces and a custom property matched case-sensitively is a silent miss.
const tokenName = (path) =>
  `--ds-${path.replace(/\./g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;

// --- gate: token parity -----------------------------------------------------
// Catches a hand-edited stylesheet, which is how these repos usually rot.
const tokens = flatten(json(TOKENS));
const css = read(CSS);

// Parity is about the :root block only. Product scopes deliberately override tokens with
// different values further down the file, and scanning the whole stylesheet lets the last
// override win — which reads as every scoped product disagreeing with its own token.
const rootBlock = css.match(/:root[^{]*\{([\s\S]*?)\}/);
if (!rootBlock) fail('token-parity', 'no :root block in the CSS adapter');
const declared = new Map();
for (const m of (rootBlock?.[1] ?? '').matchAll(/(--ds-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
  declared.set(m[1], m[2].trim());
}

for (const [path, value] of Object.entries(tokens)) {
  // Per-product tokens are emitted into their [data-product] scope, not :root. The accent
  // gate below checks them; checking them here too would demand they appear in both.
  if (path.startsWith('product.')) continue;
  const name = tokenName(path);
  if (!declared.has(name)) fail('token-parity', `${name} is in the tokens but missing from the CSS`);
  else if (declared.get(name).toLowerCase() !== String(value).toLowerCase())
    fail('token-parity', `${name} is ${declared.get(name)} in CSS but ${value} in the tokens`);
}
// The reverse direction. Product scopes only ever re-declare a token that already exists,
// so anything here that isn't a token is a hand-edit.
const known = new Set(Object.keys(tokens).map(tokenName));
for (const name of declared.keys()) {
  if (!known.has(name)) fail('token-parity', `${name} is declared in CSS but is not a token`);
}

// --- gate: contrast ---------------------------------------------------------
// Compute it. A swatch row lies; 4.5:1 does not.
const srgb = (hex) => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? [...h].map((c) => c + c) : h.match(/../g);
  return n.map((p) => {
    const c = parseInt(p, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
};
const luminance = (hex) => {
  const [r, g, b] = srgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// Each pairing the foundation declares. Edit to match your token names.
const PAIRINGS = [
  ['color.text', 'color.ground', 4.5],
  ['color.textMuted', 'color.ground', 4.5],
  ['color.text', 'color.surface', 4.5],
];
for (const [fg, bg, min] of PAIRINGS) {
  if (!tokens[fg] || !tokens[bg]) { notes.push(`contrast: skipped ${fg} on ${bg} (token absent)`); continue; }
  const ratio = contrast(tokens[fg], tokens[bg]);
  if (ratio < min) fail('contrast', `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`);
}

// --- gate: profile completeness --------------------------------------------
// Both directions: each catches a different half-finished edit.
const catalog = json(CATALOG);
const ACCENT_MODES = new Set(['own', 'inherits', 'none', 'undecided']);
const readme = existsSync(README) ? read(README) : '';
const undecided = [];
const ownAccents = new Map();

for (const p of catalog.products) {
  const profile = join(ROOT, p.profile ?? `profiles/${p.id}/DESIGN.md`);
  if (!existsSync(profile)) fail('profiles', `${p.id} is in the catalog but has no profile at ${p.profile}`);

  // --- gate: accent parity --------------------------------------------------
  // One truth, four places: token JSON, custom property, product scope, README table.
  const mode = p.accent?.mode;
  if (!ACCENT_MODES.has(mode)) {
    fail('accent', `${p.id} declares accent mode ${JSON.stringify(mode)}; expected one of ${[...ACCENT_MODES].join(', ')}`);
    continue;
  }
  if (mode === 'undecided') undecided.push(p.id);

  // `inherits` was the blind spot. Skipping every non-`own` product meant an entire class of
  // accent declaration got no check at all, and it hides a failure that looks like nothing:
  // a product inheriting from a SIBLING needs its own [data-product] scope, because :root
  // carries the family accent, not the sibling's. Without that scope the page renders the
  // family colour, uses var() correctly, hardcodes nothing, and passes every other gate.
  // Inheriting from the family (no `from`) is different — :root already applies, so no scope
  // is wanted and none is required.
  if (mode === 'inherits') {
    const from = p.accent.from;
    if (!from) continue;                       // inherits the family accent; :root covers it
    const src = catalog.products.find((q) => q.id === from);
    if (!src) { fail('accent', `${p.id} inherits from ${from}, which is not in the catalog`); continue; }
    if (src.accent?.mode !== 'own') {
      fail('accent', `${p.id} inherits from ${from}, which does not own an accent (mode ${src.accent?.mode})`);
      continue;
    }
    const want = src.accent.value.toLowerCase();
    const scope = css.match(new RegExp(`\\[data-product=["']${p.id}["']\\][^{]*\\{([^}]*)\\}`));
    if (!scope) {
      fail('accent', `${p.id} inherits ${want} from ${from} but has no [data-product="${p.id}"] scope; it will render the family accent instead`);
    } else {
      const got = scope[1].match(/--ds-color-accent\s*:\s*([^;]+);/);
      if (!got) fail('accent', `${p.id} scope declares no --ds-color-accent`);
      else if (got[1].trim().toLowerCase() !== want)
        fail('accent', `${p.id} inherits from ${from} (${want}) but its scope sets ${got[1].trim()}`);
    }
    continue;
  }

  if (mode !== 'own') continue;

  const value = p.accent.value?.toLowerCase();
  if (!value) { fail('accent', `${p.id} owns an accent but declares no value`); continue; }

  // Place 1 of 4: the token file. Values are authored here and everything else is
  // generated from them, so a product accent that lives only in the catalog and the
  // stylesheet has no source of truth — it is two hand-maintained copies agreeing by
  // luck. `product.<id>.accent` is where it belongs.
  const tokenValue = tokens[`product.${p.id}.accent`];
  if (!tokenValue)
    fail('accent', `${p.id} owns an accent but the tokens declare no product.${p.id}.accent`);
  else if (String(tokenValue).toLowerCase() !== value)
    fail('accent', `${p.id} token accent is ${tokenValue} but the catalog says ${value}`);

  if (ownAccents.has(value)) notes.push(`accent: ${p.id} and ${ownAccents.get(value)} both own ${value}`);
  else ownAccents.set(value, p.id);

  const scope = css.match(new RegExp(`\\[data-product=["']${p.id}["']\\][^{]*\\{([^}]*)\\}`));
  if (!scope) fail('accent', `${p.id} owns an accent but has no [data-product="${p.id}"] scope in the CSS`);
  else {
    const scoped = scope[1].match(/--ds-color-accent\s*:\s*([^;]+);/);
    if (!scoped) fail('accent', `${p.id} scope declares no --ds-color-accent`);
    else if (scoped[1].trim().toLowerCase() !== value)
      fail('accent', `${p.id} scope sets accent ${scoped[1].trim()} but the catalog says ${value}`);
  }
  if (readme && !readme.toLowerCase().includes(value))
    fail('accent', `${p.id}'s accent ${value} is missing from the README table`);
}

// Every profile directory appears in the catalog.
const catalogued = new Set(catalog.products.map((p) => p.id));
try {
  const { readdirSync } = await import('node:fs');
  for (const d of readdirSync(join(ROOT, 'profiles'), { withFileTypes: true })) {
    if (d.isDirectory() && !catalogued.has(d.name))
      fail('profiles', `profiles/${d.name} exists but is not in the catalog`);
  }
} catch { /* no profiles dir: a flat, single-product authority */ }

// --- report -----------------------------------------------------------------
for (const n of notes) console.log(n);
// Print open decisions every run. One that scrolls past in green is undecided forever.
if (undecided.length) console.log(`Open accent decisions (${undecided.length}): ${undecided.join(', ')}`);

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('Design authority is valid.');
