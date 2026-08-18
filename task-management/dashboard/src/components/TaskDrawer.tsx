import { useEffect, useState } from "react";
import Button, { IconButton } from "@atlaskit/button/new";
import Checkbox from "@atlaskit/checkbox";
import CrossIcon from "@atlaskit/icon/core/cross";
import InlineEdit from "@atlaskit/inline-edit";
import { cssMap } from "@atlaskit/css";
import Drawer from "@atlaskit/drawer";
import { Boundary } from "./Boundary";
import { WorkStream } from "./WorkStream";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import Select from "@atlaskit/select";
import Tag from "@atlaskit/tag";
import Textfield from "@atlaskit/textfield";
import TextArea from "@atlaskit/textarea";
import Tooltip from "@atlaskit/tooltip";
import { attachEvidenceFile, fetchEvidence, fetchTask, stopReason, write } from "../api";
import { Markdown } from "./Markdown";
import { ActorBadge } from "./ActorBadge";
import { TYPES, typeOf } from "../types";
import type { Adr, Epic, EvidenceItem, Priority, Sprint, Task } from "../types";

const STATUSES: Task["status"][] = [
  "backlog",
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
  /**
   * Drawer body + work stream, side by side. With no stream the split has one child and the
   * shell's own maxWidth keeps the drawer exactly as wide as it was.
   */
  split: {
    display: "flex",
    gap: "var(--ds-space-150)",
    height: "100%",
    minHeight: "0",
    paddingInlineEnd: "var(--ds-space-150)",
  },
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
  /** A rule between entries, so where one comment ends is answerable at a glance. */
  comment: {
    paddingBlockStart: "var(--ds-space-100)",
    borderBlockStartWidth: "var(--ds-border-width)",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: "var(--ds-border)",
  },
  /** The first needs no rule — the section heading already drew the boundary. */
  firstComment: { paddingBlockStart: "0" },
  /** Matches the height an input would occupy, so the row does not jump on click. */
  readView: { paddingBlock: "var(--ds-space-075)", wordBreak: "break-word" },
  evidenceRef: { wordBreak: "break-all" },
  id: { fontFamily: "var(--ds-font-family-code)" },
  decision: {
    cursor: "pointer",
    backgroundColor: "transparent",
    borderWidth: "0",
    padding: "0",
    textAlign: "left",
    width: "100%",
  },
});

const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

function fallbackEvidence(refs: string[]): EvidenceItem[] {
  return refs.map((ref) => {
    if (/^https?:\/\//i.test(ref)) {
      return { ref, kind: "url" as const, name: ref, exists: true, previewable: false };
    }
    if (URI_SCHEME.test(ref)) {
      return { ref, kind: "uri" as const, name: ref, exists: true, previewable: false };
    }
    const name = ref.split("/").pop() || ref;
    return { ref, kind: "file" as const, name, exists: true, previewable: false };
  });
}

function fileHref(id: string, ref: string) {
  return `/api/task/${encodeURIComponent(id)}/file?ref=${encodeURIComponent(ref)}`;
}

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

/**
 * A field that reads as text and becomes an input when you click it.
 *
 * Built on ADS's lower-level `InlineEdit` rather than its `InlineEditableTextfield` convenience
 * wrapper for one reason: the wrapper does not expose `onEdit`, and without knowing when a field is
 * open the drawer cannot tell whether Escape meant "cancel this edit" or "close the panel".
 *
 * That mattered. `Drawer` closes on Escape and `InlineEdit` cancels on Escape, and the drawer won —
 * click a title, type, press Escape to back out, and the whole panel went. Verified in a browser:
 * after one Escape the document had zero `[role=dialog]`.
 *
 * Two fixes that did NOT work, both found by trying rather than by reasoning:
 *
 *   - A React `onKeyDown` with `stopPropagation`. React delegates from the root, so stopping a
 *     synthetic event never reaches the native listener the drawer has already attached.
 *   - Inspecting `document.activeElement` inside `onClose`. By then InlineEdit has cancelled and
 *     moved focus back to its own read-view button, so the check sees a BUTTON and lets it through.
 *
 * So the state is reported, not inferred.
 */
