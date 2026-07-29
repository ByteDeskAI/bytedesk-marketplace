import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import Modal, { ModalBody, ModalHeader, ModalTitle, ModalTransition } from "@atlaskit/modal-dialog";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { PALETTE_HINT, keymapByGroup } from "../keys.mjs";

/** keys.mjs is plain JS on purpose (it is unit-tested); this is its shape. */
interface Binding {
  keys: string[];
  action: string;
  label: string;
  group: string;
}

const styles = cssMap({
  key: {
    backgroundColor: "var(--ds-background-neutral)",
    borderRadius: "var(--ds-radius-small)",
    fontFamily: "var(--ds-font-family-code)",
    paddingInline: "var(--ds-space-075)",
    paddingBlock: "var(--ds-space-025)",
  },
  row: { paddingBlock: "var(--ds-space-025)" },
  hint: { paddingBlockStart: "var(--ds-space-100)" },
});

const Key = ({ children }: { children: string }) => (
  <Box xcss={styles.key}>
    <Text size="small">{children}</Text>
  </Box>
);

/** The `?` sheet. Rendered from KEYMAP, so it cannot drift from what the keys do. */
export function Shortcuts({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <ModalTransition>
      {isOpen ? (
        <Modal onClose={onClose} width="medium" label="Keyboard shortcuts">
          <ModalHeader>
            <ModalTitle>Keyboard shortcuts</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Stack space="space.200">
              {(keymapByGroup() as { group: string; rows: Binding[] }[]).map(({ group, rows }) => (
                <Stack key={group} space="space.050">
                  <Text weight="bold" size="small" color="color.text.subtlest">
                    {group.toUpperCase()}
                  </Text>
                  {rows.map((row) => (
                    <Box key={row.action} xcss={styles.row}>
                      <Inline space="space.100" alignBlock="center">
                        <Inline space="space.050">
                          {row.keys.map((k: string) => (
                            <Key key={k}>{k}</Key>
                          ))}
                        </Inline>
                        <Text>{row.label}</Text>
                      </Inline>
                    </Box>
                  ))}
                </Stack>
              ))}
              <Box xcss={styles.hint}>
                <Inline space="space.100" alignBlock="center">
                  <Key>{PALETTE_HINT}</Key>
                  <Text>command palette — every board action by name</Text>
                </Inline>
              </Box>
              <Text size="small" color="color.text.subtlest">
                Shortcuts are off while you are typing in a field or a dialog is open. Columns are numbered left to
                right, so 1 is always in progress.
              </Text>
            </Stack>
          </ModalBody>
        </Modal>
      ) : null}
    </ModalTransition>
  );
}

/** One quiet line, so the shortcuts are discoverable without being a tour. */
export function KeyHint({ onHelp }: { onHelp: () => void }) {
  return (
    <Inline space="space.075" alignBlock="center">
      <Key>{PALETTE_HINT}</Key>
      <Text size="small" color="color.text.subtlest">
        commands ·
      </Text>
      <Button appearance="subtle" spacing="compact" onClick={onHelp}>
        ? shortcuts
      </Button>
    </Inline>
  );
}
