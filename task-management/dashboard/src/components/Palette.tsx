import { useEffect, useMemo, useRef, useState } from "react";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import Modal, { ModalBody, ModalHeader, ModalTitle, ModalTransition } from "@atlaskit/modal-dialog";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import Textfield from "@atlaskit/textfield";
import { COLUMNS, filterCommands } from "../keys.mjs";
import type { Status, Task } from "../types";

export interface Command {
  key: string;
  label: string;
  hint?: string;
  id?: string;
  run: () => void;
}

const styles = cssMap({
  // Additive, not two variants: @compiled extracts styles statically, so a ternary
  // in `css` fails the build. The array form is the supported way to say "and also".
  row: {
    borderRadius: "var(--ds-radius-small)",
    cursor: "pointer",
    paddingInline: "var(--ds-space-100)",
    paddingBlock: "var(--ds-space-075)",
  },
  active: { backgroundColor: "var(--ds-background-selected)" },
  id: { fontFamily: "var(--ds-font-family-code)" },
  list: { maxHeight: "44vh", overflowY: "auto" },
});

/**
 * ⌘K. One list of board commands and every visible task, filtered by typing and
 * run with Enter.
 *
 * The point is not speed for its own sake: the board's actions were spread across
 * a toolbar, a drawer, a bulk bar and a drag gesture, so "set this to blocked" meant
 * knowing WHERE the control lived. A palette makes the whole write surface
 * addressable by name, which is also the only way to reach some of it without a mouse.
 */
export function Palette({
  isOpen,
  onClose,
  tasks,
  focused,
  commands,
  onOpenTask,
  onTransition,
}: {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  focused: string | null;
  commands: Command[];
  onOpenTask: (id: string) => void;
  onTransition: (id: string, status: Status) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setCursor(0);
    }
  }, [isOpen]);

  const rows: Command[] = useMemo(() => {
    // Card commands come first when a card is focused: the palette is usually
    // opened *about* something.
    const target = focused ? tasks.find((t) => t.id === focused) : null;
    const forTarget: Command[] = target
      ? COLUMNS.filter((s) => s !== target.status).map((status) => ({
          key: `move-${status}`,
          label: `Move ${target.id} to ${status.replace("_", " ")}`,
          hint: target.title,
          id: target.id,
          run: () => onTransition(target.id, status as Status),
        }))
      : [];
    const openers: Command[] = tasks.map((t) => ({
      key: `open-${t.id}`,
      label: t.title,
      hint: `${t.status}${t.assignee ? ` · @${t.assignee}` : ""}`,
      id: t.id,
      run: () => onOpenTask(t.id),
    }));
    return [...forTarget, ...commands, ...openers];
  }, [commands, focused, onOpenTask, onTransition, tasks]);

  const hits = useMemo(() => filterCommands(query, rows) as Command[], [query, rows]);
  const active = hits[Math.min(cursor, Math.max(0, hits.length - 1))];

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, query]);

  const run = (cmd?: Command) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  return (
    <ModalTransition>
      {isOpen ? (
        <Modal onClose={onClose} width="medium" label="Command palette">
          <ModalHeader>
            <ModalTitle>Command palette</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Stack space="space.100">
              <Textfield
                autoFocus
                placeholder="Type a command or a task…"
                value={query}
                aria-label="command or task"
                aria-controls="tm-palette-list"
                onChange={(e) => {
                  setQuery((e.target as HTMLInputElement).value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, hits.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    run(active);
                  }
                }}
              />
              <Box xcss={styles.list} ref={listRef}>
                <Stack space="space.025">
                  <div id="tm-palette-list" role="listbox" aria-label="matches">
                    {hits.length ? (
                      hits.map((cmd, i) => (
                        <div
                          key={cmd.key}
                          role="option"
                          aria-selected={cmd === active}
                          data-active={cmd === active}
                          css={[styles.row, cmd === active && styles.active]}
                          onMouseEnter={() => setCursor(i)}
                          onClick={() => run(cmd)}
                        >
                          <Inline space="space.100" alignBlock="center" spread="space-between">
                            <Inline space="space.100" alignBlock="center">
                              {cmd.id ? (
                                <Box xcss={styles.id}>
                                  <Text size="small" color="color.text.subtlest">
                                    {cmd.id}
                                  </Text>
                                </Box>
                              ) : null}
                              <Text>{cmd.label}</Text>
                            </Inline>
                            {cmd.hint ? (
                              <Text size="small" color="color.text.subtlest">
                                {cmd.hint}
                              </Text>
                            ) : null}
                          </Inline>
                        </div>
                      ))
                    ) : (
                      <Box xcss={styles.row}>
                        <Text color="color.text.subtlest">no match</Text>
                      </Box>
                    )}
                  </div>
                </Stack>
              </Box>
              <Inline space="space.100" alignBlock="center">
                <Lozenge>↑↓ choose</Lozenge>
                <Lozenge>↵ run</Lozenge>
                <Lozenge>esc close</Lozenge>
              </Inline>
            </Stack>
          </ModalBody>
        </Modal>
      ) : null}
    </ModalTransition>
  );
}