function InlineField({
  value,
  label,
  editLabel,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  editLabel: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const open = (next: boolean) => setEditing(next);

  /**
   * Escape belongs to the open field, and it takes a capture listener to say so.
   *
   * Whatever closes the drawer listens at document-bubble or window, so nothing inside the tree can
   * stop it — measured, after three fixes that did not work: a React `onKeyDown` with
   * `stopPropagation` (React delegates from the root, so it never reaches a native document
   * listener), an `activeElement` check in `onClose` (InlineEdit has already moved focus back to
   * its read-view button by then), and a counter of open fields (`onCancel` zeroes it before
   * `onClose` asks). A capture listener on `document` was then verified in the browser to stop the
   * close outright.
   *
   * Swallowing it here also denies InlineEdit its own Escape handler, so the cancel happens
   * explicitly — `isEditing` is controlled, so dropping back to the read view without confirming
   * IS the cancel.
   */
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      open(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  return (
    <InlineEdit
      defaultValue={value}
      label={label}
      editButtonLabel={editLabel}
      readViewFitContainerWidth
      isEditing={editing}
      onEdit={() => open(true)}
      onCancel={() => open(false)}
      onConfirm={(next: string) => {
        open(false);
        onCommit(next);
      }}
      editView={({ errorMessage, ...fieldProps }) => (
        <Textfield {...fieldProps} autoFocus />
      )}
      readView={() => (
        <Box xcss={styles.readView}>
          <Text color={value ? "color.text" : "color.text.subtlest"}>
            {value || placeholder}
          </Text>
        </Box>
      )}
    />
  );
}

function InlineArea({
  value,
  label,
  editLabel,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  editLabel: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const open = (next: boolean) => setEditing(next);

  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      open(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  return (
    <InlineEdit
      defaultValue={value}
      label={label}
      editButtonLabel={editLabel}
      readViewFitContainerWidth
      keepEditViewOpenOnBlur
      isEditing={editing}
      onEdit={() => open(true)}
      onCancel={() => open(false)}
      onConfirm={(next: string) => {
        open(false);
        onCommit(next);
      }}
      editView={({ errorMessage, onChange, ...fieldProps }) => (
        <TextArea
          {...fieldProps}
          minimumRows={6}
          autoFocus
          onChange={(e) =>
            onChange((e.target as HTMLTextAreaElement).value)
          }
        />
      )}
      readView={() => (
        <Box xcss={styles.readView}>
          {value.trim() ? (
            <Markdown source={value} />
          ) : (
            <Text color="color.text.subtlest">{placeholder}</Text>
          )}
        </Box>
      )}
    />
  );
}

/** Every field on one card. Each control is one call to the write API — no local model. */
function decisionsFor(task: Task, adrs: Adr[]): Adr[] {
  const byId = new Map(adrs.map((a) => [a.id, a]));
  const ids = new Set<string>();
  for (const link of task.links ?? []) {
    if (link.id.startsWith("ADR-")) ids.add(link.id);
  }
  if (task.epic) {
    for (const a of adrs) {
      if (a.epic === task.epic) ids.add(a.id);
    }
  }
  return [...ids].map((id) => byId.get(id) ?? { id, title: id, status: "" });
}

export function TaskDrawer({
  task,
  tasks,
  epics = [],
  adrs = [],
  sprints = [],
  onClose,
  onOpen,
  run,
}: {
  task: Task | null;
  tasks: Task[];
  epics?: Epic[];
  adrs?: Adr[];
  sprints?: Sprint[];
  onClose: () => void;
  onOpen?: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [comment, setComment] = useState("");
  const [label, setLabel] = useState("");
  const [criterion, setCriterion] = useState("");
  const [note, setNote] = useState("");
  const [linkType, setLinkType] = useState<string>(LINK_TYPES[0]);

  const [detail, setDetail] = useState<Task | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[] | null>(null);

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
  }, [task?.id, task?.updated]);

  const evidenceKey = (task?.evidence ?? []).join("\0");
  useEffect(() => {
    if (!task?.id) return setEvidence(null);
    let live = true;
    void fetchEvidence(task.id)
      .then((res) => live && setEvidence(res.evidence ?? []))
      .catch(() => live && setEvidence(null));
    return () => {
      live = false;
    };
  }, [task?.id, evidenceKey]);

  if (!task) return null;

  const act = (action: string, payload: Record<string, unknown>) =>
    run(() => write.act(task.id, action, payload));
  const others = tasks.filter((t) => t.id !== task.id);
  const epicOf = (id: string | null | undefined) =>
    epics.find((e) => e.id === id);

  /**
   * Only work that is actually running has a stream worth watching, and a full-width drawer over
   * a task nobody is on is just a bigger drawer. The width is the panel's tell: wide when it is
   * fields, full when there is a run beside them.
   */
  const live = task.status === "in_progress";

  return (
    <Drawer isOpen label={task.id} width={live ? "full" : "wide"} onClose={onClose}>
      <Box xcss={styles.split}>
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
            {/*
              The title reads as a title and becomes a field when you click it.

              It was a permanently-open single-line `Textfield` beside a Rename button, so the most
              important thing on the panel was a form control — and on a long title the browser
              scrolled that input to its END, leaving the header reading
              "…ntity, captured from /goal the way plans are captured from ExitPlanMode".
              Measured: 605px of text in a 467px box. You could not read which task you had open.

              ADS's own inline edit rather than a hand-rolled toggle: it brings a real focusable
              button as the read view, confirm/cancel affordances, Enter and Escape handling, and
              `label`/`editButtonLabel`, so a control that had no accessible name now has one.
            */}
            <InlineField
              value={task.title}
              label="Title"
              editLabel={`Edit the title of ${task.id}`}
              placeholder="Give this task a title"
              onCommit={(next) => {
                const value = next.trim();
                // `tm edit` treats re-submitting the stored value as a no-op; do not spend a
                // write to find that out.
                if (value && value !== task.title) {
                  run(() => write.edit(task.id, { title: value }));
                }
              }}
            />
          </Stack>
        </Box>

        {/* Row 2: everything else, and the only thing that scrolls. */}
        <Box xcss={styles.scroller}>
          <Stack space="space.150">
            <Box xcss={styles.section}>
              <InlineArea
                key={`${task.id}-${detail ? "full" : "pending"}`}
                value={detail?.body ?? ""}
                label="Context"
                editLabel={`Edit the body of ${task.id}`}
                placeholder="Add context (markdown)"
                onCommit={(next) => {
                  if (next.trim() !== (detail?.body ?? "").trim()) {
                    run(() => write.edit(task.id, { body: next }));
                    setDetail((d) => (d ? { ...d, body: next } : { ...task, body: next }));
                  }
                }}
              />
            </Box>

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
                onChange={(o) =>
                  o && act("transition", { status: o.value, ...stopReason(o.value) })
                }
              />
              <Select<Opt>
                spacing="compact"
                placeholder="type"
                options={opts([...TYPES])}
                value={current(typeOf(task))}
                onChange={(o) => o && act("type", { type: o.value })}
              />
              <Select<Opt>
                spacing="compact"
                isClearable
                placeholder="priority"
                options={opts(PRIORITIES)}
                value={current(task.priority)}
                onChange={(o) =>
                  act("priority", o?.value ? { priority: o.value } : {})
                }
              />
              <Select<Opt>
                spacing="compact"
                isClearable
                placeholder="epic"
                options={opts(
                  epics.filter((e) => e.status !== "done").map((e) => e.id),
                )}
                value={current(task.epic)}
                onChange={(o) => {
                  const next = o?.value ?? null;
                  if (next !== (task.epic ?? null)) {
                    run(() => write.edit(task.id, { epic: next }));
                  }
                }}
              />
              <Select<Opt>
                spacing="compact"
                isClearable
                placeholder="sprint"
                options={sprints.map((s) => ({
                  label: `${s.id} ${s.title}`,
                  value: s.id,
                }))}
                value={current(task.sprint)}
                onChange={(o) =>
                  act("sprint", { sprint: o?.value ?? null })
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
              <Select<Opt>
                spacing="compact"
                isClearable
                placeholder="epic"
                options={[
                  { label: "(none)", value: "none" },
                  ...epics.map((e) => ({
                    label: `${e.id} ${e.title}`,
                    value: e.id,
                  })),
                ]}
                value={
                  task.epic
                    ? {
                        label: epicOf(task.epic)
                          ? `${task.epic} ${epicOf(task.epic)!.title}`
                          : task.epic,
                        value: task.epic,
                      }
                    : { label: "(none)", value: "none" }
                }
                onChange={(o) => {
                  const next = o?.value ?? "none";
                  if (next !== (task.epic || "none")) {
                    run(() => write.edit(task.id, { epic: next }));
                  }
                }}
              />
            </Inline>
            {(task.status === "blocked" && task.blockedReason) ||
            (task.status === "parked" && task.parkedReason) ? (
              <Text size="small" color="color.text.subtlest">
                {task.status === "blocked"
                  ? task.blockedReason
                  : task.parkedReason}
              </Text>
            ) : null}

            {/* Both were placeholder-only, so each lost its name the moment you typed into it.
                `label` is a real label, and the read view is a button assistive tech can announce. */}
            <Section title="PEOPLE AND SIZE">
              <InlineField
                value={task.assignee ?? ""}
                label="Assignee"
                editLabel={`Edit the assignee of ${task.id}`}
                placeholder="Unassigned"
                onCommit={(next) => {
                  const who = next.trim();
                  if (who !== (task.assignee ?? "")) {
                    act("assign", { assignee: who || null });
                  }
                }}
              />
              <InlineField
                value={task.estimate === undefined ? "" : String(task.estimate)}
                label="Estimate (points)"
                editLabel={`Edit the estimate of ${task.id}`}
                placeholder="No estimate"
                onCommit={(next) => {
                  const raw = next.trim();
                  if (raw === String(task.estimate ?? "")) return;
                  if (!raw) {
                    act("estimate", {});
                    return;
                  }
                  const value = Number(raw);
                  if (Number.isFinite(value) && value >= 0) {
                    act("estimate", { estimate: value });
                  }
                }}
              />
            </Section>

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
                  {/* An icon glyph rather than a "✕" character, and IconButton rather than Button:
                      the glyph is sized and coloured by the tokens instead of by whatever the
                      platform font does, and `label` gives a destructive control the accessible
                      name it had none of. */}
                  <Tooltip content="remove this criterion — renumbers the ones after it">
                    <IconButton
                      appearance="subtle"
                      spacing="compact"
                      label={`Remove acceptance criterion ${i + 1}`}
                      icon={(props) => <CrossIcon {...props} size="small" />}
                      onClick={() =>
                        act("accept", { index: i + 1, remove: true })
                      }
                    />
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
                  placeholder="task or ADR"
                  options={opts([
                    ...others.map((t) => t.id),
                    ...adrs.map((a) => a.id),
                  ])}
                  value={null}
                  onChange={(o) =>
                    o && act("link", { type: linkType, to: o.value })
                  }
                />
              </Inline>
            </Section>

            <Section title="DECISIONS">
              {(() => {
                const rows = decisionsFor(task, adrs);
                if (!rows.length) {
                  return (
                    <Text size="small" color="color.text.subtlest">
                      no ADRs linked or filed under this epic
                    </Text>
                  );
                }
                return rows.map((a) =>
                  onOpen ? (
                    <Pressable
                      key={a.id}
                      xcss={styles.decision}
                      onClick={() => onOpen(a.id)}
                    >
                      <Inline space="space.100" alignBlock="center">
                        <Box xcss={styles.id}>
                          <Text size="small" weight="bold">
                            {a.id}
                          </Text>
                        </Box>
                        <Text size="small">{a.title}</Text>
                        {a.status === "proposed" ||
                        a.status === "accepted" ||
                        a.status === "superseded" ? (
                          <Lozenge
                            appearance={
                              a.status === "accepted"
                                ? "success"
                                : a.status === "proposed"
                                  ? "inprogress"
                                  : "default"
                            }
                          >
                            {a.status}
                          </Lozenge>
                        ) : null}
                      </Inline>
                    </Pressable>
                  ) : (
                    <Text key={a.id} size="small">{`${a.id} ${a.title}`}</Text>
                  ),
                );
              })()}
            </Section>

            <Section title="EVIDENCE">
              {(() => {
                const rows = evidence ?? fallbackEvidence(task.evidence ?? []);
                if (!rows.length) {
                  return (
                    <Text size="small" color="color.text.subtlest">
                      No evidence yet.
                    </Text>
                  );
                }
                return rows.map((item) => {
                  const missing = item.kind === "file" && !item.exists;
                  const href =
                    item.kind === "url"
                      ? item.ref
                      : item.previewable
                        ? fileHref(task.id, item.ref)
                        : null;
                  return (
                    <Inline
                      key={item.ref}
                      space="space.050"
                      alignBlock="center"
                      spread="space-between"
                    >
                      <Box xcss={styles.evidenceRef}>
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer">
                            <Text size="small">{item.ref}</Text>
                          </a>
                        ) : (
                          <Text
                            size="small"
                            color={missing ? "color.text.subtlest" : "color.text"}
                          >
                            {item.ref}
                          </Text>
                        )}
                      </Box>
                      <Tooltip content="detach this ref — the file stays on disk">
                        <IconButton
                          appearance="subtle"
                          spacing="compact"
                          label={`Detach evidence ${item.ref}`}
                          icon={(props) => <CrossIcon {...props} size="small" />}
                          onClick={() => act("evidence", { detach: item.ref })}
                        />
                      </Tooltip>
                    </Inline>
                  );
                });
              })()}
              <TextArea
                placeholder="paste output to attach as a log"
                value={note}
                minimumRows={2}
                onChange={(e) =>
                  setNote((e.target as HTMLTextAreaElement).value)
                }
              />
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Button
                  isDisabled={!note.trim()}
                  onClick={() => {
                    act("evidence", { text: note });
                    setNote("");
                  }}
                >
                  Attach text
                </Button>
                <input
                  type="file"
                  aria-label={`Attach a file to ${task.id}`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) run(() => attachEvidenceFile(task.id, file));
                  }}
                />
              </Inline>
            </Section>

            <Section title="COMMENTS">
              {/*
                One entry per comment, not one line.

                Each was a single `Text` holding author, timestamp and body run together —
                `main · 2026-07-29 23:37 — …` — so nine comments became a solid block whose only
                boundary marker was spotting "main ·" at the start of a line, and the metadata
                shouted exactly as loudly as the thing it labelled.

                Attribution above the body in subtlest text, and a rule between entries: the
                cheapest thing that makes "where does this one end" answerable at a glance.
              */}
              {(task.comments ?? []).length === 0 ? (
                <Text size="small" color="color.text.subtlest">
                  No comments yet.
                </Text>
              ) : null}
              {(task.comments ?? []).map((c, i) => (
                <Box
                  key={`${c.ts}-${i}`}
                  xcss={i === 0 ? styles.firstComment : styles.comment}
                >
                  <Stack space="space.050">
                    <Text size="small" color="color.text.subtlest">
                      {`${c.author ?? "?"} · ${c.ts?.slice(0, 16).replace("T", " ")}`}
                    </Text>
                    <Text size="small">{c.text}</Text>
                  </Stack>
                </Box>
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
      {live ? (
        <Boundary what="The work stream">
          <WorkStream taskId={task.id} />
        </Boundary>
      ) : null}
      </Box>
    </Drawer>
  );
}
