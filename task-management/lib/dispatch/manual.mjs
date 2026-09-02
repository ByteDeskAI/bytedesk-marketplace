/**
 * The manual backend: always available, launches nothing.
 *
 * It is the floor of the fallback order for a reason — "here are the commands, run
 * them yourself" is what `tm parallel` and `tm worktree new` have always printed,
 * and it works on every host this plugin runs on. When no launcher exists, dispatch
 * must still succeed at handing the work over; it just hands it to a person.
 *
 * The worktree already exists by the time spawn() runs (dispatch provisions first),
 * so the commands start where the human's part starts: cd in, start a harness, give
 * it the handoff.
 */
import { config } from "../store.mjs";

export const name = "manual";

/** The floor never reports itself unavailable. */
export function available() {
  return true;
}

export function spawn({ worktree, prompt, p }) {
  const hint = config(p).dispatch?.tmuxCommand ?? ["claude", "-p", "--dangerously-skip-permissions"];
  const commands = [
    `cd ${worktree}`,
    `# start your agent harness (e.g. ${hint.join(" ")}) and give it the handoff below`,
    prompt,
  ];
  return { ok: true, detail: { commands, worktree, prompt } };
}
