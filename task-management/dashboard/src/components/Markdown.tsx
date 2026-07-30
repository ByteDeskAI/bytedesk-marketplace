import { cssMap } from "@atlaskit/css";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { blocks, inlines } from "../markdown.mjs";

/**
 * A task body, rendered.
 *
 * Built from the block model in markdown.mjs into React elements — never a string. There is no
 * `dangerouslySetInnerHTML` anywhere here, so a body written by an agent, pasted from a goal doc
 * or arriving in a teammate's PR has no injection surface at all. "We escape carefully" is the
 * wrong answer when "we never build markup" is available.
 *
 * Routed through the design-it `editorial-design` style, and as with the earlier UI work I took
 * its structure and refused its palette: the pacing, the typographic hierarchy for long-form
 * reading, and the thin hairline rules between sections are the useful parts. Its serif/sans
 * pairing, drop caps and paper-white background are not — they would fight twenty Atlassian
 * Design System components and break both themes. ADS tokens only.
 */
const styles = cssMap({
  body: { paddingBlock: "var(--ds-space-050)" },
  h: { paddingBlockStart: "var(--ds-space-150)" },
  // The hairline is the one thing editorial-design contributes literally: a rule that separates
  // without shouting, so a long body reads as sections rather than as one wall.
  hairline: {
    borderBlockEndColor: "var(--ds-border)",
    borderBlockEndStyle: "solid",
    borderBlockEndWidth: "var(--ds-border-width)",
    paddingBlockStart: "var(--ds-space-100)",
  },
  quote: {
    borderInlineStartColor: "var(--ds-border-accent-gray)",
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: "var(--ds-border-width-selected)",
    paddingInlineStart: "var(--ds-space-150)",
  },
  pre: {
    backgroundColor: "var(--ds-surface-sunken)",
    borderRadius: "var(--ds-radius-small)",
    fontFamily: "var(--ds-font-family-code)",
    overflowX: "auto",
    padding: "var(--ds-space-100)",
    whiteSpace: "pre",
  },
  code: {
    backgroundColor: "var(--ds-surface-sunken)",
    borderRadius: "var(--ds-radius-small)",
    fontFamily: "var(--ds-font-family-code)",
    paddingInline: "var(--ds-space-050)",
  },
  item: { paddingBlockEnd: "var(--ds-space-025)" },
  marker: { minWidth: "20px" },
});

type Span = { kind: string; text: string };

/** Bold and inline code. Anything else is the author's own text, unchanged. */
function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.kind === "strong" ? (
          <Text key={i} weight="bold">
            {s.text}
          </Text>
        ) : s.kind === "code" ? (
          <Box key={i} as="span" xcss={styles.code}>
            <Text size="small">{s.text}</Text>
          </Box>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </>
  );
}

const HEADING_SIZE = ["large", "medium", "small", "small", "small", "small"] as const;

export function Markdown({ source }: { source: string }) {
  const parsed = blocks(source) as ReturnType<typeof blocks>;
  if (!parsed.length) return null;

  return (
    <Box xcss={styles.body}>
      <Stack space="space.100">
        {parsed.map((b: any, i: number) => {
          if (b.kind === "h") {
            return (
              <Box key={i} xcss={styles.h}>
                <Text size={HEADING_SIZE[Math.min(b.level, 6) - 1]} weight="bold">
                  <Spans spans={b.spans} />
                </Text>
              </Box>
            );
          }
          if (b.kind === "rule") return <Box key={i} xcss={styles.hairline} />;
          if (b.kind === "code") {
            return (
              <Box key={i} xcss={styles.pre}>
                <Text size="small">{b.text}</Text>
              </Box>
            );
          }
          if (b.kind === "quote") {
            return (
              <Box key={i} xcss={styles.quote}>
                <Text color="color.text.subtle">
                  <Spans spans={b.spans} />
                </Text>
              </Box>
            );
          }
          if (b.kind === "list") {
            return (
              <Stack key={i} space="space.025">
                {b.items.map((item: any, j: number) => (
                  <Box key={j} xcss={styles.item}>
                    <Inline space="space.075" alignBlock="start">
                      <Box xcss={styles.marker}>
                        <Text color="color.text.subtlest">
                          {item.checked === undefined ? (b.ordered ? `${j + 1}.` : "•") : item.checked ? "☑" : "☐"}
                        </Text>
                      </Box>
                      <Text>
                        <Spans spans={item.spans} />
                      </Text>
                    </Inline>
                  </Box>
                ))}
              </Stack>
            );
          }
          return (
            <Text key={i}>
              <Spans spans={b.spans} />
            </Text>
          );
        })}
      </Stack>
    </Box>
  );
}

/** Exported for the drawer's one-line preview. */
export { inlines };
