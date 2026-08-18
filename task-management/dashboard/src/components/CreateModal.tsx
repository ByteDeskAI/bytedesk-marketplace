import { useEffect, useState } from "react";
import Button from "@atlaskit/button/new";
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle } from "@atlaskit/modal-dialog";
import Select from "@atlaskit/select";
import { Stack } from "@atlaskit/primitives/compiled";
import Textfield from "@atlaskit/textfield";
import TextArea from "@atlaskit/textarea";
import { fetchTemplate, fetchTemplates, write } from "../api";
import type { Epic, Priority, TemplateSummary } from "../types";

const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];
type Opt = { label: string; value: string };
const opts = (values: readonly string[]): Opt[] => values.map((v) => ({ label: v, value: v }));
const epicOpt = (e: Epic): Opt => ({ label: `${e.id} ${e.title}`, value: e.id });
const templateOpt = (t: TemplateSummary): Opt => ({
  label: t.description ? `${t.name} — ${t.description}` : t.name,
  value: t.name,
});

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
  const [template, setTemplate] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const openEpics = epics.filter((e) => e.status !== "done");
  const selectedEpic = openEpics.find((e) => e.id === epic);

  useEffect(() => {
    let live = true;
    void fetchTemplates()
      .then((rows) => live && setTemplates(Array.isArray(rows) ? rows : []))
      .catch(() => live && setTemplates([]));
    return () => {
      live = false;
    };
  }, []);

  const pickTemplate = (name: string | null) => {
    setTemplate(name);
    if (!name) return;
    void fetchTemplate(name)
      .then((tpl) => {
        if (typeof tpl?.body === "string") setBody(tpl.body);
      })
      .catch(() => {
        /* leave the textarea as the user has it */
      });
  };

  const submit = () => {
    run(() =>
      write.create({
        title: title.trim(),
        epic,
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(priority ? { priority } : {}),
        ...(template ? { template } : {}),
      }),
    );
    onClose();
  };

  const selectedTemplate = templates.find((t) => t.name === template);

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
          {templates.length ? (
            <Select<Opt>
              isClearable
              placeholder="template"
              options={templates.map(templateOpt)}
              value={selectedTemplate ? templateOpt(selectedTemplate) : null}
              onChange={(o) => pickTemplate(o?.value ?? null)}
            />
          ) : null}
          <Select<Opt>
            placeholder="epic"
            options={openEpics.map(epicOpt)}
            value={selectedEpic ? epicOpt(selectedEpic) : null}
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
