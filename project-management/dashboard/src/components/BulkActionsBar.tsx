import Button from "@atlaskit/button";
import DropdownMenu, {
  DropdownItem,
  DropdownItemGroup,
} from "@atlaskit/dropdown-menu";
import Lozenge from "@atlaskit/lozenge";

interface BulkActionsBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  onBulkAction: (ids: string[], action: string) => void;
}

export default function BulkActionsBar({
  selectedIds,
  onClearSelection,
  onBulkAction,
}: BulkActionsBarProps) {
  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: "var(--ds-background-selected)",
        padding: "8px 24px",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <Lozenge appearance="inprogress">{selectedIds.length} selected</Lozenge>

      <DropdownMenu trigger="Actions">
        <DropdownItemGroup>
          <DropdownItem onClick={() => onBulkAction(selectedIds, "IN_PROGRESS")}>
            Move to In Progress
          </DropdownItem>
          <DropdownItem onClick={() => onBulkAction(selectedIds, "DONE")}>
            Mark as Done
          </DropdownItem>
        </DropdownItemGroup>
      </DropdownMenu>

      <Button appearance="subtle" onClick={onClearSelection}>
        Clear
      </Button>
    </div>
  );
}
