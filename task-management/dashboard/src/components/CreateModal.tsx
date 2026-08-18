import { useState } from "react";
import Button from "@atlaskit/button/new";
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle } from "@atlaskit/modal-dialog";
import Select from "@atlaskit/select";
import { Stack } from "@atlaskit/primitives/compiled";
import Textfield from "@atlaskit/textfield";
import TextArea from "@atlaskit/textarea";
import { write } from "../api";
import type { Epic, Priority } from "../types";

const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];
type Opt = { label: string; value: string };
const opts = (values: readonly string[]): Opt[] => values.map((v) => ({ label: v, value: v }));
const epicOpt = (e: Epic): Opt => ({ label: `${e.id} ${e.title}`, value: e.id });

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
  const openEpics = epics.filter((e) => e.status !== "done");
  const selected = openEpics.find((e) => e.id === epic);

  const submit = () => {
    run(() => write.create({ title: title.trim(), epic, ...(body.trim() ? { body: body.trim() } : {}), ...(priority ? { priority } : {}) }));
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
            options={openEpics.map(epicOpt)}
            value={selected ? epicOpt(selected) : null}
            onChange={(o) => setEpic(o?.value ?? null)}
          />
          <Select<Opt>
            isClearable
            placeholder="priority"
            options={opts(PRIORITIES)}
            value={priority ? { label: priority, value: priority } : null}
            onChange={(o) => setPriority(o?.value ?? null)}
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

/** New epic. Sets it active — same as `tm epic new`. */
export function CreateEpicModal({
  onClose,
  run,
}: {
  onClose: () => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const submit = () => {
    run(() =>
      write.createEpic({
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
      }),
    );
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>New epic</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.150">
          <Textfield
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
          <TextArea
            placeholder="Context (markdown body)"
            value={body}
            minimumRows={4}
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
