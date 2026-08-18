import { useEffect, useState } from "react";
import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import Drawer from "@atlaskit/drawer";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import { fetchAdr, write } from "../api";
import { Markdown } from "./Markdown";
import type { Adr, AdrStatus } from "../types";

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

/** Lozenges only for the ADR lifecycle — never a task Status. */
const LOZENGE: Record<AdrStatus, "inprogress" | "success" | "default"> = {
  proposed: "inprogress",
  accepted: "success",
  superseded: "default",
};

function isAdrStatus(status: string): status is AdrStatus {
  return status === "proposed" || status === "accepted" || status === "superseded";
}

/**
 * One ADR. Opened from a lane chip, the task DECISIONS list, activity or the palette.
 * Body comes from GET /api/adr/:id because the board list strips it.
 */
export function AdrDrawer({
  adr,
  onClose,
  onOpenEpic,
  run,
}: {
  adr: Adr | null;
  onClose: () => void;
  onOpenEpic?: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [detail, setDetail] = useState<Adr | null>(null);

  useEffect(() => {
    if (!adr?.id) return setDetail(null);
    let live = true;
    void fetchAdr(adr.id)
      .then((full) => live && setDetail(full))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [adr?.id, adr?.status]);

  if (!adr) return null;

  const status = detail?.status || adr.status;
  const epic = detail?.epic || adr.epic;
  const supersedes = detail?.supersedes || adr.supersedes;

  return (
    <Drawer isOpen label={adr.id} width="wide" onClose={onClose}>
      <Box xcss={styles.shell}>
        <Box xcss={styles.header}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Box xcss={styles.id}>
                <Text weight="bold">{adr.id}</Text>
              </Box>
              {isAdrStatus(status) ? (
                <Lozenge appearance={LOZENGE[status]}>{status}</Lozenge>
              ) : null}
              {epic ? (
                onOpenEpic ? (
                  <Pressable xcss={styles.chip} onClick={() => onOpenEpic(epic)}>
                    <Lozenge appearance="new">{epic}</Lozenge>
                  </Pressable>
                ) : (
                  <Lozenge appearance="new">{epic}</Lozenge>
                )
              ) : null}
              {supersedes ? (
                <Lozenge appearance="default">{`supersedes ${supersedes}`}</Lozenge>
              ) : null}
            </Inline>
            <Text>{adr.title}</Text>
            {status === "proposed" ? (
              <Inline space="space.100">
                <Button
                  appearance="primary"
                  spacing="compact"
                  onClick={() => run(() => write.acceptAdr(adr.id))}
                >
                  Accept
                </Button>
              </Inline>
            ) : null}
          </Stack>
        </Box>

        <Box xcss={styles.scroller}>
          {detail?.body?.trim() ? (
            <Box xcss={styles.firstSection}>
              <Stack space="space.050">
                <Text weight="bold" size="small" color="color.text.subtlest">
                  DECISION
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
