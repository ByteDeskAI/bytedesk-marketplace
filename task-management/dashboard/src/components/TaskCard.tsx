import type { DragEvent } from "react";
import { useChanged } from "../motion";
import { Bump } from "./Bump";
import Badge from "@atlaskit/badge";
import Checkbox from "@atlaskit/checkbox";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import { SimpleTag } from "@atlaskit/tag";
import Tooltip from "@atlaskit/tooltip";
import { claim, cycleTime, elapsed, fmtDuration } from "../../metrics.mjs";
import { ActorBadge } from "./ActorBadge";
import type { Task } from "../types";
import { attentionOf, decisionRole } from "../../../lib/decision.mjs";

const STALE_MS = 90 * 60_000; // the store's default staleMinutes
const PRIORITY_TONE = {
  highest: "removed",
  high: "moved",
  medium: "default",
  low: "new",
  lowest: "new",
} as const;

const styles = cssMap({
  card: {
    backgroundColor: "var(--ds-surface-raised)",
    borderRadius: "var(--ds-radius-small)",
    boxShadow: "var(--ds-shadow-raised)",
    padding: "var(--ds-space-100)",
    cursor: "grab",
  },
  // The keyboard cursor. Drawn explicitly rather than relying on :focus-visible,
  // because j/k moves focus programmatically and some engines suppress the visible
  // ring for focus that no key triggered — an invisible cursor is the same as none.
  //
  // Additive: @compiled extracts statically, so `css={a ? x : y}` fails the build.
  // The array form is how you say "and also".
  focusable: {
    borderRadius: "var(--ds-radius-small)",
    outlineWidth: "0",
  },
  focused: {
    outlineColor: "var(--ds-border-focused)",
    outlineOffset: "var(--ds-space-025)",
    outlineStyle: "solid",
    outlineWidth: "var(--ds-border-width-focused)",
  },
  /**
   * A card whose session is writing right now.
   *
   * Driven by real writes, not by status: `in_progress` is also true of a card claimed four hours
   * ago, and pulsing that one says nothing. The animation stops when the writes stop, so an idle
   * board is still — see LIVE_WINDOW_MS in motion.ts.
   */
  working: {
    animationName: "tmPulse",
    animationDuration: "1.8s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    "@media (prefers-reduced-motion: reduce)": {
      // The information survives without the movement: a steady ring says the same thing.
      animationName: "none",
      outlineColor: "var(--ds-border-accent-blue)",
      outlineStyle: "solid",
      outlineWidth: "var(--ds-border-width-selected)",
    },
  },
  /** A card whose status just changed — one flash, then still. */
  changed: {
    animationName: "tmFlash",
    animationDuration: "900ms",
    animationTimingFunction: "ease-out",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  id: { fontFamily: "var(--ds-font-family-code)" },
  /**
   * The card's title is the way into the card, so it has to be a control.
   *
   * It was a `Box` — a plain `div` — with `cursor: pointer` and an onClick. It looked clickable and
   * was clickable with a mouse, and that was all: `Tab` never reached it, screen readers never
   * announced it, and automation could not find it. That last one is how it surfaced — agent-browser
   * could not click the title at all, because there was no interactive element there to click.
   *
   * `Pressable` is ADS's primitive for exactly this: a real `button` underneath, with the padding
   * and background reset so it still reads as a title rather than as a button.
   */
  title: {
    cursor: "pointer",
    backgroundColor: "transparent",
    borderWidth: "0",
    padding: "0",
    textAlign: "left",
    // No `font`/`color` overrides: cssMap only accepts design tokens, and the inner `Text` already
    // carries the card's type. Leaving them off keeps the button looking exactly like the div did.
    width: "100%",
  },
  watch: {
    backgroundColor: "transparent",
    borderWidth: "0",
    color: "var(--ds-text-subtlest)",
    cursor: "pointer",
    padding: "0",
  },
  /**
   * Why the card stopped.
   *
   * Prose, not a chip. Everything else on this card is an enumerable fact you scan — a priority,
   * an epic, a count — and a Lozenge is the right shape for those. A free-text sentence in a
   * Lozenge either truncates to uselessness or blows the badge row apart, so this gets its own
   * line and reads as a sentence.
   *
   * Subordinate on purpose: subtlest text, no background, no border, no icon tint. The status
   * mark and the column already say the card is stopped; this line only has to answer *why*, and
   * a callout box would make every blocked card shout.
   *
   * Bounded so one long reason cannot push the rest of the column off the screen. The clamp is on
   * the TEXT rather than the box: a CSS line-clamp needs `-webkit-box-orient`, which ADS's cssMap
   * allowlist rejects, and a character budget has the side benefit of matching what `.bytedesk/task-management/bin/tm board`
   * does — one rule, both surfaces. The full sentence is on hover either way.
   *
   * `overflowWrap` because a reason can contain a url or a long branch name with nothing to break
   * on, and one unbreakable token would otherwise widen the whole column.
   */
  reason: {
    color: "var(--ds-text-subtlest)",
    font: "var(--ds-font-body-small)",
    overflowWrap: "anywhere",
  },
});

