import { useEffect, useState } from "react";
import { useToasts } from "../../lib/toast";

/** One polite live region for the whole app: write results and feed narration. */
export function LiveRegion() {
  const toasts = useToasts();
  const [text, setText] = useState("");
  useEffect(() => {
    const last = toasts[toasts.length - 1];
    if (last) setText([last.title, last.detail].filter(Boolean).join(". "));
  }, [toasts]);
  return <div className="sr-only" aria-live="polite" aria-atomic="true">{text}</div>;
}
