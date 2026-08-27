# Codex handoff mechanics

Exact commands, flags, retrieval, and prompt framing. Read this before the first handoff
of a session. The behavioural contract — who decides what, and why — is in
`claude-codex-collaboration.md`; this file is only the mechanics.

Verified against codex-cli 0.146–0.147 on Linux and Windows. The commands run through a
**real local shell**, not a sandboxed one: Codex lives on the user's machine and needs its
own network access to reach its model.

## Preflight

Once per session, before any stage does work:

```bash
command -v codex && codex --version
```

Both must succeed. If `codex` is on `PATH` but unauthenticated, the first `codex exec`
returns an auth error rather than an artifact — treat that as a preflight failure too, and
report it as *sign in*, not *install*. There is no fallback; see the collaboration
reference for why the suite stops rather than continuing alone.

## The two invocation modes

Codex is used two ways across the suite, and they differ only in what comes back.

### Image mode

Codex has a **native image tool**, `image_gen.imagegen`. It runs off the user's normal
Codex sign-in — no `OPENAI_API_KEY`, no extra configuration. It is a first-class tool
rather than a shell script, which is why it keeps working even when Codex's own sandboxed
shell cannot spawn processes at all.

One consequence matters a great deal: **the tool ignores any output path you ask for.**
Telling Codex to save to `/path/to/hero.png` does nothing. Images always land in:

```
~/.codex/generated_images/<session-id>/exec-<uuid>.png
```

So retrieval is: capture the session id from Codex's own stdout, then read the folder.
Claude moves the files afterwards. Codex is never asked to.

### Text mode

For framings, palettes, copy, and HTML, Codex's reply *is* the artifact. Use `-o` to
capture it to a file and read that file. Nothing lands in `generated_images`; an empty
session folder is expected, not a failure.

## The command

Write the prompt to a file and pipe it in on stdin. Passing a long prompt as a
command-line argument means fighting three layers of quote escaping, and it will bite you
the moment a prompt contains an apostrophe.

```bash
codex exec --skip-git-repo-check -s read-only -C <run-dir> -o <run-dir>/<name>-reply.txt - \
  < <run-dir>/prompts/<name>.txt > <run-dir>/<name>-log.txt 2>&1
```

**Give `-o` an absolute path.** It resolves against the shell that invoked Codex, *not*
against `-C`. A relative `-o name-reply.txt` with a `-C` elsewhere writes the reply beside
your shell's cwd, or nowhere you look — a run hit this and lost five reply files while the
images landed fine, so nothing appeared broken until someone went looking for the sentinel.
The same applies to the input redirect and the log.

Why each flag:

- `-s read-only` — Codex needs no filesystem access to produce an artifact, and denying it
  avoids a Windows sandbox bug where `workspace-write` breaks child-process spawning
  entirely (`CreateProcessAsUserW failed: 5`). Read-only is both safer and, here, more
  reliable.
- `--skip-git-repo-check` — the run folder usually isn't a git repo.
- `-C <run-dir>` — sets the working root. Harmless under read-only, keeps logs tidy.
- `-o <file>` — writes Codex's final text reply to a file. In text mode this is the
  artifact; in image mode it is how you confirm it rendered rather than talked.
- `-` — read the prompt from stdin.
- redirect to a log file — the full transcript, which you need when something fails.

Allow **120–300 seconds** per invocation. Set a generous timeout and read the process
output afterwards rather than assuming a fast return.

### Windows equivalent

```bat
cmd /c "cd /d <run-dir> && type prompts\<name>.txt | codex exec --skip-git-repo-check -s read-only -C <run-dir> -o <name>-reply.txt - > <name>-log.txt 2>&1"
```

## Retrieving images

1. Pull the session id out of the log:

   ```bash
   grep -i "session id" <run-dir>/<name>-log.txt
   ```

   The line reads `session id: 01a03e28-64fb-7572-8d86-8e4fd0244139`.

2. List that session's image folder:

   ```bash
   ls -1 ~/.codex/generated_images/<session-id>
   ```

3. **Read each PNG so it enters context as an image**, then move it into the run folder
   under a meaningful name (`direction/images/r1-a.png`). Step 3 is not optional and not
   reorderable — an artifact filed without being viewed is the failure this suite exists
   to prevent.

If the session folder doesn't exist, Codex never called the tool — read the log rather
than guessing. If you lose the session id, the newest folder by mtime is a workable
fallback (`ls -1dt ~/.codex/generated_images/*/ | head -1`), but parsing the log is exact
and should be preferred.

## Prompt shape — Codex as hands

Codex is an agent, not a rendering endpoint, so the art direction needs a small amount of
framing around it to stop it being helpful in unwanted ways:

```
Generate exactly one image with your native image generation tool.
Do not run any shell commands. Do not read or write any files.

IMAGE PROMPT:
<the art direction, verbatim>

When the image is done, reply with exactly one line: DONE
```