/**
 * A few lines at a typical column width — checked in the browser, not guessed. See the `reason`
 * style for why the clamp is on the text rather than the box.
 */
const REASON_MAX = 120;

/**
 * The stored reason for a stop, or null. `.bytedesk/task-management/bin/tm park <id> <why>` and `.bytedesk/task-management/bin/tm block <id> <why>` have
 * always written one of these and no card ever read it.
 */
function stopReason(task: Task): string | null {
  const why =
    task.status === "blocked"
      ? task.blockedReason
      : task.status === "parked"
        ? task.parkedReason
        : null;
  const flat = (why ?? "").replace(/\s+/g, " ").trim();
  return flat || null;
}

export function TaskCard({
  task,
  starts,
  now,
  selected,
  onSelect,
  onOpen,
  onDropBefore,
  watched = false,
  onWatch,
  outbox,
  focused = false,
  working = false,
  onFocusCard,
}: {
  task: Task;
  starts: Map<string, number>;
  now: number;
  selected: boolean;
  onSelect: (id: string, on: boolean) => void;
  onOpen: (id: string) => void;
  onDropBefore: (dragged: string, before: string) => void;
  watched?: boolean;
  onWatch?: (id: string) => void;
  outbox?: { status: string; error?: string };
  /** The keyboard cursor is on this card. Roving tabindex — see useBoardKeys. */
  focused?: boolean;
  /** The claiming session wrote something in the last LIVE_WINDOW_MS — work is happening now. */
  working?: boolean;
  onFocusCard?: (id: string) => void;
}) {
  // One flash when this card's status moves — including a move made by another session or by the
  // CLI, which is the case you would otherwise never notice.
  const justChanged = useChanged(task.status);

  const ac = task.acceptance ?? [];
  const met = ac.filter((a) => a.done).length;
  const sat = elapsed(task, now);
  const cycle = cycleTime(task, starts);
  const held = claim(task);
  const reason = stopReason(task);

  return (
    // ponytail: native HTML5 drag on a plain div — ADS Box takes no drag props, and
    // a drag-and-drop library for one gesture is a dependency to maintain. Swap in
    // pragmatic-drag-and-drop if the board ever needs keyboard reordering.
    <div
      draggable
      // Reachable by Tab and by j/k, and announced as one thing rather than a pile
      // of badges: the visual card says "3/4" and "⊘ TM-002", which is nothing at all
      // to a screen reader.
      data-tm-card={task.id}
      role="listitem"
      tabIndex={focused ? 0 : -1}
      aria-current={focused || undefined}
      aria-label={[
        task.id,
        task.title,
        task.status.replace("_", " "),
        ac.length ? `${met} of ${ac.length} acceptance criteria met` : "",
        task.priority ? `${task.priority} priority` : "",
        task.assignee ? `assigned to ${task.assignee}` : "",
        (task.blockedBy ?? []).length
          ? `blocked by ${(task.blockedBy ?? []).join(", ")}`
          : "",
        selected ? "selected" : "",
      ]
        .filter(Boolean)
        .join(", ")}
      css={[styles.focusable, focused && styles.focused]}
      // Tab and j/k must agree on where the cursor is, or tabbing to a card and
      // pressing Enter does nothing.
      onFocus={() => onFocusCard?.(task.id)}
      onDragStart={(e: DragEvent) =>
        e.dataTransfer.setData("text/plain", task.id)
      }
      onDragOver={(e: DragEvent) => e.preventDefault()}
      onDrop={(e: DragEvent) => {
        // Dropping onto a card ranks the dragged one above it; the column handles
        // the rest of the drop area as a status change.
        const dragged = e.dataTransfer.getData("text/plain");
        if (!dragged || dragged === task.id) return;
        e.stopPropagation();
        e.preventDefault();
        onDropBefore(dragged, task.id);
      }}
    >
      {/* The animation sits on a wrapper: Box takes a single xcss value, while the css prop
          composes. Keeping the card's own styling untouched also keeps this reversible. */}
      <div css={[working && styles.working, justChanged && styles.changed]}>
      <Box xcss={styles.card}>
        <Stack space="space.075">
          <Inline space="space.075" alignBlock="center" spread="space-between">
            <Inline space="space.050" alignBlock="center">
              <Checkbox
                isChecked={selected}
                label=""
                onChange={(e) =>
                  onSelect(task.id, (e.target as HTMLInputElement).checked)
                }
              />
              <Box xcss={styles.id}>
                <Text size="small" color="color.text.subtlest">
                  {task.id}
                </Text>
              </Box>
              {/* Watching a card is what turns its blocks and stolen claims into
                notifications, so the switch belongs on the card, not in a menu. */}
              {onWatch ? (
                <Tooltip
                  content={
                    watched
                      ? "stop watching"
                      : "watch: notify me if this is blocked or taken"
                  }
                >
                  <button
                    type="button"
                    css={styles.watch}
                    aria-pressed={watched}
                    aria-label={`${watched ? "stop watching" : "watch"} ${task.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onWatch(task.id);
                    }}
                  >
                    {watched ? "★" : "☆"}
                  </button>
                </Tooltip>
              ) : null}
            </Inline>
            {cycle !== null ? (
              <Tooltip content="cycle time: first start → done">
                <Text
                  size="small"
                  color="color.text.success"
                >{`✓ ${fmtDuration(cycle)}`}</Text>
              </Tooltip>
            ) : sat !== null ? (
              <Tooltip
                content={`in ${task.status.replace("_", " ")} for ${fmtDuration(sat)}`}
              >
                <Text
                  size="small"
                  color={
                    task.status === "in_progress" && sat > STALE_MS
                      ? "color.text.warning"
                      : "color.text.subtlest"
                  }
                >
                  {fmtDuration(sat)}
                </Text>
              </Tooltip>
            ) : null}
          </Inline>

          <Pressable
            xcss={styles.title}
            onClick={() => onOpen(task.id)}
            aria-label={`Open ${task.id}: ${task.title}`}
          >
            <Text>{task.title}</Text>
          </Pressable>

          <Inline space="space.050" alignBlock="center" shouldWrap>
            {/* A write the server has not accepted yet, or one it refused. Either
              way the card is not saying what the store says. */}
            {outbox?.status === "failed" ? (
              <Tooltip
                content={outbox.error ?? "the server refused this write"}
              >
                <Lozenge appearance="removed">refused</Lozenge>
              </Tooltip>
            ) : outbox ? (
              <Tooltip content="queued while the server is unreachable — replays on reconnect">
                <Lozenge appearance="moved">queued</Lozenge>
              </Tooltip>
            ) : null}
            {task.priority ? (
              <Lozenge appearance={PRIORITY_TONE[task.priority]}>
                {task.priority}
              </Lozenge>
            ) : null}
            {task.epic ? <Lozenge appearance="new">{task.epic}</Lozenge> : null}
            {task.parent ? <Lozenge>{`↳ ${task.parent}`}</Lozenge> : null}
            {task.assignee ? (
              <SimpleTag color="tealLight" text={`@${task.assignee}`} />
            ) : null}
            {typeof task.estimate === "number" ? (
              <Badge>{`${task.estimate} pts`}</Badge>
            ) : null}
            {ac.length ? (
              <Tooltip content="acceptance criteria met">
                <Bump on={met}>
                  <Badge
                    appearance={met === ac.length ? "added" : "default"}
                  >{`${met}/${ac.length}`}</Badge>
                </Bump>
              </Tooltip>
            ) : null}
            {(() => {
              const role = decisionRole(task.labels);
              const attn = attentionOf(role);
              return (
                <>
                  {role ? (
                    <Lozenge appearance="inprogress">{role.slice("decision:".length)}</Lozenge>
                  ) : null}
                  {attn ? (
                    <Tooltip content={attn === "HITL" ? "needs a human" : "safe to run AFK"}>
                      <Lozenge appearance={attn === "HITL" ? "moved" : "new"}>{attn}</Lozenge>
                    </Tooltip>
                  ) : null}
                  {role && !task.hasAnswer && task.status !== "done" ? (
                    <Lozenge appearance="removed">needs answer</Lozenge>
                  ) : null}
                </>
              );
            })()}
            {(task.labels ?? [])
              .filter((l) => !l.startsWith("decision:"))
              .map((l) =>
                ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"].includes(l) ? (
                  <Lozenge key={l} appearance="moved">
                    {l}
                  </Lozenge>
                ) : (
                  <SimpleTag key={l} text={l} />
                ),
              )}
            {(task.blockedBy ?? []).length ? (
              <Tooltip
                content={`waiting on ${(task.blockedBy ?? []).join(", ")} — open the card to change it`}
              >
                <Lozenge appearance="removed">{`⊘ ${(task.blockedBy ?? []).join(", ")}`}</Lozenge>
              </Tooltip>
            ) : null}
            {(task.links ?? []).length ? (
              <Badge>{`🔗 ${task.links!.length}`}</Badge>
            ) : null}
            {(task.comments ?? []).length ? (
              <Badge>{`💬 ${task.comments!.length}`}</Badge>
            ) : null}
            {(task.evidence ?? []).length ? (
              <Badge>{`📎 ${task.evidence!.length}`}</Badge>
            ) : null}
            {(task.commits ?? []).length ? (
              <Badge>{`⑂ ${task.commits!.length}`}</Badge>
            ) : null}
          </Inline>

          {/* Why it stopped. Directly under the badges and above the actor row: it explains the
            column this card is sitting in, so it belongs with the card's state rather than with
            who is holding it. */}
          {reason ? (
            <Tooltip content={reason}>
              <Box xcss={styles.reason}>
                {reason.length > REASON_MAX
                  ? `${reason.slice(0, REASON_MAX - 1)}…`
                  : reason}
              </Box>
            </Tooltip>
          ) : null}

          {/* Which thread is executing this. With several agents on one board the
            status alone doesn't say who is holding the work. */}
          {task.actor || held ? (
            <Inline space="space.050" alignBlock="center" shouldWrap>
              <ActorBadge actor={task.actor} />
              {held?.branch ? (
                <Tooltip content="branch holding this card">
                  <SimpleTag color="blueLight" text={`⑂ ${held.branch}`} />
                </Tooltip>
              ) : null}
              {held?.worktree ? (
                <Tooltip content={`worktree: ${task.worktree}`}>
                  <SimpleTag color="purpleLight" text={`▣ ${held.worktree}`} />
                </Tooltip>
              ) : null}
            </Inline>
          ) : null}
        </Stack>
      </Box>
      </div>
    </div>
  );
}
