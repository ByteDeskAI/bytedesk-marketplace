import Button from "@atlaskit/button/new";
import DropdownMenu, {
  DropdownItem,
  DropdownItemGroup,
} from "@atlaskit/dropdown-menu";
import Lozenge from "@atlaskit/lozenge";
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
} from "@atlaskit/modal-dialog";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import Textfield from "@atlaskit/textfield";
import Toggle from "@atlaskit/toggle";
import { useState } from "react";
import { CATEGORIES } from "../pwa/notify.mjs";
import type { usePwa } from "../pwa/usePwa";

/**
 * Where preferences live.
 *
 * They had nowhere to live at all: the notification switch was a bare button in the status bar, the
 * group-by-epic toggle was loose in the toolbar, and everything else was in `localStorage` with no
 * surface. So a preference was invisible until you happened to find the control that owned it, and
 * it applied to one browser on one machine.
 *
 * Two menus rather than one, because they answer different questions — "who does this board think I
 * am" and "how should this board behave" — and merging them makes both harder to find.
 *
 * Everything here is written to the repo's own config, so it follows the project rather than the
 * browser. The one exception is the notification *permission*, which is a browser grant the page
 * cannot store on anyone's behalf; the board can only ask, so the modal says so plainly rather
 * than showing a switch that silently does nothing.
 */
export function SettingsMenu({
  pwa,
  grouped,
  onGrouped,
  actor,
}: {
  pwa: ReturnType<typeof usePwa>;
  grouped: boolean;
  onGrouped: (on: boolean) => void;
  actor: string | null;
}) {
  const [open, setOpen] = useState(false);
  const granted = pwa.permission === "granted";

  return (
    <>
      <Inline space="space.100" alignBlock="center">
        {/* Who the board thinks you are. `me` is what decides whether a task counts as "assigned
            to you" for notifications, and until now nothing displayed it. */}
        <DropdownMenu<HTMLButtonElement>
          trigger={pwa.me ? `@${pwa.me}` : "Profile"}
          label="Profile and identity"
        >
          <DropdownItemGroup title="Identity">
            <DropdownItem isDisabled>
              {pwa.me
                ? `You are @${pwa.me} on this board`
                : "No name set — notifications about your work cannot find you"}
            </DropdownItem>
            <DropdownItem
              isDisabled
            >{`The store sees this session as ${actor ?? "main"}`}</DropdownItem>
          </DropdownItemGroup>
          <DropdownItemGroup title="Preferences">
            <DropdownItem onClick={() => setOpen(true)}>Settings…</DropdownItem>
          </DropdownItemGroup>
        </DropdownMenu>

        <Button appearance="subtle" onClick={() => setOpen(true)}>
          Settings
        </Button>
      </Inline>

      <ModalTransition>
        {open ? (
          <Modal onClose={() => setOpen(false)}>
            <ModalHeader>
              <ModalTitle>Board settings</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.200">
                <Stack space="space.100">
                  <Text weight="bold" size="small" color="color.text.subtlest">
                    IDENTITY
                  </Text>
                  <Text size="small" color="color.text.subtlest">
                    Used to decide which changes are about your work.
                  </Text>
                  <Textfield
                    placeholder="your name on this board"
                    defaultValue={pwa.me ?? ""}
                    onBlur={(e) => {
                      const next = (e.target as HTMLInputElement).value.trim();
                      if (next !== (pwa.me ?? "")) pwa.setMe(next || null);
                    }}
                  />
                </Stack>

                <Stack space="space.100">
                  <Text weight="bold" size="small" color="color.text.subtlest">
                    NOTIFICATIONS
                  </Text>
                  {/* The grant is the browser's to give, not ours to store — say so instead of
                      offering switches that cannot fire. */}
                  {granted ? null : (
                    <Inline space="space.100" alignBlock="center">
                      <Lozenge appearance="moved">not permitted yet</Lozenge>
                      <Button
                        appearance="primary"
                        spacing="compact"
                        onClick={() => void pwa.askPermission()}
                      >
                        Allow notifications
                      </Button>
                    </Inline>
                  )}
                  {Object.entries(CATEGORIES).map(([key, description]) => (
                    <Inline
                      key={key}
                      space="space.100"
                      alignBlock="center"
                      spread="space-between"
                    >
                      <Text size="small">{description as string}</Text>
                      <Toggle
                        id={`notify-${key}`}
                        isChecked={pwa.categories.includes(key)}
                        isDisabled={!granted}
                        onChange={() => pwa.toggleCategory(key)}
                      />
                    </Inline>
                  ))}
                </Stack>

                <Stack space="space.100">
                  <Text weight="bold" size="small" color="color.text.subtlest">
                    BOARD
                  </Text>
                  <Inline
                    space="space.100"
                    alignBlock="center"
                    spread="space-between"
                  >
                    <Text size="small">Group cards by epic</Text>
                    <Toggle
                      id="grouped"
                      isChecked={grouped}
                      onChange={() => onGrouped(!grouped)}
                    />
                  </Inline>
                </Stack>

                <Text size="small" color="color.text.subtlest">
                  Saved to this repository, so they follow the project rather
                  than the browser.
                </Text>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="primary" onClick={() => setOpen(false)}>
                Done
              </Button>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </>
  );
}
