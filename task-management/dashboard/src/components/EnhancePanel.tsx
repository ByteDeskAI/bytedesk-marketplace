import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import { write } from "../api";
import type { Capability } from "../types";

const styles = cssMap({
  panel: {
    backgroundColor: "var(--ds-surface-sunken)",
    borderRadius: "var(--ds-radius-medium)",
    padding: "var(--ds-space-150)",
    minWidth: "280px",
    maxWidth: "320px",
    flexShrink: 0,
  },
  heading: { textTransform: "uppercase" },
  id: { fontFamily: "var(--ds-font-family-code)" },
  open: {
    cursor: "pointer",
    backgroundColor: "transparent",
    borderWidth: "0",
    padding: "0",
    textAlign: "left",
  },
  card: {
    backgroundColor: "var(--ds-surface)",
    borderRadius: "var(--ds-radius-small)",
    padding: "var(--ds-space-100)",
  },
});

const LOZENGE: Record<string, "inprogress" | "success" | "removed" | "default"> = {
  open: "inprogress",
  in_progress: "inprogress",
  done: "success",
  deleted: "removed",
};

function dropWhy(): string | undefined {
  const why = window.prompt("Why drop this capability?");
  return why?.trim() || undefined;
}

/**
 * Ranked enhancement backlog beside the board — never a sixth kanban column.
 *
 * Empty `capabilities/` is first-class: the operator is told to `/enhance` or
 * `tm cap new`, not shown a blank column.
 */
export function EnhancePanel({
  capabilities,
  onOpen,
  run,
}: {
  capabilities: Capability[];
  onOpen?: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  return (
    <Box xcss={styles.panel}>
      <Stack space="space.100">
        <Box xcss={styles.heading}>
          <Text size="small" weight="bold" color="color.text.subtlest">
            Enhance
          </Text>
        </Box>
        <Text size="small" color="color.text.subtlest">
          ranked by impact × ease × confidence
        </Text>
        {capabilities.length === 0 ? (
          <Text size="small" color="color.text.subtlest">
            No capabilities yet. Run /enhance or tm cap new to propose one.
          </Text>
        ) : (
          capabilities.map((c) => (
            <CapRow key={c.id} cap={c} onOpen={onOpen} run={run} />
          ))
        )}
      </Stack>
    </Box>
  );
}

function CapRow({
  cap,
  onOpen,
  run,
}: {
  cap: Capability;
  onOpen?: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const score = cap.score ?? 0;
  const hasEvidence = (cap.evidence ?? []).length > 0;
  const proposed = cap.status === "open";
  const shipped = cap.status === "done";
  const dropped = cap.status === "deleted";

  return (
    <Box xcss={styles.card}>
      <Stack space="space.075">
        <Inline space="space.075" alignBlock="center" shouldWrap>
          {onOpen ? (
            <Pressable xcss={styles.open} onClick={() => onOpen(cap.id)}>
              <Box xcss={styles.id}>
                <Text size="small" weight="bold">
                  {cap.id}
                </Text>
              </Box>
            </Pressable>
          ) : (
            <Box xcss={styles.id}>
              <Text size="small" weight="bold">
                {cap.id}
              </Text>
            </Box>
          )}
          <Lozenge appearance={LOZENGE[cap.status] ?? "default"}>
            {cap.status === "open"
              ? "proposed"
              : cap.status === "in_progress"
                ? "accepted"
                : cap.status === "done"
                  ? "shipped"
                  : cap.status}
          </Lozenge>
          <Text size="small" color="color.text.subtlest">
            {`I${cap.impact ?? "M"}/E${cap.effort ?? "M"}/C${cap.confidence ?? "M"} · ${score}`}
          </Text>
        </Inline>
        <Text size="small">{cap.title}</Text>
        {dropped ? null : (
          <Inline space="space.050" shouldWrap>
            {proposed ? (
              <Button
                appearance="primary"
                spacing="compact"
                onClick={() => run(() => write.acceptCap(cap.id))}
              >
                Accept
              </Button>
            ) : null}
            {shipped ? null : (
              <Button
                appearance="subtle"
                spacing="compact"
                onClick={() => {
                  const why = dropWhy();
                  run(() => write.dropCap(cap.id, why));
                }}
              >
                Drop
              </Button>
            )}
            {shipped ? null : (
              <Button
                appearance="subtle"
                spacing="compact"
                isDisabled={!hasEvidence}
                onClick={() => run(() => write.shipCap(cap.id))}
              >
                Ship
              </Button>
            )}
          </Inline>
        )}
      </Stack>
    </Box>
  );
}
