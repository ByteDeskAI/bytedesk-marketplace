/**
 * The work behind an in-progress task, beside the drawer.
 *
 * Read-only by construction: this component renders and nothing else. It has no input, no button
 * that reaches the server, and the only network call it makes is an EventSource GET. Watching a
 * run must never be a way to steer one.
 *
 * Messages arrive already shaped as TanStack AI `UIMessage`s — the server does the transcript
 * parsing — so the parts here are the library's own `text` / `tool-call` / `tool-result`. The
 * rendering is Atlaskit, like every other surface on this board: `@tanstack/ai-react` ships hooks
 * and stream adapters rather than chat components, and its hooks are built around *sending*, which
 * is the one thing this panel must not do.
 */
import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "@tanstack/ai";
import Badge from "@atlaskit/badge";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";

/** What the server sends: the library's message model, plus why the stream might be empty. */
interface StreamPayload {
  messages: Array<UIMessage & { createdAt?: string | null; sidechain?: boolean }>;
  session: string | null;
  file: string | null;
  reason: string | null;
}

const styles = cssMap({
  panel: {
    backgroundColor: "var(--ds-surface-sunken)",
    borderRadius: "var(--ds-radius-medium)",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minWidth: "0", // lets the flex child shrink instead of forcing the drawer off-screen
    overflow: "hidden",
    padding: "var(--ds-space-150)",
  },
  scroll: { flexGrow: 1, minHeight: "0", overflowY: "auto" },
  message: {
    backgroundColor: "var(--ds-surface)",
    borderRadius: "var(--ds-radius-small)",
    padding: "var(--ds-space-100)",
  },
  tool: {
    backgroundColor: "var(--ds-background-neutral-subtle)",
    borderInlineStartColor: "var(--ds-border-accent-blue)",
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: "var(--ds-border-width-selected)",
    paddingInlineStart: "var(--ds-space-100)",
  },
  /** A failed tool call, as its own complete rule: cssMap values are opaque handles, so the
   *  error variant cannot be spread on top of `tool` — it has to stand alone. */
  toolFailed: {
    backgroundColor: "var(--ds-background-neutral-subtle)",
    borderInlineStartColor: "var(--ds-border-accent-red)",
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: "var(--ds-border-width-selected)",
    paddingInlineStart: "var(--ds-space-100)",
  },
  code: {
    fontFamily: "var(--ds-font-family-code)",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
});

const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

function Part({ part }: { part: any }) {
  if (part.type === "text") {
    return (
      <Box xcss={styles.code}>
        <Text size="small">{part.text}</Text>
      </Box>
    );
  }
  if (part.type === "tool-call") {
    const args = Object.values(part.args ?? {}).filter(Boolean) as string[];
    return (
      <Box xcss={styles.tool}>
        <Inline space="space.075" alignBlock="center" shouldWrap>
          <Lozenge appearance="inprogress">{part.toolName}</Lozenge>
          {args.length ? (
            <Box xcss={styles.code}>
              <Text size="small" color="color.text.subtlest">
                {args[0]}
              </Text>
            </Box>
          ) : null}
        </Inline>
      </Box>
    );
  }
  if (part.type === "tool-result") {
    if (!part.result) return null;
    return (
      <Box xcss={part.isError ? styles.toolFailed : styles.tool}>
        <Box xcss={styles.code}>
          <Text size="small" color={part.isError ? "color.text.danger" : "color.text.subtlest"}>
            {part.result}
          </Text>
        </Box>
      </Box>
    );
  }
  return null; // an unknown part type is a newer Claude Code, not a crash
}

export function WorkStream({ taskId }: { taskId: string }) {
  const [payload, setPayload] = useState<StreamPayload | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const src = new EventSource(`/api/task/${taskId}/stream`);
    src.onmessage = (e) => {
      try {
        setPayload(JSON.parse(e.data) as StreamPayload);
      } catch {
        /* a truncated frame; the next push is a whole one */
      }
    };
    return () => src.close();
  }, [taskId]);

  // Follow the tail, the way a log viewer does.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [payload]);

  const messages = payload?.messages ?? [];

  return (
    <Box xcss={styles.panel}>
      <Stack space="space.100">
        <Inline space="space.075" alignBlock="center">
          <Text size="small" weight="bold" color="color.text.subtlest">
            WORK
          </Text>
          <Badge>{messages.length}</Badge>
          {payload?.session ? <Lozenge appearance="success">live</Lozenge> : null}
        </Inline>
      </Stack>
      <Box xcss={styles.scroll}>
        <Stack space="space.100">
          {messages.length ? (
            messages.map((m) => (
              <Box key={m.id} xcss={styles.message}>
                <Stack space="space.075">
                  <Inline space="space.075" alignBlock="center">
                    <Text size="small" weight="medium" color="color.text.subtlest">
                      {m.role}
                    </Text>
                    {m.sidechain ? <Lozenge appearance="moved">subagent</Lozenge> : null}
                    <Text size="small" color="color.text.subtlest">
                      {clock(m.createdAt)}
                    </Text>
                  </Inline>
                  {m.parts.map((p, i) => (
                    <Part key={i} part={p} />
                  ))}
                </Stack>
              </Box>
            ))
          ) : (
            <Text size="small" color="color.text.subtlest">
              {payload ? (payload.reason ?? "nothing yet — this task holds a claim but the session has not written") : "connecting…"}
            </Text>
          )}
          <div ref={bottom} />
        </Stack>
      </Box>
    </Box>
  );
}
