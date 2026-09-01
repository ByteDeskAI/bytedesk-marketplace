import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { label } from "../../lib/keys.mjs";
import type { Status } from "../../lib/types";

/**
 * A card stopping needs a sentence — `tm block <id> <why>` stores it and both boards show it.
 * An inline field, never `window.prompt`. Empty is allowed: the CLI allows it too.
 */
export function StopReason({ target, onConfirm, onClose }: { target: { ids: string[]; status: Status } | null; onConfirm: (reason: string) => void; onClose: () => void }) {
  const [why, setWhy] = useState("");
  useEffect(() => {
    if (target) setWhy("");
  }, [target]);
  const open = Boolean(target);
  const status = target?.status ?? "blocked";
  const many = (target?.ids.length ?? 0) > 1;
  return (
    <Modal open={open} onClose={onClose} title={`Why ${many ? `${target!.ids.length} cards are` : `${target?.ids[0] ?? ""} is`} ${label(status)}`}>
      <form
        className="tm-stack"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(why.trim());
        }}
      >
        <Field label="reason" hint={`shown on the card and by tm show — the same sentence tm ${status === "blocked" ? "block" : "park"} would store`}>
          {(p) => <TextField {...p} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={status === "blocked" ? "waiting on …" : "parked because …"} autoFocus />}
        </Field>
        <div className="tm-row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit">{status === "blocked" ? "Block" : "Park"}</Button>
        </div>
      </form>
    </Modal>
  );
}
