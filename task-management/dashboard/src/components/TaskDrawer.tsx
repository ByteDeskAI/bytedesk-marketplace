import { useEffect, useState } from "react";
import Button from "@atlaskit/button/new";
import Checkbox from "@atlaskit/checkbox";
import { cssMap } from "@atlaskit/css";
import Drawer from "@atlaskit/drawer";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import Select from "@atlaskit/select";
import Tag from "@atlaskit/tag";
import Textfield from "@atlaskit/textfield";
import TextArea from "@atlaskit/textarea";
import Tooltip from "@atlaskit/tooltip";
import { fetchTask, write } from "../api";
import { Markdown } from "./Markdown";
import { ActorBadge } from "./ActorBadge";
import type { Priority, Task } from "../types";

const STATUSES: Task["status"][] = [
  "open",
  "in_progress",
  "blocked",
  "parked",
  "done",
];
const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];
const LINK_TYPES = [
  "blocks",
  "blocked by",
  "causes",
  "caused by",
  "duplicates",
  "duplicated by",
  "relates to",
];

const styles = cssMap({
  /**
   * The drawer is a grid, not a stack.
   *
   * It was one `Stack` inside a padded `Box`, so the panel had a fixed height and its content
   * simply overflowed it: measured at 1022px of content in an 812px panel, with the entire
   * COMMENTS section — every comment and the field to add one — stranded 210px below the fold and
   * unreachable. And because nothing inside the panel scrolled, a wheel over the drawer scrolled
   * the *board behind it*.
   *
   * `auto 1fr` gives the header its natural height and hands every remaining pixel to the body,
   * which is the row that scrolls. `minHeight: 0` on both is what makes that true: a grid item
   * defaults to `min-height: auto`, which refuses to shrink below its content, and an item that
   * cannot shrink cannot overflow — so without it the body grows and pushes the panel open again,
   * which is the bug restated.
   */
  shell: {
    display: "grid",
    gridTemplateRows: "auto 1fr",
    height: "100%",
    minHeight: "0",
    maxWidth: "620px",
  },
  /** Identity stays put: which task you are looking at is not something to scroll back for. */
  header: {
    paddingInline: "var(--ds-space-300)",
    paddingBlock: "var(--ds-space-200)",
    borderBlockEndWidth: "var(--ds-border-width)",
    borderBlockEndStyle: "solid",
    borderBlockEndColor: "var(--ds-border)",
    backgroundColor: "var(--ds-surface)",
  },
  /**
   * The one scrolling region.
   *
   * `overscrollBehavior: contain` is the fix for the reported symptom: without it, a wheel that
   * reaches the end of this region chains to the board underneath and scrolls that instead.
   */
  scroller: {
    overflowY: "auto",
    overscrollBehavior: "contain",
    minHeight: "0",
    paddingInline: "var(--ds-space-300)",
    paddingBlock: "var(--ds-space-200)",
  },
  /**
   * A section is a group, separated by a rule rather than by whitespace alone. Ten control groups
   * in one undifferentiated column is a wall; the eye needs somewhere to stop.
   */
  section: {
    paddingBlockStart: "var(--ds-space-200)",
    marginBlockStart: "var(--ds-space-100)",
    borderBlockStartWidth: "var(--ds-border-width)",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: "var(--ds-border)",
  },
  /**
   * The first section needs no rule — the header already drew one. A COMPLETE style rather than an
   * override, because `Box`'s `xcss` refuses an array with a possibly-false element (stricter than
   * the plain `css` prop TaskCard uses), so the two variants have to be two whole styles.
   */
  firstSection: {
    paddingBlockStart: "var(--ds-space-100)",
    marginBlockStart: "0",
  },
  title: { font: "var(--ds-font-heading-small)" },
  grow: { flexGrow: 1 },
});

type Opt = { label: string; value: string };
const opts = (values: readonly string[]): Opt[] =>
  values.map((v) => ({ label: v, value: v }));
const current = (v?: string | null): Opt | null =>
  v ? { label: v, value: v } : null;

/**
 * One group of related controls.
 *
 * The drawer was ten control groups in a single undifferentiated column with two all-caps `Text`
 * blobs doing the work of headings. Naming the pattern once means every group is separated the
 * same way and a reader can skip to the one they want instead of scanning the lot.
 */
function Section({
  title,
  first = false,
  children,
}: {
  title: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box xcss={first ? styles.firstSection : styles.section}>
      <Stack space="space.100">
        <Text weight="bold" size="small" color="color.text.subtlest">
          {title}
        </Text>
        {children}
      </Stack>
    </Box>
  );
}

