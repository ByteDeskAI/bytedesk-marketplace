import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import { Box, Inline, Text } from "@atlaskit/primitives/compiled";
import Select from "@atlaskit/select";
import { stopReason, write } from "../api";
import type { Priority, Status } from "../types";

const STATUSES: Status[] = [
  "backlog",
  "open",
  "in_progress",
  "blocked",
  "parked",
  "done",
];
const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];

const styles = cssMap({
  bar: {
    backgroundColor: "var(--ds-background-selected)",
    borderRadius: "var(--ds-radius-medium)",
    padding: "var(--ds-space-100)",
  },
});

type Opt = { label: string; value: string };
const opts = (values: readonly string[]): Opt[] => values.map((v) => ({ label: v, value: v }));

/** Appears only with a selection. One request per operation — the server loops. */
export function BulkBar({
  ids,
  onClear,
  run,
}: {
  ids: string[];
  onClear: () => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  if (!ids.length) return null;
  const bulk = (op: string, args: Record<string, unknown>) => {
    run(() => write.bulk(ids, op, args));
    onClear();
  };

  return (
    <Box xcss={styles.bar}>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Text weight="bold" size="small">{`${ids.length} selected`}</Text>
        <Select<Opt>
          spacing="compact"
          placeholder="move to…"
          options={opts(STATUSES)}
          value={null}
          onChange={(o) =>
            o && bulk("transition", { status: o.value, ...stopReason(o.value) })
          }
        />
        <Select<Opt>
          spacing="compact"
          placeholder="priority…"
          options={opts(PRIORITIES)}
          value={null}
          onChange={(o) => o && bulk("priority", { priority: o.value })}
        />
        <Button
          appearance="subtle"
          onClick={() => {
            const who = window.prompt("Assign the selected tasks to");
            if (who !== null) bulk("assign", { assignee: who.trim() || null });
          }}
        >
          Assign…
        </Button>
        <Button
          appearance="subtle"
          onClick={() => {
            const label = window.prompt("Add a label to the selected tasks");
            if (label?.trim()) bulk("labels", { add: [label.trim()] });
          }}
        >
          Label…
        </Button>
        <Button appearance="subtle" onClick={onClear}>
          Clear
        </Button>
      </Inline>
    </Box>
  );
}
