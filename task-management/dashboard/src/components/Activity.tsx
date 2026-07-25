import { cssMap } from "@atlaskit/css";
import { Box, Stack, Text } from "@atlaskit/primitives/compiled";
import type { StoreEvent } from "../types";

const styles = cssMap({
  log: {
    fontFamily: "var(--ds-font-family-code)",
    maxHeight: "200px",
    overflowY: "auto",
  },
});

export function Activity({ events }: { events: StoreEvent[] }) {
  return (
    <Stack space="space.100">
      <Text size="small" weight="bold" color="color.text.subtlest">
        ACTIVITY
      </Text>
      <Box xcss={styles.log}>
        <Stack space="space.025">
          {events.map((e, i) => (
            <Text key={`${e.ts}-${i}`} size="small" color="color.text.subtlest">
              {`${e.ts?.slice(11, 19) ?? ""}  ${e.actor ?? "—"}  ${e.event}  ${e.id ?? ""} ${e.title ?? ""}`}
            </Text>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
