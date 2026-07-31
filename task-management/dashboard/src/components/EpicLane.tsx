import Badge from "@atlaskit/badge";
import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Text } from "@atlaskit/primitives/compiled";
import Tooltip from "@atlaskit/tooltip";

const styles = cssMap({
  // Dense: one line, thin rule, monospace id, no decoration that isn't information.
  header: {
    borderBlockEndColor: "var(--ds-border)",
    borderBlockEndStyle: "solid",
    borderBlockEndWidth: "var(--ds-border-width)",
    paddingBlock: "var(--ds-space-050)",
  },
  active: {
    borderInlineStartColor: "var(--ds-border-selected)",
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: "var(--ds-border-width-selected)",
    paddingInlineStart: "var(--ds-space-100)",
  },
  id: { fontFamily: "var(--ds-font-family-code)" },
  // A bar rather than a percentage: the eye compares lengths faster than it reads
  // numbers, and the numbers are right next to it for anyone who wants them.
  track: {
    backgroundColor: "var(--ds-background-neutral)",
    borderRadius: "var(--ds-radius-small)",
    height: "6px",
    width: "120px",
  },
  fill: {
    backgroundColor: "var(--ds-background-success-bold)",
    borderRadius: "var(--ds-radius-small)",
    height: "6px",
  },
});

export interface Lane {
  id: string;
  title: string;
  status: string | null;
  active: boolean;
}

export function EpicLane({
  lane,
  done,
  total,
  fraction,
  onActivate,
  isNoEpic,
  collapsed = false,
  onToggle,
}: {
  lane: Lane;
  done: number;
  total: number;
  fraction: number;
  onActivate?: (id: string) => void;
  isNoEpic: boolean;
  /** Folded lanes keep their header — the progress bar is the reason to fold, not lose. */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <Box xcss={styles.header}>
      <Box xcss={lane.active ? styles.active : undefined}>
        <Inline space="space.150" alignBlock="center" shouldWrap>
          {onToggle ? (
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={onToggle}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${lane.title}`}
            >
              {collapsed ? "▸" : "▾"}
            </Button>
          ) : null}
          {!isNoEpic ? (
            <Box xcss={styles.id}>
              <Text size="small" weight="bold">
                {lane.id}
              </Text>
            </Box>
          ) : null}
          <Text weight={isNoEpic ? "regular" : "medium"}>{lane.title}</Text>
          {lane.active ? <Lozenge appearance="inprogress">active</Lozenge> : null}
          {lane.status === "done" ? <Lozenge appearance="success">closed</Lozenge> : null}
          {lane.status === "missing" ? (
            <Tooltip content="tasks name this epic but no epic file exists — `tm doctor --fix`">
              <Lozenge appearance="removed">missing</Lozenge>
            </Tooltip>
          ) : null}

          <Tooltip content={`${done} of ${total} done`}>
            <Box xcss={styles.track}>
              <Box xcss={styles.fill} style={{ width: `${Math.round(fraction * 100)}%` }} />
            </Box>
          </Tooltip>
          <Badge appearance={total && done === total ? "added" : "default"}>{`${done}/${total}`}</Badge>

          {/* Task creation is gated on an active epic, so this is the one decision the
              board could not make for itself before. */}
          {!lane.active && !isNoEpic && lane.status !== "done" && lane.status !== "missing" && onActivate ? (
            <Button appearance="subtle" spacing="compact" onClick={() => onActivate(lane.id)}>
              Make active
            </Button>
          ) : null}
        </Inline>
      </Box>
    </Box>
  );
}
