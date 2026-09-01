import { useEffect, useState } from "react";
import type { Meta } from "../../lib/types";

/** "in_progress" → "in progress"; the store's own column label when the meta payload names one. */
export function statusLabel(status: string | undefined, meta: Meta | null): string {
  if (!status) return "";
  return meta?.vocab.labels?.[status] ?? status.replace(/_/g, " ");
}

export const FALLBACK = {
  statuses: ["backlog", "open", "in_progress", "blocked", "parked", "done"],
  priorities: ["highest", "high", "medium", "low", "lowest"],
  types: ["task", "bug", "story", "spike", "chore"],
  linkTypes: ["blocks", "blocked by", "causes", "caused by", "duplicates", "duplicated by", "relates to"],
};

export const when = (iso?: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

/** One media query as state; the inspector uses it to decide side-by-side vs tabs. */
export function useMedia(query: string): boolean {
  const [ok, setOk] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setOk(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return ok;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
