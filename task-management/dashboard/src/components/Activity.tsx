import { cssMap } from "@atlaskit/css";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { Pressable } from "@atlaskit/primitives/compiled";
import type { StoreEvent } from "../types";

const styles = cssMap({
  log: {
    maxHeight: "200px",
    overflowY: "auto",
  },
  // The timestamp and the id are the two columns your eye scans down, so they keep the code face
  // and their width. The sentence beside them is prose and reads better in the body face — which is
  // why the monospace moved off the container and onto this one column.
  fixed: {
    fontFamily: "var(--ds-font-family-code)",
    flexShrink: 0,
  },
  // A long detail must not push the timestamp column out of the panel.
  row: {
    minWidth: "0",
  },
  id: {
    cursor: "pointer",
    backgroundColor: "transparent",
    borderWidth: "0",
    padding: "0",
    fontFamily: "var(--ds-font-family-code)",
    flexShrink: 0,
  },
});

/**
 * What a row says beyond the event's name.
 *
 * The panel printed `e.event` — the raw key — so it read
 *
 *   02:01:02  main  update  TM-003
 *   02:01:02  main  update  TM-002
 *   02:01:02  main  update  TM-001
 *
 * three times over: a field changed on three tasks, and not a word about which field or what it
 * became. The payload was carrying the answer the whole time — `update` holds `patch` and `status`,
 * `moved` holds `from`/`to`, `park` and `block` hold `reason` — and nothing read any of it.
 *
 * The sentence for the event kind comes from the store's own catalog, attached by `/api/events`, so
 * this panel and `tm log` describe the same event the same way instead of keeping two vocabularies.
 */
function detail(e: StoreEvent): string {
  const bits: string[] = [];
  // "no epic" rather than a dash: `— — → EP-001` reads as a typo, which it looked like.
  if (e.from || e.to)
    bits.push(`${e.from ?? "no epic"} → ${e.to ?? "no epic"}`);
  if (e.status) bits.push(e.status);
  else if (e.patch) bits.push(e.patch);
  if (e.reason) bits.push(e.reason);
  if (e.title) bits.push(e.title);
  return bits.join(" · ");
}

/**
 * What the row is called.
 *
 * `_status` means the API judged this row a status transition, so it reads as the transition —
 * `→ blocked`, exactly what `tm log` prints — rather than as "Any field on a task changes" with the
 * new status tacked on the end. The generic label is true and useless: the interesting thing about
 * that write is where the task went.
 */
function heading(e: StoreEvent): string {
  if (e._status) return `→ ${e._status}`;
  // `label` is missing only for events the PWA cached before the API sent one; falling back to the
  // raw key keeps an offline replay readable.
  return e.label ?? e.event;
}

export function Activity({
  events,
  onOpen,
}: {
  events: StoreEvent[];
  onOpen?: (id: string) => void;
}) {
  return (
    <Stack space="space.100">
      <Text size="small" weight="bold" color="color.text.subtlest">
        ACTIVITY
      </Text>
      <Box xcss={styles.log}>
        <Stack space="space.025">
          {events
            .filter((e) => !e._shadowed)
            .map((e, i) => {
              const extra = e._status ? "" : detail(e);
              const jump = Boolean(
                e.id &&
                  (e.id.startsWith("ADR-") || e.id.startsWith("CAP-")) &&
                  onOpen,
              );
              return (
                <Inline
                  key={`${e.ts}-${i}`}
                  space="space.075"
                  xcss={styles.row}
                >
                  {jump ? (
                    <Pressable xcss={styles.id} onClick={() => onOpen!(e.id!)}>
                      <Text size="small" color="color.text.subtlest">
                        {`${e.ts?.slice(11, 19) ?? ""} ${e.id}`}
                      </Text>
                    </Pressable>
                  ) : (
                    <Box xcss={styles.fixed}>
                      <Text size="small" color="color.text.subtlest">
                        {`${e.ts?.slice(11, 19) ?? ""} ${e.id ?? "—"}`}
                      </Text>
                    </Box>
                  )}
                  <Text size="small" color="color.text.subtlest">
                    {`${heading(e)}${extra ? ` — ${extra}` : ""}`}
                  </Text>
                </Inline>
              );
            })}
        </Stack>
      </Box>
    </Stack>
  );
}