/** Every field on one card. Each control is one call to the write API — no local model. */
export function TaskDrawer({
  task,
  tasks,
  onClose,
  run,
}: {
  task: Task | null;
  tasks: Task[];
  onClose: () => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [label, setLabel] = useState("");
  const [criterion, setCriterion] = useState("");
  const [linkType, setLinkType] = useState<string>(LINK_TYPES[0]);

  const [detail, setDetail] = useState<Task | null>(null);

  useEffect(() => setTitle(task?.title ?? ""), [task?.id, task?.title]);
  // The board payload strips `body`, so the record has to be fetched when the drawer opens. Kept
  // separate from `task` rather than merged: the board stays the live source for everything it
  // does carry, and a failed fetch degrades to "no body shown" instead of blanking the drawer.
  useEffect(() => {
    if (!task?.id) return setDetail(null);
    let live = true;
    void fetchTask(task.id)
      .then((full) => live && setDetail(full))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [task?.id]);

  if (!task) return null;

  const act = (action: string, payload: Record<string, unknown>) =>
    run(() => write.act(task.id, action, payload));
  const others = tasks.filter((t) => t.id !== task.id);

  return (
    <Drawer isOpen onClose={onClose} label={task.id} width="wide">
      <Box xcss={styles.shell}>
        {/* Row 1: who this is. Outside the scroller on purpose — the id and title are the answer to
            "what am I looking at", and scrolling to re-read them is a tax on every long task. */}
        <Box xcss={styles.header}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center">
              <Text weight="bold">{task.id}</Text>
              <Lozenge
                appearance={task.status === "done" ? "success" : "inprogress"}
              >
                {task.status}
              </Lozenge>
              <ActorBadge actor={task.actor} />
              {task.epic ? (
                <Lozenge appearance="new">{task.epic}</Lozenge>
              ) : null}
            </Inline>
            <Inline space="space.100" alignBlock="end">
              <Box xcss={styles.grow}>
                <Textfield
                  value={title}
                  onChange={(e) =>
                    setTitle((e.target as HTMLInputElement).value)
                  }
                />
              </Box>
              <Button
                isDisabled={!title.trim() || title === task.title}
                onClick={() => run(() => write.edit(task.id, { title }))}
              >
                Rename
              </Button>
            </Inline>
          </Stack>
        </Box>

        {/* Row 2: everything else, and the only thing that scrolls. */}
        <Box xcss={styles.scroller}>
          <Stack space="space.150">
            {detail?.body?.trim() ? (
              <Box xcss={styles.section}>
                <Stack space="space.050">
                  <Text weight="bold" size="small" color="color.text.subtlest">
                    CONTEXT
                  </Text>
                  <Markdown source={detail.body} />
                </Stack>
              </Box>
            ) : null}

            {detail?.goalDoc ? (
              <Text
                size="small"
                color="color.text.subtlest"
              >{`goal: ${detail.goalDoc}`}</Text>
            ) : null}

            <Inline space="space.100" shouldWrap>
              <Select<Opt>
                spacing="compact"
                placeholder="status"
                options={opts(STATUSES)}
                value={current(task.status)}
                onChange={(o) => o && act("transition", { status: o.value })}
              />
              <Select<Opt>
                spacing="compact"
                isClearable
                placeholder="priority"
                options={opts(PRIORITIES)}
                value={current(task.priority)}
                onChange={(o) =>
                  act("priority", { priority: o?.value ?? null })
                }
              />
              <Select<Opt>
                spacing="compact"
                isClearable
                placeholder="parent"
                options={opts(others.map((t) => t.id))}
                value={current(task.parent)}
                onChange={(o) => act("subtask", { parent: o?.value ?? null })}
              />
            </Inline>

            <Inline space="space.100" alignBlock="end" shouldWrap>
              <Textfield
                isCompact
                placeholder="assignee"
                defaultValue={task.assignee ?? ""}
                onBlur={(e) => {
                  const who = (e.target as HTMLInputElement).value.trim();
                  if (who !== (task.assignee ?? ""))
                    act("assign", { assignee: who || null });
                }}
              />
              <Textfield
                isCompact
                type="number"
                placeholder="estimate"
                defaultValue={task.estimate ?? ""}
                onBlur={(e) => {
                  const raw = (e.target as HTMLInputElement).value;
                  if (raw !== String(task.estimate ?? ""))
                    act("estimate", { estimate: Number(raw) || 0 });
                }}
              />
            </Inline>

            <Section title="LABELS" first>
              <Inline space="space.050" shouldWrap>
                {(task.labels ?? []).map((l) => (
                  <Tag
                    key={l}
                    text={l}
                    removeButtonLabel={`remove ${l}`}
                    onAfterRemoveAction={() => act("labels", { remove: [l] })}
                  />
                ))}
              </Inline>
              <Inline space="space.100" alignBlock="end">
                <Textfield
                  isCompact
                  placeholder="add a label"
                  value={label}
                  onChange={(e) =>
                    setLabel((e.target as HTMLInputElement).value)
                  }
                />
                <Button
                  isDisabled={!label.trim()}
                  onClick={() => {
                    act("labels", { add: [label.trim()] });
                    setLabel("");
                  }}
                >
                  Add
                </Button>
              </Inline>
            </Section>

            <Section title="ACCEPTANCE CRITERIA">
              {/* The box toggles. It used to set isDisabled once checked, so a stray click
                  permanently changed what `tm done` would accept and the only way back was
                  editing the markdown by hand — which is exactly how this got reported. */}
              {(task.acceptance ?? []).map((a, i) => (
                <Inline
                  key={`${a.text}-${i}`}
                  space="space.050"
                  alignBlock="center"
                  spread="space-between"
                >
                  <Checkbox
                    isChecked={Boolean(a.done)}
                    label={a.text}
                    onChange={() =>
                      act("accept", { index: i + 1, done: !a.done })
                    }
                  />
                  <Tooltip content="remove this criterion — renumbers the ones after it">
                    <Button
                      appearance="subtle"
                      spacing="compact"
                      onClick={() =>
                        act("accept", { index: i + 1, remove: true })
                      }
                    >
                      ✕
                    </Button>
                  </Tooltip>
                </Inline>
              ))}
              <Inline space="space.100" alignBlock="end">
                <Textfield
                  isCompact
                  placeholder="add a criterion"
                  value={criterion}
                  onChange={(e) =>
                    setCriterion((e.target as HTMLInputElement).value)
                  }
                />
                <Button
                  isDisabled={!criterion.trim()}
                  onClick={() => {
                    act("ac", { text: criterion.trim() });
                    setCriterion("");
                  }}
                >
                  Add
                </Button>
              </Inline>
            </Section>

            <Section title="BLOCKED BY">
              {/* A blocked card is the only kind that needs the board to tell it something, and
                  it was the one the board said least about: `⊘ TM-002` and no way to change it. */}
              {(task.blockedBy ?? []).length ? (
                <Inline space="space.050" shouldWrap>
                  {(task.blockedBy ?? []).map((d) => (
                    <Tag
                      key={d}
                      text={d}
                      color="redLight"
                      removeButtonLabel={`stop waiting on ${d}`}
                      onAfterRemoveAction={() => act("dep", { remove: [d] })}
                    />
                  ))}
                </Inline>
              ) : (
                <Text size="small" color="color.text.subtlest">
                  nothing is blocking this
                </Text>
              )}
              <Select<Opt>
                spacing="compact"
                placeholder="add a blocker"
                options={opts(others.map((t) => t.id))}
                value={null}
                onChange={(o) => o && act("dep", { add: [o.value] })}
              />
            </Section>

            <Section title="LINKS">
              {(task.links ?? []).map((l) => (
                <Text
                  key={`${l.type}-${l.id}`}
                  size="small"
                >{`${l.type} → ${l.id}`}</Text>
              ))}
              <Inline space="space.100" alignBlock="end">
                <Select<Opt>
                  spacing="compact"
                  options={opts(LINK_TYPES)}
                  value={current(linkType)}
                  onChange={(o) => o && setLinkType(o.value)}
                />
                <Select<Opt>
                  spacing="compact"
                  placeholder="task"
                  options={opts(others.map((t) => t.id))}
                  value={null}
                  onChange={(o) =>
                    o && act("link", { type: linkType, to: o.value })
                  }
                />
              </Inline>
            </Section>

            <Section title="COMMENTS">
              {(task.comments ?? []).map((c, i) => (
                <Text
                  key={`${c.ts}-${i}`}
                  size="small"
                >{`${c.author ?? "?"} · ${c.ts?.slice(0, 16).replace("T", " ")} — ${c.text}`}</Text>
              ))}
              <TextArea
                placeholder="Add a comment"
                value={comment}
                minimumRows={2}
                onChange={(e) =>
                  setComment((e.target as HTMLTextAreaElement).value)
                }
              />
              <Inline>
                <Button
                  isDisabled={!comment.trim()}
                  onClick={() => {
                    act("comment", { text: comment.trim() });
                    setComment("");
                  }}
                >
                  Comment
                </Button>
              </Inline>
            </Section>
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
}