The prohibitions matter. Left to itself Codex will try to read a template file or copy the
result to where you asked, and under `read-only` those attempts fail, cost a minute, and
sometimes derail it into troubleshooting instead of producing.

**One artifact per invocation.** Asking for three variants in one call gives unreliable
results and makes it impossible to map an artifact back to the prompt that produced it.
Run three invocations; they can go back to back.

The text-mode equivalent drops the tool instruction and names the output shape instead:

```
Do not run any shell commands. Do not read or write any files.
Reply with the artifact only — no preamble, no explanation, no code fences.

TASK:
<the brief-derived instruction>
```

## Prompt shape — Codex as blind critic

The review stage hands over the artifact **without the brief**. Attaching intent defeats
the entire mechanism: an eye that has read "markers on tracks" sees markers on tracks.

```
Do not run any shell commands. Do not read or write any files.

You are looking at this image cold. You have not been told what it is for.

1. In one sentence, what does this depict?
2. List every element you can identify. Name anything that reads as a user
   interface control, a chart, a logo, a word, or a number.
3. What is the single most visually dominant element?
4. Name the two or three colours you actually see, as plain names.
5. Do you see any of these, and where: a small uppercase letter-spaced label
   above a heading; a fully rounded pill shape; a frosted or blurred glass
   panel; a gradient used as a background or a border; a grid of three or four
   metric tiles; a chart with no readable data in it; a coloured status dot.

Answer only these five questions.
```

Question 5 is a fixed checklist of generation habits rather than a judgement, which is why
it survives being asked cold: a reader who has never seen the brief can still answer *is
there an uppercase letter-spaced label above that heading*. It is the same list the surface
stage bans by name, asked from the other side — the stage that built the thing is the worst
placed to notice it did.

Attach the artifact with `-i`. Its answers are **evidence, not verdicts** — Claude
reconciles them against the brief and decides.

## Reference images

`codex exec` accepts image attachments, repeatable:

```bash
codex exec --skip-git-repo-check -s read-only -i /path/to/reference.png \
  -C <run-dir> -o <run-dir>/r2-a-reply.txt - < <run-dir>/prompts/r2-a.txt > <run-dir>/r2-a-log.txt 2>&1
```

Use this for "match this look", for iterating on an image the user already has, for
edit-style work, and for the blind critic above. Say in the prompt what the attachment is
for — "the attached image is the current version; keep its composition and palette, change
only the background" — because otherwise Codex has to guess whether it is a reference, a
subject, or something to critique.

## Prompt template libraries

Some installs ship structured prompt templates (the `gpt-image-2` category libraries are
one such set). Where they exist, **Claude reads them directly from the filesystem** — do
not ask Codex to load them, since under `read-only` it cannot, and Claude applying a
template with judgement beats Codex applying it mechanically.

Treat a template as a checklist of fields the model wants filled, not as text to copy. Its
value is reminding you which decisions to make. If nothing matches the job, write the
prompt from scratch — forcing a template onto a job it doesn't fit produces worse output
than not using one.

## Log noise that is not a problem

These appear in normal successful runs:

- `failed to load models cache: missing field supports_parallel_tool_calls`
- `warning: Skill descriptions were shortened to fit the skills context budget`
- `warning: clamping SessionEnd hook timeout`
- `hook: SessionStart` / `hook: Stop` lines
- `[ERROR] - (starship::print): Under a 'dumb' terminal`

What is a real failure: no `session id` line; no folder under `generated_images` in image
mode; or a reply file containing prose where you specified a sentinel.

## Known model behaviour worth not fighting

**A mid-tone blue accent gets pulled to a saturated primary.** Verified over two rounds:
the hex, a named description, a positional anchor, two explicit negative hexes and a
metaphor were supplied *simultaneously* and the render still returned a pure saturated
blue — while every other instruction in the same prompt was honoured exactly. It is a
colour-specific prior, not a prompt failure.

It is **not universal**, which is what makes it actionable: saturated and distinctly-hued
accents (orange, cyan, pink) land close enough to read correctly in the same session. The
failure concentrates on **muted, low-chroma hues** — first observed on a mid-tone blue, and
since reproduced on a muted sage, which rules out the hue and implicates the saturation.
Anything sitting between a grey and a vivid colour is where the model's "glowing accent on a
dark ground" prior takes over.

So: don't spend a round on it. Treat the raster as mood, never as a colour reference. If
an accurate plate is needed, composite — take the render's luminance and drive the hue
from the token. Under a governed authority this matters twice over, because a teammate who
eyedroppers a generated PNG gets the wrong number.

**Marks land on white grounds regardless of instruction.** Five consecutive renders put a
mark on white despite explicit hexes, explicit negatives, and four restatements. You
cannot prompt your way out of it. This is why the identity stage generates to think and
redraws as SVG to deliver.

**Long text in an image is garbled.** Cut to a few words, or omit it and composite the
type afterwards.
