import { useEffect, useState } from "react";
import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import Drawer from "@atlaskit/drawer";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import { fetchEpic, write } from "../api";
import { Markdown } from "./Markdown";
import type { Epic, Task } from "../types";
import { attentionOf, decisionRole, MAP_HEADINGS, sectionsOf } from "../../../lib/decision.mjs";

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
  section: {
    paddingBlockStart: "var(--ds-space-200)",
    marginBlockStart: "var(--ds-space-100)",
    borderBlockStartWidth: "var(--ds-border-width)",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: "var(--ds-border)",
  },
  firstSection: {
    paddingBlockStart: "var(--ds-space-100)",
    marginBlockStart: "0",
  },
  child: {
    cursor: "pointer",
    backgroundColor: "transparent",
    borderWidth: "0",
    padding: "0",
    textAlign: "left",
    width: "100%",
  },
  id: { fontFamily: "var(--ds-font-family-code)" },
});

/**
 * One epic. Opened from a lane header. Body comes from GET /api/epic/:id because
 * the board list strips it; children come from the board payload, which already
 * has them.
 */
export function EpicDrawer({
  epic,
  tasks,
  activeEpic,
  onClose,
  onOpenTask,
  run,
}: {
  epic: Epic | null;
  tasks: Task[];
  activeEpic: string | null;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [detail, setDetail] = useState<Epic | null>(null);

  useEffect(() => {
    if (!epic?.id) return setDetail(null);
    let live = true;
    void fetchEpic(epic.id)
      .then((full) => live && setDetail(full))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [epic?.id]);

  if (!epic) return null;

  const closed = epic.status === "done";
  const children = tasks.filter((t) => t.epic === epic.id);
  const plan = detail?.plan || epic.plan;
  const closedAt = detail?.closed || epic.closed;
  const isMap = (detail?.labels ?? epic.labels ?? []).includes("decision:map");
  const mapSections = isMap ? sectionsOf(detail?.body ?? epic.body ?? "") : [];

  return (
    <Drawer isOpen label={epic.id} width="wide" onClose={onClose}>
      <Box xcss={styles.shell}>
        <Box xcss={styles.header}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Box xcss={styles.id}>
                <Text weight="bold">{epic.id}</Text>
              </Box>
              <Lozenge appearance={closed ? "success" : "inprogress"}>
                {closed ? "closed" : epic.status}
              </Lozenge>
              {epic.id === activeEpic ? (
                <Lozenge appearance="inprogress">active</Lozenge>
              ) : null}
              {plan ? <Lozenge appearance="new">{`plan ${plan}`}</Lozenge> : null}
              {(detail?.labels ?? epic.labels ?? []).includes("decision:map") ? (
                <Lozenge appearance="inprogress">map</Lozenge>
              ) : null}
            </Inline>
            <Text>{epic.title}</Text>
            {closedAt ? (
              <Text size="small" color="color.text.subtlest">
                {`closed ${closedAt.slice(0, 16).replace("T", " ")}`}
              </Text>
            ) : null}
            <Inline space="space.100">
              {epic.id !== activeEpic && !closed ? (
                <Button
                  appearance="primary"
                  spacing="compact"
                  onClick={() => run(() => write.activeEpic(epic.id))}
                >
                  Make active
                </Button>
              ) : null}
              {closed ? (
                <Button
                  appearance="default"
                  spacing="compact"
                  onClick={() => run(() => write.reopenEpic(epic.id))}
                >
                  Reopen
                </Button>
              ) : (
                <Button
                  appearance="subtle"
                  spacing="compact"
                  onClick={() => run(() => write.closeEpic(epic.id))}
                >
                  Close
                </Button>
              )}
            </Inline>
          </Stack>
        </Box>

        <Box xcss={styles.scroller}>
          <Stack space="space.150">
            {isMap && mapSections.length ? (
              mapSections.map((sec, i) => (
                <Box key={sec.heading || "lead"} xcss={i === 0 ? styles.firstSection : styles.section}>
                  <Stack space="space.050">
                    <Text weight="bold" size="small" color="color.text.subtlest">
                      {(sec.heading || "CONTEXT").toUpperCase()}
                    </Text>
                    {sec.body ? (
                      <Markdown source={sec.body} />
                    ) : (
                      <Text size="small" color="color.text.subtlest">
                        {MAP_HEADINGS.includes(sec.heading || "") ? "empty" : ""}
                      </Text>
                    )}
                  </Stack>
                </Box>
              ))
            ) : detail?.body?.trim() ? (
              <Box xcss={styles.firstSection}>
                <Stack space="space.050">
                  <Text weight="bold" size="small" color="color.text.subtlest">
                    CONTEXT
                  </Text>
                  <Markdown source={detail.body} />
                </Stack>
              </Box>
            ) : null}

            <Box xcss={detail?.body?.trim() ? styles.section : styles.firstSection}>
              <Stack space="space.100">
                <Text weight="bold" size="small" color="color.text.subtlest">
                  {`CHILDREN (${children.length})`}
                </Text>
                {children.length ? (
                  children.map((t) => (
                    <Pressable
                      key={t.id}
                      xcss={styles.child}
                      onClick={() => onOpenTask(t.id)}
                    >
                      <Inline space="space.100" alignBlock="center">
                        <Box xcss={styles.id}>
                          <Text size="small" weight="bold">
                            {t.id}
                          </Text>
                        </Box>
                        <Text size="small">{t.title}</Text>
                        <Lozenge
                          appearance={t.status === "done" ? "success" : "default"}
                        >
                          {t.status}
                        </Lozenge>
                        {(() => {
                          const role = decisionRole(t.labels);
                          const attn = attentionOf(role);
                          return (
                            <>
                              {role ? (
                                <Lozenge appearance="inprogress">
                                  {role.slice("decision:".length)}
                                </Lozenge>
                              ) : null}
                              {attn ? <Lozenge appearance="new">{attn}</Lozenge> : null}
                            </>
                          );
                        })()}
                      </Inline>
                    </Pressable>
                  ))
                ) : (
                  <Text size="small" color="color.text.subtlest">
                    no tasks in this epic yet
                  </Text>
                )}
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
}
