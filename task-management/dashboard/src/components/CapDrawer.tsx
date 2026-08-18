import { useEffect, useState } from "react";
import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import Drawer from "@atlaskit/drawer";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import { fetchCapability, write } from "../api";
import { Markdown } from "./Markdown";
import type { Capability } from "../types";

const styles = cssMap({
  shell: {
    display: "grid",
    gridTemplateRows: "auto 1fr",
    height: "100%",
    minHeight: "0",
    maxWidth: "620px",
  },
  header: {
    paddingInline: "var(--ds-space-300)",
    paddingBlock: "var(--ds-space-200)",
    borderBlockEndWidth: "var(--ds-border-width)",
    borderBlockEndStyle: "solid",
    borderBlockEndColor: "var(--ds-border)",
    backgroundColor: "var(--ds-surface)",
  },
  scroller: {
    overflowY: "auto",
    overscrollBehavior: "contain",
    minHeight: "0",
    paddingInline: "var(--ds-space-300)",
    paddingBlock: "var(--ds-space-200)",
  },
  firstSection: {
    paddingBlockStart: "var(--ds-space-100)",
    marginBlockStart: "0",
  },
  id: { fontFamily: "var(--ds-font-family-code)" },
  chip: {
    cursor: "pointer",
    backgroundColor: "transparent",
    borderWidth: "0",
    padding: "0",
  },
});

const LOZENGE: Record<string, "inprogress" | "success" | "removed" | "default"> = {
  open: "inprogress",
  in_progress: "inprogress",
  done: "success",
  deleted: "removed",
};

function statusLabel(status: string): string {
  if (status === "open") return "proposed";
  if (status === "in_progress") return "accepted";
  if (status === "done") return "shipped";
  return status;
}

function dropWhy(): string | undefined {
  const why = window.prompt("Why drop this capability?");
  return why?.trim() || undefined;
}

/**
 * One capability. Opened from the Enhance panel, a task chip, a lane chip,
 * activity or the palette. Body comes from GET /api/capability/:id.
 */
export function CapDrawer({
  cap,
  onClose,
  onOpenTask,
  run,
}: {
  cap: Capability | null;
  onClose: () => void;
  onOpenTask?: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [detail, setDetail] = useState<Capability | null>(null);

  useEffect(() => {
    if (!cap?.id) return setDetail(null);
    let live = true;
    void fetchCapability(cap.id)
      .then((full) => live && setDetail(full))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [cap?.id, cap?.status, cap?.task]);

  if (!cap) return null;

  const status = detail?.status || cap.status;
  const task = detail?.task || cap.task;
  const score = detail?.score ?? cap.score;
  const hasEvidence = ((detail?.evidence ?? cap.evidence) ?? []).length > 0;

  return (
    <Drawer isOpen label={cap.id} width="wide" onClose={onClose}>
      <Box xcss={styles.shell}>
        <Box xcss={styles.header}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Box xcss={styles.id}>
                <Text weight="bold">{cap.id}</Text>
              </Box>
              {status ? (
                <Lozenge appearance={LOZENGE[status] ?? "default"}>
                  {statusLabel(status)}
                </Lozenge>
              ) : null}
              <Text size="small" color="color.text.subtlest">
                {`I${detail?.impact ?? cap.impact ?? "M"}/E${detail?.effort ?? cap.effort ?? "M"}/C${detail?.confidence ?? cap.confidence ?? "M"} · ${score ?? "—"}`}
              </Text>
              {task ? (
                onOpenTask ? (
                  <Pressable xcss={styles.chip} onClick={() => onOpenTask(task)}>
                    <Lozenge appearance="new">{task}</Lozenge>
                  </Pressable>
                ) : (
                  <Lozenge appearance="new">{task}</Lozenge>
                )
              ) : null}
            </Inline>
            <Text>{detail?.title || cap.title}</Text>
            {status === "deleted" || status === "done" ? null : (
              <Inline space="space.100">
                {status === "open" ? (
                  <Button
                    appearance="primary"
                    spacing="compact"
                    onClick={() => run(() => write.acceptCap(cap.id))}
                  >
                    Accept
                  </Button>
                ) : null}
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
                <Button
                  appearance="subtle"
                  spacing="compact"
                  isDisabled={!hasEvidence}
                  onClick={() => run(() => write.shipCap(cap.id))}
                >
                  Ship
                </Button>
              </Inline>
            )}
          </Stack>
        </Box>

        <Box xcss={styles.scroller}>
          {detail?.body?.trim() ? (
            <Box xcss={styles.firstSection}>
              <Stack space="space.050">
                <Text weight="bold" size="small" color="color.text.subtlest">
                  CAPABILITY
                </Text>
                <Markdown source={detail.body} />
              </Stack>
            </Box>
          ) : (
            <Text size="small" color="color.text.subtlest">
              no body yet
            </Text>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
