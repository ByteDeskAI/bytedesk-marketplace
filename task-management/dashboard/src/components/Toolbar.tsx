import { useEffect, useState } from "react";
import type { RefObject } from "react";
import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import { Box, Inline } from "@atlaskit/primitives/compiled";
import Select from "@atlaskit/select";
import Textfield from "@atlaskit/textfield";
import {
  EMPTY,
  isActive,
  labelOptions,
  loadViews,
  mergeViews,
  options,
  pushViews,
  saveViews,
} from "../filters";
import type { Filters } from "../filters";
import type { Task } from "../types";

const styles = cssMap({
  bar: { paddingBlockEnd: "var(--ds-space-150)" },
  field: { minWidth: "140px" },
  search: { minWidth: "200px" },
  epic: { minWidth: "200px" },
});

type Opt = { label: string; value: string };
const opts = (values: string[]): Opt[] =>
  values.map((v) => ({ label: v, value: v }));
const current = (v: string | null): Opt | null =>
  v ? { label: v, value: v } : null;

export function Toolbar({
  tasks,
  filters,
  onChange,
  onCreate,
  onCreateEpic,
  searchRef,
  epics = [],
  activeEpic = null,
  onActivate,
  grouped = false,
  onGrouped,
  savedViews,
}: {
  tasks: Task[];
  filters: Filters;
  onChange: (f: Filters) => void;
  onCreate: () => void;
  onCreateEpic?: () => void;
  /** `/` focuses the search field, so the owner of that shortcut needs a handle on it. */
  searchRef?: RefObject<HTMLInputElement>;
  epics?: { id: string; title: string; status: string }[];
  activeEpic?: string | null;
  onActivate?: (id: string) => void;
  grouped?: boolean;
  onGrouped?: (on: boolean) => void;
  /** The repo's saved views, off the board payload. */
  savedViews?: Record<string, Filters>;
}) {
  const [views, setViews] = useState(loadViews);

  // Adopt the repo's copy when the board brings it. Only on a real difference, or this sets state
  // on every poll.
  useEffect(() => {
    if (!savedViews) return;
    setViews((local) => {
      const merged = mergeViews(local, savedViews);
      if (JSON.stringify(merged) === JSON.stringify(local)) return local;
      saveViews(merged);
      return merged;
    });
  }, [savedViews]);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const saveCurrent = () => {
    const name = window.prompt("Save this view as");
    if (!name) return;
    const next = { ...views, [name]: filters };
    setViews(next);
    saveViews(next);
    void pushViews(next);
  };

  return (
    <Box xcss={styles.bar}>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Box xcss={styles.search}>
          <Textfield
            isCompact
            ref={searchRef}
            placeholder="Search id, title, label   /"
            aria-label="search the board"
            value={filters.text}
            onChange={(e) =>
              set({ text: (e.target as HTMLInputElement).value })
            }
          />
        </Box>
        {(["epic", "assignee", "actor", "priority", "type"] as const).map((key) => (
          <Box key={key} xcss={styles.field}>
            <Select<Opt>
              isClearable
              spacing="compact"
              placeholder={key}
              options={opts(options(tasks, key))}
              value={current(filters[key])}
              onChange={(o) =>
                set({ [key]: o?.value ?? null } as Partial<Filters>)
              }
            />
          </Box>
        ))}
        <Box xcss={styles.field}>
          <Select<Opt>
            isClearable
            spacing="compact"
            placeholder="label"
            options={opts(labelOptions(tasks))}
            value={current(filters.label)}
            onChange={(o) => set({ label: o?.value ?? null })}
          />
        </Box>
        <Box xcss={styles.field}>
          <Select<Opt>
            isClearable
            spacing="compact"
            placeholder="saved views"
            options={opts(Object.keys(views))}
            value={null}
            onChange={(o) => o && onChange({ ...EMPTY, ...views[o.value] })}
          />
        </Box>
        {isActive(filters) ? (
          <>
            <Button appearance="subtle" onClick={saveCurrent}>
              Save view
            </Button>
            <Button appearance="subtle" onClick={() => onChange(EMPTY)}>
              Clear
            </Button>
          </>
        ) : null}
        {/* Task creation is gated on an active epic. Until now the only way to change
            it was the CLI, so the board could create tasks but not say where they land. */}
        {onActivate && epics.some((e) => e.status !== "done") ? (
          <Box xcss={styles.epic}>
            <Select<Opt>
              spacing="compact"
              placeholder="active epic"
              options={epics
                .filter((e) => e.status !== "done")
                .map((e) => ({ label: `${e.id} ${e.title}`, value: e.id }))}
              value={
                activeEpic ? { label: activeEpic, value: activeEpic } : null
              }
              onChange={(o) => o && onActivate(o.value)}
            />
          </Box>
        ) : null}
        {onGrouped ? (
          <Button
            appearance={grouped ? "primary" : "subtle"}
            onClick={() => onGrouped(!grouped)}
          >
            {grouped ? "Grouped by epic" : "Group by epic"}
          </Button>
        ) : null}
        {onCreateEpic ? (
          <Button appearance="subtle" onClick={onCreateEpic}>
            Create epic
          </Button>
        ) : null}
        <Button appearance="primary" onClick={onCreate}>
          Create task
        </Button>
      </Inline>
    </Box>
  );
}
