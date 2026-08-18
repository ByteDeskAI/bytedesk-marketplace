import { useEffect, useState } from "react";
import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import Select from "@atlaskit/select";
import { fetchPlanFile, write } from "../api";
import type { Epic, PlanFile, PlanInboxItem } from "../types";
import { Markdown } from "./Markdown";

const styles = cssMap({
  panel: {
    width: "280px",
    flexShrink: 0,
    borderInlineStartColor: "var(--ds-border)",
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: "var(--ds-border-width)",
    paddingInlineStart: "var(--ds-space-150)",
    maxHeight: "70vh",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  row: {
    cursor: "pointer",
    backgroundColor: "transparent",
    borderWidth: "0",
    padding: "0",
    textAlign: "left",
    width: "100%",
  },
  selected: {
    backgroundColor: "var(--ds-background-selected)",
    borderRadius: "var(--ds-radius-small)",
    paddingInline: "var(--ds-space-050)",
    paddingBlock: "var(--ds-space-025)",
  },
  name: { wordBreak: "break-word" },
});

type Opt = { label: string; value: string };

function PlanPreview({ file }: { file: PlanFile }) {
  const m = file.manifest;
  if (m && !m.error) {
    const title = m.epicTitle || m.plan || file.name;
    const goals = m.goals ?? [];
    return (
      <Stack space="space.075">
        <Text weight="medium" size="small">
          {title}
        </Text>
        {goals.length ? (
          goals.map((g) => (
            <Text key={g.id} size="small">{`${g.id} ${g.title || ""}`.trim()}</Text>
          ))
        ) : (
          <Text size="small" color="color.text.subtlest">
            no goals in this manifest
          </Text>
        )}
      </Stack>
    );
  }
  if (m?.error) {
    return (
      <Text size="small" color="color.text.subtlest">
        could not parse manifest
      </Text>
    );
  }
  if (file.content) return <Markdown source={file.content} />;
  return (
    <Text size="small" color="color.text.subtlest">
      empty plan
    </Text>
  );
}

/**
 * Inbox beside the board, not a sixth column. Lists GET /api/plans.
 * Unlinked files stay visible so they can be pointed at an open epic.
 */
export function PlansInbox({
  plans,
  epics,
  onOpen,
  run,
}: {
  plans: PlanInboxItem[];
  epics: Epic[];
  onOpen: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanFile | null>(null);
  const [missing, setMissing] = useState(false);
  const [linkTo, setLinkTo] = useState<string | null>(null);

  const item = plans.find((p) => p.path === selected) ?? null;
  const openEpics = epics.filter((e) => e.status !== "done");

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      setMissing(false);
      return undefined;
    }
    let live = true;
    void fetchPlanFile(selected)
      .then((file) => {
        if (!live) return;
        setPreview(file);
        setMissing(false);
      })
      .catch(() => {
        if (!live) return;
        setPreview(null);
        setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [selected]);

  return (
    <Box xcss={styles.panel}>
      <Stack space="space.100">
        <Text weight="bold" size="small" color="color.text.subtlest">
          PLANS
        </Text>
        {plans.length ? (
          plans.map((p) => (
            <Pressable
              key={p.path}
              xcss={styles.row}
              onClick={() => setSelected(p.path)}
            >
              <Box xcss={selected === p.path ? styles.selected : undefined}>
                <Stack space="space.025">
                  <Box xcss={styles.name}>
                    <Text size="small">{p.name}</Text>
                  </Box>
                  {p.linkedEpic ? (
                    <Lozenge appearance="new">{p.linkedEpic}</Lozenge>
                  ) : (
                    <Text size="small" color="color.text.subtlest">
                      unlinked
                    </Text>
                  )}
                </Stack>
              </Box>
            </Pressable>
          ))
        ) : (
          <Text size="small" color="color.text.subtlest">
            no captured plans
          </Text>
        )}

        {item ? (
          <Stack space="space.100">
            {missing || !item.exists ? (
              <Text size="small" color="color.text.subtlest">
                {`${item.path} is missing`}
              </Text>
            ) : preview ? (
              <PlanPreview file={preview} />
            ) : null}

            {item.linkedEpic ? (
              <Button
                appearance="subtle"
                spacing="compact"
                onClick={() => onOpen(item.linkedEpic!)}
              >
                {`Open ${item.linkedEpic}`}
              </Button>
            ) : (
              <Stack space="space.050">
                <Select<Opt>
                  spacing="compact"
                  placeholder="link to an open epic"
                  options={openEpics.map((e) => ({
                    label: `${e.id} ${e.title}`,
                    value: e.id,
                  }))}
                  value={linkTo ? { label: linkTo, value: linkTo } : null}
                  onChange={(o) => setLinkTo(o?.value ?? null)}
                />
                <Button
                  appearance="primary"
                  spacing="compact"
                  isDisabled={!linkTo}
                  onClick={() => {
                    if (!linkTo) return;
                    run(() => write.epicPlan(linkTo, item.path));
                  }}
                >
                  Link
                </Button>
              </Stack>
            )}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
