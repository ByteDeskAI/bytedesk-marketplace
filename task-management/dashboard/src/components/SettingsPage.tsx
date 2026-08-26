import Button from "@atlaskit/button/new";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import { cssMap } from "@atlaskit/css";
import Select from "@atlaskit/select";
import Textfield from "@atlaskit/textfield";
import Toggle from "@atlaskit/toggle";
import { useEffect, useState } from "react";
import { fetchSettings, write } from "../api";
import { CATEGORIES } from "../pwa/notify.mjs";
import type { usePwa } from "../pwa/usePwa";

const styles = cssMap({
  page: {
    paddingInline: "var(--ds-space-300)",
    paddingBlock: "var(--ds-space-200)",
    maxWidth: "720px",
    minHeight: "0",
    overflowY: "auto",
  },
  group: {
    paddingBlockStart: "var(--ds-space-200)",
    marginBlockStart: "var(--ds-space-100)",
    borderBlockStartWidth: "var(--ds-border-width)",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: "var(--ds-border)",
  },
});

type Field = {
  key: string;
  group: string;
  type: "boolean" | "integer" | "string" | "enum";
  label: string;
  help?: string;
  value: unknown;
  default?: unknown;
  readOnly?: boolean;
  min?: number;
  max?: number;
  options?: { value: unknown; label: string }[];
};

type Snapshot = {
  groups: { id: string; label: string; help?: string }[];
  fields: Field[];
  ntfy?: { token: string | null; active: boolean };
};

function FieldControl({
  field,
  onChange,
}: {
  field: Field;
  onChange: (key: string, value: unknown) => void;
}) {
  if (field.readOnly) {
    return (
      <Text size="small" color="color.text.subtlest">
        {field.value == null || field.value === "" ? "—" : String(field.value)}
      </Text>
    );
  }
  if (field.type === "boolean") {
    return (
      <Toggle
        id={field.key}
        isChecked={Boolean(field.value)}
        onChange={() => onChange(field.key, !field.value)}
      />
    );
  }
  if (field.type === "enum" && field.options) {
    const options = field.options.map((o) => ({
      label: o.label,
      value: String(o.value),
    }));
    const current = options.find((o) => o.value === String(field.value)) ?? null;
    return (
      <Select
        inputId={field.key}
        spacing="compact"
        options={options}
        value={current}
        onChange={(o) => {
          if (!o) return;
          const raw = field.options!.find((x) => String(x.value) === o.value)?.value;
          onChange(field.key, raw);
        }}
      />
    );
  }
  return (
    <Textfield
      id={field.key}
      isCompact
      type={field.type === "integer" ? "number" : "text"}
      defaultValue={field.value == null ? "" : String(field.value)}
      onBlur={(e) => {
        const raw = (e.target as HTMLInputElement).value;
        if (field.type === "integer") {
          const n = Number(raw);
          if (Number.isInteger(n)) onChange(field.key, n);
          return;
        }
        onChange(field.key, raw);
      }}
    />
  );
}

export function SettingsPage({
  pwa,
  onBack,
}: {
  pwa: ReturnType<typeof usePwa>;
  onBack: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const granted = pwa.permission === "granted";

  const reload = () => {
    void fetchSettings()
      .then((data) => setSnap(data as Snapshot))
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    reload();
  }, []);

  const save = (key: string, value: unknown) => {
    setError(null);
    void write
      .settings({ [key]: value })
      .then(() => reload())
      .catch((err: Error) => setError(err.message));
  };

  const byGroup = (id: string) => (snap?.fields ?? []).filter((f) => f.group === id);

  return (
    <Box xcss={styles.page}>
      <Stack space="space.200">
        <Inline space="space.100" alignBlock="center">
          <Button appearance="subtle" spacing="compact" onClick={onBack}>
            Back to board
          </Button>
          <Text weight="bold">Settings</Text>
          <Lozenge appearance="new">project-scoped</Lozenge>
        </Inline>
        <Text size="small" color="color.text.subtlest">
          These write to this repo&apos;s config.json, the same settings used by the project-local
          command. Identity is derived from git. The ntfy token stays in the environment.
        </Text>
        {error ? (
          <Text size="small" color="color.text.danger">
            {error}
          </Text>
        ) : null}

        {(snap?.groups ?? []).map((g) => (
          <Box key={g.id} xcss={styles.group}>
            <Stack space="space.100">
              <Text weight="bold" size="small" color="color.text.subtlest">
                {g.label.toUpperCase()}
              </Text>
              {g.help ? (
                <Text size="small" color="color.text.subtlest">
                  {g.help}
                </Text>
              ) : null}
              {g.id === "ntfy" && snap?.ntfy ? (
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance={snap.ntfy.token ? "success" : "moved"}>
                    {snap.ntfy.token ? "TM_NTFY_TOKEN set" : "TM_NTFY_TOKEN unset"}
                  </Lozenge>
                  <Lozenge appearance={snap.ntfy.active ? "success" : "default"}>
                    {snap.ntfy.active ? "pushes active" : "pushes inactive"}
                  </Lozenge>
                </Inline>
              ) : null}
              {byGroup(g.id).map((f) => (
                <Inline
                  key={f.key}
                  space="space.100"
                  alignBlock="center"
                  spread="space-between"
                >
                  <Stack space="space.050">
                    <Text size="small">{f.label}</Text>
                    {f.help ? (
                      <Text size="small" color="color.text.subtlest">
                        {f.help}
                      </Text>
                    ) : null}
                  </Stack>
                  <FieldControl field={f} onChange={save} />
                </Inline>
              ))}
            </Stack>
          </Box>
        ))}

        <Box xcss={styles.group}>
          <Stack space="space.100">
            <Text weight="bold" size="small" color="color.text.subtlest">
              THIS BROWSER
            </Text>
            <Text size="small" color="color.text.subtlest">
              Notification permission is a browser grant. It is not stored in the repo.
            </Text>
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
        </Box>
      </Stack>
    </Box>
  );
}
