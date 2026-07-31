import type { DragEvent } from "react";
import Badge from "@atlaskit/badge";
import { cssMap } from "@atlaskit/css";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { TaskCard } from "./TaskCard";
import { label } from "../keys.mjs";
import type { Status, Task } from "../types";

const EMPTY_SET: Set<string> = new Set();
const EMPTY_MAP: Map<string, { status: string; error?: string }> = new Map();

const styles = cssMap({
  column: {
    backgroundColor: "var(--ds-surface-sunken)",
    borderRadius: "var(--ds-radius-medium)",
    padding: "var(--ds-space-150)",
    minWidth: "260px",
  },
  heading: { textTransform: "uppercase" },
  key: {
    backgroundColor: "var(--ds-background-neutral)",
    borderRadius: "var(--ds-radius-small)",
    fontFamily: "var(--ds-font-family-code)",
    paddingInline: "var(--ds-space-050)",
  },
});

export function Column({
  status,
  tasks,
  starts,
  now,
  selected,
  onSelect,
  onOpen,
  onDrop,
  onDropBefore,
  watching = EMPTY_SET,
  onWatch,
  outbox = EMPTY_MAP,
  focusedId = null,
  onFocusCard,
  index,
}: {
  status: Status;
  tasks: Task[];
  starts: Map<string, number>;
  now: number;
  selected: Set<string>;
  onSelect: (id: string, on: boolean) => void;
  onOpen: (id: string) => void;
  onDrop: (id: string, status: Status) => void;
  onDropBefore: (dragged: string, before: string) => void;
  // Optional to match TaskCard: the pwa layer supplies these, the board renders without them.
  watching?: Set<string>;
  onWatch?: (id: string) => void;
  outbox?: Map<string, { status: string; error?: string }>;
  focusedId?: string | null;
  onFocusCard?: (id: string) => void;
  /** 1-based position, shown in the heading because that digit is the shortcut. */
  index?: number;
}) {
  return (
    <div
      onDragOver={(e: DragEvent) => e.preventDefault()} // without this the drop never fires
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDrop(id, status);
      }}
    >
      <Box xcss={styles.column}>
        <Stack space="space.100">
        <Inline space="space.075" alignBlock="center">
          <Box xcss={styles.heading}>
            <Text size="small" weight="bold" color="color.text.subtlest">
              {label(status)}
            </Text>
          </Box>
          <Badge>{tasks.length}</Badge>
          {/* The column's number IS its shortcut, so show it rather than hiding it
              in the help sheet. */}
          {index ? (
            <Box xcss={styles.key}>
              <Text size="small" color="color.text.subtlest">
                {index}
              </Text>
            </Box>
          ) : null}
        </Inline>
        <div role="list" aria-label={`${label(status)}, ${tasks.length} tasks`}>
          <Stack space="space.100">
            {tasks.length ? (
              tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  starts={starts}
                  now={now}
                  selected={selected.has(t.id)}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  onDropBefore={onDropBefore}
                  watched={watching.has(t.id)}
                  onWatch={onWatch}
                  outbox={outbox.get(t.id)}
                  focused={focusedId === t.id}
                  onFocusCard={onFocusCard}
                />
              ))
            ) : (
              <Text size="small" color="color.text.subtlest">
                —
              </Text>
            )}
          </Stack>
        </div>
        </Stack>
      </Box>
    </div>
  );
}
