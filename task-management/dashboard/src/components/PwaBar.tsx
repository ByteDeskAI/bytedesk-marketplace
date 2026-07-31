/**
 * The install prompt, the notification switches, and the state of the outbox.
 *
 * Plain <button> and <input type="checkbox"> on purpose: @atlaskit/button is not
 * a dependency of this app and a checkbox is a checkbox. The tokens do the
 * styling, so it still looks like the rest of the board in both schemes.
 */
import { useState } from "react";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { CATEGORIES } from "../pwa/notify.mjs";
import type { usePwa } from "../pwa/usePwa";

const styles = cssMap({
  button: {
    backgroundColor: "var(--ds-background-neutral)",
    borderRadius: "var(--ds-radius-small)",
    borderWidth: "0",
    color: "var(--ds-text)",
    cursor: "pointer",
    paddingBlock: "var(--ds-space-050)",
    paddingInline: "var(--ds-space-100)",
  },
  primary: {
    backgroundColor: "var(--ds-background-brand-bold)",
    borderRadius: "var(--ds-radius-small)",
    borderWidth: "0",
    color: "var(--ds-text-inverse)",
    cursor: "pointer",
    paddingBlock: "var(--ds-space-050)",
    paddingInline: "var(--ds-space-100)",
  },
  panel: {
    backgroundColor: "var(--ds-surface-raised)",
    borderRadius: "var(--ds-radius-medium)",
    boxShadow: "var(--ds-shadow-overlay)",
    padding: "var(--ds-space-200)",
    maxWidth: "420px",
  },
  banner: {
    backgroundColor: "var(--ds-background-information)",
    borderRadius: "var(--ds-radius-medium)",
    padding: "var(--ds-space-150)",
  },
  row: { cursor: "pointer" },
  input: {
    backgroundColor: "var(--ds-background-input)",
    borderColor: "var(--ds-border-input)",
    borderRadius: "var(--ds-radius-small)",
    borderStyle: "solid",
    borderWidth: "var(--ds-border-width)",
    color: "var(--ds-text)",
    paddingBlock: "var(--ds-space-050)",
    paddingInline: "var(--ds-space-075)",
  },
});

export function PwaBar({ pwa }: { pwa: ReturnType<typeof usePwa> }) {
  const [open, setOpen] = useState(false);
  const failed = pwa.queue.filter((e) => e.status === "failed");
  const queued = pwa.queue.filter((e) => e.status === "queued");
  const on = pwa.permission === "granted" && pwa.categories.length > 0;

  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        {pwa.stale ? <Lozenge appearance="moved">stale — server unreachable</Lozenge> : null}
        {queued.length ? <Lozenge appearance="inprogress">{`${queued.length} queued`}</Lozenge> : null}
        {failed.length ? <Lozenge appearance="removed">{`${failed.length} refused`}</Lozenge> : null}
        <button type="button" css={styles.button} onClick={() => setOpen(!open)} aria-expanded={open}>
          {on ? "🔔 notifications" : "🔕 notifications"}
        </button>
      </Inline>

      {/* Held until the user asks for it, and gone for good once dismissed. */}
      {pwa.installer ? (
        <Box xcss={styles.banner}>
          <Inline space="space.150" alignBlock="center" spread="space-between">
            <Text size="small">Install the board as an app — it keeps working when the server stops.</Text>
            <Inline space="space.075">
              <button type="button" css={styles.primary} onClick={() => void pwa.install()}>
                Install
              </button>
              <button type="button" css={styles.button} onClick={pwa.dismissInstall}>
                Not now
              </button>
            </Inline>
          </Inline>
        </Box>
      ) : null}

      {open ? (
        <Box xcss={styles.panel}>
          <Stack space="space.150">
            <Text weight="bold">Notify me when…</Text>

            {pwa.permission === "unsupported" ? (
              <Text size="small" color="color.text.subtlest">
                This browser has no Notification API. Everything else on the board still works.
              </Text>
            ) : pwa.permission === "denied" ? (
              <Text size="small" color="color.text.subtlest">
                Notifications are blocked for this site. Re-allow them in the browser's site settings.
              </Text>
            ) : pwa.permission !== "granted" ? (
              <Inline space="space.100" alignBlock="center">
                <button type="button" css={styles.primary} onClick={() => void pwa.askPermission()}>
                  Allow notifications
                </button>
                <Text size="small" color="color.text.subtlest">
                  Asked once, here — never on load.
                </Text>
              </Inline>
            ) : null}

            <Stack space="space.075">
              {Object.entries(CATEGORIES).map(([key, label]) => (
                <Box key={key} xcss={styles.row}>
                  <label>
                    <Inline space="space.075" alignBlock="center">
                      <input
                        type="checkbox"
                        checked={pwa.categories.includes(key)}
                        disabled={pwa.permission !== "granted"}
                        onChange={() => pwa.toggleCategory(key)}
                      />
                      <Text size="small">{label}</Text>
                    </Inline>
                  </label>
                </Box>
              ))}
            </Stack>

            {/* "Assigned to you" needs to know who you are; the store records a
                name, not a browser session. */}
            <Stack space="space.050">
              <Text size="small" color="color.text.subtlest">
                Your assignee name (for "assigned to you")
              </Text>
              <input
                css={styles.input}
                value={pwa.me ?? ""}
                placeholder="e.g. ryan"
                onChange={(e) => pwa.setMe(e.target.value.trim())}
              />
            </Stack>

            <Text size="small" color="color.text.subtlest">
              Blocked and stolen-claim alerts only fire for cards you watch — use ☆ on a card.
            </Text>

            {failed.length ? (
              <Stack space="space.075">
                <Text weight="bold" size="small">
                  Refused writes
                </Text>
                {failed.map((e) => (
                  <Inline key={e.key} space="space.075" alignBlock="center" shouldWrap>
                    <Text size="small">{`${e.taskId ?? "—"} ${e.action}: ${e.error}`}</Text>
                    <button type="button" css={styles.button} onClick={() => pwa.retryEntry(e.key)}>
                      Retry
                    </button>
                    <button type="button" css={styles.button} onClick={() => pwa.discardEntry(e.key)}>
                      Discard
                    </button>
                  </Inline>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}
