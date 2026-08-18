import { useState } from "react";
import Button from "@atlaskit/button/new";
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle } from "@atlaskit/modal-dialog";
import Select from "@atlaskit/select";
import { Stack } from "@atlaskit/primitives/compiled";
import Textfield from "@atlaskit/textfield";
import TextArea from "@atlaskit/textarea";
import { write } from "../api";
import { TYPES } from "../types";
import type { Epic, Priority } from "../types";

const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];
type Opt = { label: string; value: string };
const opts = (values: readonly string[]): Opt[] => values.map((v) => ({ label: v, value: v }));

export function CreateModal({
  epics,
  activeEpic,
  onClose,
  run,
}: {
  epics: Epic[];
  activeEpic: string | null;
  onClose: () => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [epic, setEpic] = useState<string | null>(activeEpic);
  const [priority, setPriority] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);

  const submit = () => {
    run(async () => {
      const created = await write.create({
        title: title.trim(),
        epic,
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(priority ? { priority } : {}),
      });
      if (type && created.id) {
        await write.act(created.id, "type", { type });
      }
    });
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>New task</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.150">
          <Textfield
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
          <Select<Opt>
            placeholder="epic"
            options={opts(epics.map((e) => e.id))}
            value={epic ? { label: epic, value: epic } : null}
            onChange={(o) => setEpic(o?.value ?? null)}
          />
          <Select<Opt>
            isClearable
            placeholder="priority"
            options={opts(PRIORITIES)}
            value={priority ? { label: priority, value: priority } : null}
            onChange={(o) => setPriority(o?.value ?? null)}
          />
          <Select<Opt>
            isClearable
            placeholder="type"
            options={opts([...TYPES])}
            value={type ? { label: type, value: type } : null}
            onChange={(o) => setType(o?.value ?? null)}
          />
          <TextArea
            placeholder="Context (markdown body)"
            value={body}
            minimumRows={3}
            onChange={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          Cancel
        </Button>
        <Button appearance="primary" isDisabled={!title.trim()} onClick={submit}>
          Create
        </Button>
      </ModalFooter>
    </Modal>
  );
}
