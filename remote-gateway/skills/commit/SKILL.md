---
name: commit
description: >
  Commit and push repo changes with human-only authorship, Keep a Changelog
  update, and embedded changelog sync. After a successful commit in a linked
  git worktree, offer to merge into the main checkout and remove the tree
  (Grok/Claude/Codex isolation). Never attributes coding agents or
  external co-authors. Use when the user runs /commit, says "commit",
  "commit and push", "land the changes", "update changelog and push", or
  wants a clean push of the current worktree.
---

# /commit — human-authored land + push

Portable skill for **bytedesk-remote-gateway**. Works the same on Claude,
Codex, Kimi, Grok, and Cursor: filesystem + shell only; no vendor-specific
APIs.

**Platforms:** any host with `git` (Linux, macOS, Windows Git Bash/PowerShell).

**Default action:** update changelog → commit as the local git user → push
`HEAD` to its upstream. If this directory is a **linked git worktree**, then
**offer** to merge into the main checkout and remove the tree (do that land
automatically only when the user already asked, or they confirm).

## Hard rules (non-negotiable)

### Authorship — human only

1. **Author/committer is only the local git identity.** Use whatever
   `git config user.name` and `git config user.email` already are.
2. **Never** pass `--author`, `GIT_AUTHOR_*`, or `GIT_COMMITTER_*` overrides
   that name an agent, model, or service account.
3. **Never** add any of these to the commit message (subject, body, or trailer):
   - `Co-Authored-By:` / `Co-authored-by:` (any party)
   - `Signed-off-by:` for an agent or bot
   - `Generated-by`, `Generated with`, `Assisted-by`, `Via Claude/Codex/Grok/Kimi`
   - Model names, API product names, or “AI wrote this” prose
4. Do **not** invent a second human co-author. If the operator did not ask for
   another person in the trailer, there is no trailer attribution.
5. If `user.name` or `user.email` is empty, **stop** and tell the user to set
   them (`git config user.name` / `user.email`). Do not guess.

### Safety

1. Never update `git config` (local or global).
2. Never force-push (`--force`, `--force-with-lease`) unless the user explicitly
   demands a force push in this turn.
3. Never commit secrets or runtime state:
   - `control.env`, `config.json`, session stores
   - `_uptime_evidence/`, logs, binaries, `*.pem`, `*.key`
   - Anything under `~/.bytedesk-emote-gateway` paths
4. Prefer staging explicit paths. Avoid `git add -A` / `git add .` when the
   status includes secrets or large generated noise you have not inspected.
5. If there is nothing to commit after staging, say so and **do not** push an
   empty commit.

## Modes

| User phrase | Behavior |
|-------------|----------|
| `/commit`, “commit and push”, “land it”, (default) | changelog → commit → **push** → if linked worktree, **offer** merge + cleanup |
| “commit only”, “don’t push”, `/commit --no-push` | changelog → commit; **no push**; still offer worktree land if linked |
| “commit and merge”, `/commit --merge`, “land and cleanup”, “merge and remove the worktree” | changelog → commit → push → **merge + remove worktree** (no second ask) |
| “push only” | push current branch if clean/ahead; no new commit |
| “changelog only” | edit CHANGELOG + embed sync; leave uncommitted unless also asked to commit |

## Workflow

Run from the **repo root**. Prefer sequential shell steps so failures stop the
loop.

### 1) Inspect

```bash
git rev-parse --show-toplevel
git status -sb
git remote -v
git branch -vv
git config user.name
git config user.email
git diff --stat
git diff --cached --stat
git log -5 --format='%h %an <%ae> %s'
# Linked worktree? (linked=1 means offer merge+cleanup after land)
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/commit}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
"$SKILL_DIR/scripts/worktree-after-commit.sh" detect
```

Read enough of the diff to write an accurate changelog line and commit
message. If identity is missing, stop.

Remember `linked=`, `path=`, `branch=`, `main=`, `main_branch=`, `env=` from
detect. `env` is `grok` / `claude` / `git-cwd` / `git` so cleanup can use the
environment’s native remove (`grok worktree rm` when `env=grok`).

### 2) Classify the change

Pick conventional type + scope (match this repo’s history):

| Type | Use |
|------|-----|
| `feat` | User-visible capability |
| `fix` | Bug fix |
| `ops` | Deploy, CI, install, cutover |
| `chore` | Maintenance, skill scaffolding, housekeeping |
| `docs` | Docs only |
| `test` | Tests only |
| `refactor` | Behavior-preserving restructure |
| `style` | Formatting only |

Scope examples: `projects`, `sessions`, `spa`, `terminal`, `vault`, `ci`,
`skills`.

Subject: imperative, ~70 chars, no trailing period.  
Body: short why/what; no agent names.

### 3) Update `CHANGELOG.md`

Keep a Changelog, **date sections** (no semver tags yet).

1. Today’s date: `date -u +%Y-%m-%d` (or local ship date if the file already
   uses local dates consistently — prefer matching the newest section’s
   timezone style already in the file).
2. If `## [YYYY-MM-DD]` for today is missing, insert a new section **above**
   the previous date section (right after the intro/`---`).
3. Under the right subsection:
   - **Added** — new capability
   - **Changed** — behavior/UI change
   - **Fixed** — bugfix
   - **Removed** — deleted surface
4. Bullet style (match existing entries):

