/** Write results and refusals, spoken once: a toast for the eye, the live region for the ear. */
import { useSyncExternalStore } from "react";

export type Tone = "ok" | "bad" | "warn" | "info";
export interface Toast { id: number; tone: Tone; title: string; detail?: string; ttl: number }

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function toast(tone: Tone, title: string, detail?: string, ttl = tone === "bad" ? 8000 : 4000) {
  const t: Toast = { id: ++seq, tone, title, detail, ttl };
  toasts = [...toasts, t].slice(-4);
  emit();
  setTimeout(() => dismiss(t.id), ttl);
  return t.id;
}
export function dismiss(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
  );
}
