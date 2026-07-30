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
import { fetchTask, write } from "../api";
import { Markdown } from "./Markdown";
import { ActorBadge } from "./ActorBadge";
import type { Priority, Task } from "../types";

const STATUSES: Task["status"][] = ["open", "in_progress", "blocked", "parked", "done"];
const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];
const LINK_TYPES = ["blocks", "blocked by", "causes", "caused by", "duplicates", "duplicated by", "relates to"];

const styles = cssMap({
  body: { padding: "var(--ds-space-300)", maxWidth: "620px" },
  section: { paddingBlockStart: "var(--ds-space-200)" },
});

type Opt = { label: string; value: string };
const opts = (values: readonly string[]): Opt[] => values.map((v) => ({ label: v, value: v }));
const current = (v?: string | null): Opt | null => (v ? { label: v, value: v } : null);

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

  const act = (action: string, payload: Record<string, unknown>) => run(() => write.act(task.id, action, payload));
  const others = tasks.filter((t) => t.id !== task.id);

  return (
    <Drawer isOpen onClose={onClose} label={task.id} width="wide">
      <Box xcss={styles.body}>
        <Stack space="space.150">
          <Inline space="space.100" alignBlock="center">
            <Text weight="bold">{task.id}</Text>
            <Lozenge appearance={task.status === "done" ? "success" : "inprogress"}>{task.status}</Lozenge>
            <ActorBadge actor={task.actor} />
          </Inline>

          <Inline space="space.100" alignBlock="end">
            <Box>
              <Textfield value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} />
            </Box>
            <Button
              isDisabled={!title.trim() || title === task.title}
              onClick={() => run(() => write.edit(task.id, { title }))}
            >
              Rename
            </Button>
          </Inline>

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
            <Text size="small" color="color.text.subtlest">{`goal: ${detail.goalDoc}`}</Text>
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
              onChange={(o) => act("priority", { priority: o?.value ?? null })}
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
                if (who !== (task.assignee ?? "")) act("assign", { assignee: who || null });
              }}
            />
            <Textfield
              isCompact
              type="number"
              placeholder="estimate"
              defaultValue={task.estimate ?? ""}
              onBlur={(e) => {
                const raw = (e.target as HTMLInputElement).value;
                if (raw !== String(task.estimate ?? "")) act("estimate", { estimate: Number(raw) || 0 });
              }}
            />
          </Inline>

          <Box xcss={styles.section}>
            <Stack space="space.100">
              <Text weight="bold" size="small">
                LABELS
              </Text>
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
                  onChange={(e) => setLabel((e.target as HTMLInputElement).value)}
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
            </Stack>
          </Box>

          <Box xcss={styles.section}>
            <Stack space="space.100">
              <Text weight="bold" size="small">
                ACCEPTANCE CRITERIA
              </Text>
              {(task.acceptance ?? []).map((a, i) => (
                <Checkbox
                  key={`${a.text}-${i}`}
                  isChecked={Boolean(a.done)}
                  isDisabled={Boolean(a.done)}
                  label={a.text}
                  onChange={() => act("accept", { index: i + 1 })}
                />
              ))}
              <Inline space="space.100" alignBlock="end">
                <Textfield
                  isCompact
                  placeholder="add a criterion"
                  value={criterion}
                  onChange={(e) => setCriterion((e.target as HTMLInputElement).value)}
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
            </Stack>
          </Box>

          <Box xcss={styles.section}>
            <Stack space="space.100">
              <Text weight="bold" size="small">
                LINKS
              </Text>
              {(task.links ?? []).map((l) => (
                <Text key={`${l.type}-${l.id}`} size="small">{`${l.type} → ${l.id}`}</Text>
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
                  onChange={(o) => o && act("link", { type: linkType, to: o.value })}
                />
              </Inline>
            </Stack>
          </Box>

          <Box xcss={styles.section}>
            <Stack space="space.100">
              <Text weight="bold" size="small">
                COMMENTS
              </Text>
              {(task.comments ?? []).map((c, i) => (
                <Text key={`${c.ts}-${i}`} size="small">{`${c.author ?? "?"} · ${c.ts?.slice(0, 16).replace("T", " ")} — ${c.text}`}</Text>
              ))}
              <TextArea
                placeholder="Add a comment"
                value={comment}
                minimumRows={2}
                onChange={(e) => setComment((e.target as HTMLTextAreaElement).value)}
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
            </Stack>
          </Box>
        </Stack>
      </Box>
    </Drawer>
  );
}
