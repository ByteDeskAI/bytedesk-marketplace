import Button from "@atlaskit/button/new";
import DropdownMenu, {
  DropdownItem,
  DropdownItemGroup,
} from "@atlaskit/dropdown-menu";
import { Inline } from "@atlaskit/primitives/compiled";
import type { usePwa } from "../pwa/usePwa";

/**
 * Who the board thinks you are, and the door into the settings page.
 *
 * Preferences themselves live on SettingsPage — a modal was too small once policy,
 * ntfy and launch-browser joined identity.
 */
export function SettingsMenu({
  pwa,
  actor,
  onOpenSettings,
}: {
  pwa: ReturnType<typeof usePwa>;
  actor: string | null;
  onOpenSettings: () => void;
}) {
  return (
    <Inline space="space.100" alignBlock="center">
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
          <DropdownItem isDisabled>{`The store sees this session as ${actor ?? "main"}`}</DropdownItem>
        </DropdownItemGroup>
        <DropdownItemGroup title="Preferences">
          <DropdownItem onClick={onOpenSettings}>Settings…</DropdownItem>
        </DropdownItemGroup>
      </DropdownMenu>

      <Button appearance="subtle" onClick={onOpenSettings}>
        Settings
      </Button>
    </Inline>
  );
}
