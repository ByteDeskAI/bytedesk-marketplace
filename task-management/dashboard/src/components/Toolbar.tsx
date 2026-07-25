import { useState } from "react";
import Button from "@atlaskit/button/new";
import { cssMap } from "@atlaskit/css";
import { Box, Inline } from "@atlaskit/primitives/compiled";
import Select from "@atlaskit/select";
import Textfield from "@atlaskit/textfield";
import { EMPTY, isActive, labelOptions, loadViews, options, saveViews } from "../filters";
import type { Filters } from "../filters";
import type { Task } from "../types";

const styles = cssMap({
  bar: { paddingBlockEnd: "var(--ds-space-150)" },
  field: { minWidth: "140px" },
  search: { minWidth: "200px" },
});

type Opt = { label: string; value: string };
const opts = (values: string[]): Opt[] => values.map((v) => ({ label: v, value: v }));
const current = (v: string | null): Opt | null => (v ? { label: v, value: v } : null);

export function Toolbar({
  tasks,
  filters,
  onChange,
  onCreate,
}: {
  tasks: Task[];
  filters: Filters;
  onChange: (f: Filters) => void;
  onCreate: () => void;
}) {
  const [views, setViews] = useState(loadViews);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const saveCurrent = () => {
    const name = window.prompt("Save this view as");
    if (!name) return;
    const next = { ...views, [name]: filters };
    setViews(next);
    saveViews(next);
  };

  return (
    <Box xcss={styles.bar}>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Box xcss={styles.search}>
          <Textfield
            isCompact
            placeholder="Search id, title, label"
            value={filters.text}
            onChange={(e) => set({ text: (e.target as HTMLInputElement).value })}
          />
        </Box>
        {(["epic", "assignee", "actor", "priority"] as const).map((key) => (
          <Box key={key} xcss={styles.field}>
            <Select<Opt>
              isClearable
              spacing="compact"
              placeholder={key}
              options={opts(options(tasks, key))}
              value={current(filters[key])}
              onChange={(o) => set({ [key]: o?.value ?? null } as Partial<Filters>)}
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
            onChange={(o) => o && onChange(views[o.value])}
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
        <Button appearance="primary" onClick={onCreate}>
          Create task
        </Button>
      </Inline>
    </Box>
  );
}