```markdown
- feat(projects): **Resizable desk panes** — drag left tree / right dock widths; persist per project in localStorage
```

Details: load `references/changelog.md`.

### 4) Sync embedded changelog

Production binaries embed the changelog. Always after editing `CHANGELOG.md`:

```bash
cp CHANGELOG.md src/embedded_changelog.md
```

Do not hand-edit `src/embedded_changelog.md` separately.

### 5) Stage

```bash
# Examples — adjust to the real paths from status
git add CHANGELOG.md src/embedded_changelog.md
git add path/to/changed/files
```

Re-check:

```bash
git status -sb
git diff --cached --stat
```

Unstage anything forbidden. Include regenerated `src/web_spa/**` only when the
SPA/embed change is intentional for this land.

### 6) Commit (human-only message)

Use a HEREDOC. **No** co-author trailers.

```bash
git commit -m "$(cat <<'EOF'
type(scope): short imperative subject

Optional body: why this change matters for operators/users.
EOF
)"
```

Verify authorship:

```bash
git log -1 --format='author=%an <%ae>%ncommitter=%cn <%ce>%nsubject=%s%n%b'
```

If the message body accidentally contains agent attribution, **amend only if**
the commit is still unpushed (HEAD was created by this skill in this turn):

```bash
git commit --amend -m "$(cat <<'EOF'
type(scope): corrected subject

Clean body with no agent attribution.
EOF
)"
```

Never amend commits that already exist on the remote unless the user
explicitly requests a rewrite.

### 7) Push (default)

```bash
git status -sb
git push -u origin HEAD
```

On non-fast-forward: stop, show `git status` / divergence, and ask. Do not
force-push unless the user explicitly ordered it.

### 8) Linked worktree — offer merge + cleanup

After a successful commit (and push, unless commit-only), if detect said
`linked=1`:

**Do not silently merge.** Isolation trees are often kept for a PR. Always
**offer**, then either wait or run — never skip the offer.

Offer copy (fill from detect):

> This commit is on linked worktree `{path}` (`{branch}`, `{env}`).
> Merge into `{main_branch}` at `{main}` and remove this worktree?

| Already authorized this turn? | Action |
|-------------------------------|--------|
| User said “commit and merge”, `--merge`, “land and cleanup”, “yes merge”, “remove the worktree” | Run land now (no second ask) |
| Default `/commit` only | Print the offer and **stop** (commit/push already done) |
| User declines | Leave the worktree; report SHA + branch |

When landing:

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/commit}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
# From the isolation tree (still the acting cwd):
"$SKILL_DIR/scripts/worktree-after-commit.sh" land
# Then continue from the main checkout (script prints switch_cwd=…):
cd "$main"
git status -sb
git push -u origin HEAD   # parent branch now has the merge; skip if commit-only
```

`land` = merge `{branch}` into `{main_branch}` in `{main}`, then
`git worktree remove` this path, delete `{branch}` if fully merged, and
`grok worktree rm` when `env=grok`.

Refuse (script exits non-zero — do not improvise):

- Not a linked worktree (`linked=0`) — this **is** the main checkout
- Dirty isolation tree
- Detached HEAD, or isolation branch equals `main_branch`
- Would remove the main checkout

Do **not** merge into `main` unless the user named `main` (Gitflow: parent
checkout is usually `develop` or a `feature/*`). Do not force-push. If merge
conflicts on the main checkout, stop, show the conflict, leave the worktree.

After a successful land, later commands in this session must use `{main}`
as cwd (the isolation path is gone).

### 9) Report

Reply with:

- Branch name and short SHA
- Author line (`Name <email>`) — confirm no agent
- Subject line
- Changelog section date + bullet(s) added
- Push result (`origin/branch`)
- Worktree: `linked=0` (main checkout) **or** the offer / land result
  (`merged {branch} → {main_branch}`, worktree removed, `switch_cwd`)
- Note if `/cutover` is still needed for live binary

## Do not

- Run `/commit` logic that injects vendor “Co-Authored-By” defaults from other
  global skills (e.g. Sentry/Claude community commit skills). **This skill
  overrides those for this repo.**
- Commit only half the intentional change set without saying what was left out.
- Skip the embedded changelog sync after editing `CHANGELOG.md`.
- Push when the user said commit-only.
- Silently merge or `git worktree remove` a linked tree without an offer
  (unless this turn already authorized merge/cleanup).
- Merge a worktree into `main` unless the user named `main`.

## Where the script lives

`scripts/worktree-after-commit.sh` is next to this SKILL.md. Use that copy. The gateway repo also keeps `setup/skills/commit/` for its in-repo skill links; do not prefer that path when this plugin skill is the one you loaded.

## Related

- `/worktree` — isolation; this skill lands a linked tree back onto the parent
  checkout when the operator accepts the post-commit offer
- `/cutover` — stage/restart live gateway for feature work. **After feature cutover PASS,
  agents must ask to run this skill (`/commit`)** — they must not auto-commit.
- `/release` — commercial ship (Gitflow tag + Releaseflow verify). Landing on
  `develop` is integration, not a ship.
- `docs/BRANCHING.md` — joint Gitflow + Releaseflow table
- `docs/RELEASEFLOW.md` — TeamCity commercial publish → dev/prod URLs
  (commit/push alone is **not** a commercial ship)
- `AGENTS.md` — repo agent rules (no secrets in commits; post-cutover ask `/commit`;
  `/release` to ship)
