/**
 * The board's platform layer, as one hook: the service worker, notifications,
 * the offline outbox's replay loop, the install prompt, the badge.
 *
 * Everything decidable without a browser lives in notify.mjs and queue.mjs and
 * is unit-tested there. This file is only wiring.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CATEGORIES, notificationFor, recordSelfWrite } from "./notify.mjs";
import * as outbox from "./outbox.mjs";
import { loadPrefs, mergeServerPrefs, pushPrefs, savePrefs } from "./prefs.mjs";
import type { StoreEvent } from "../lib/types";

export type Entry = {
  key: string;
  method: string;
  url: string;
  body: unknown;
  taskId: string | null;
  action: string;
  ts: number;
  status: "queued" | "failed";
  code?: number;
  error?: string;
};

type Prefs = {
  categories: string[];
  me: string | null;
  watching: string[];
  installDismissed: boolean;
};

/** Chrome-only, and only sometimes. Typed narrowly so `strict` stays happy. */
type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

/**
 * Writes this tab made, so the SSE echo of its own change doesn't notify it.
 * Module-level for the same reason the outbox is: api.ts records into it.
 */
let selfWrites: { id: string; ts: number }[] = [];
export function markSelfWrite(id: string | null) {
  selfWrites = recordSelfWrite(selfWrites, id, Date.now());
}

export type Pwa = ReturnType<typeof usePwa>;

/**
 * The shell mounts usePwa once; every other screen reads that instance here. A module-level
 * mirror rather than context, because api.ts and the outbox already live at module level
 * and a provider would only exist to carry one object one level down.
 */
let shared: Pwa | null = null;
const sharedListeners = new Set<() => void>();
export function usePwaShared(): Pwa | null {
  return useSyncExternalStore(
    (fn) => {
      sharedListeners.add(fn);
      return () => sharedListeners.delete(fn);
    },
    () => shared,
  );
}

export function usePwa(events: StoreEvent[], inProgress: number) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [queue, setQueue] = useState<Entry[]>([]);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const [installer, setInstaller] = useState<InstallEvent | null>(null);
  const [stale, setStale] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);

  const update = useCallback((next: Prefs) => {
    savePrefs(next);
    setPrefs(next);
    // Write through to the repo. This is what stops notifications having to be switched on again
    // in every browser: the answer belongs to the project, not to this tab.
    void pushPrefs(next);
  }, []);

  /**
   * Adopt the store's copy when the board payload brings it.
   *
   * Only when it actually differs, or this sets state on every poll and re-renders the board
   * forever.
   */
  const adoptServerPrefs = useCallback((server: unknown) => {
    setPrefs((local) => {
      const merged = mergeServerPrefs(local, server);
      if (JSON.stringify(merged) === JSON.stringify(local)) return local;
      savePrefs(merged);
      return merged;
    });
  }, []);

  // ── notifications ──────────────────────────────────────────────────────────
  const show = useCallback(
    async (n: { title: string; body: string; tag: string }) => {
      if (
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        return;
      // Through the registration, not `new Notification()`: only the worker's copy
      // survives the tab being in the background, which is the whole point.
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg?.showNotification) return;
      await reg
        .showNotification(n.title, {
          body: n.body,
          tag: n.tag, // a repeat replaces its predecessor instead of stacking
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
        })
        .catch(() => {
          /* revoked mid-flight, or a platform that refuses — stay quiet */
        });
    },
    [],
  );

  const filter = useMemo(
    () => ({
      me: prefs.me,
      watching: new Set(prefs.watching),
      categories: new Set(prefs.categories),
    }),
    [prefs],
  );

  /** A refusal the board itself received, live or replayed. Same categories. */
  const announceRefusal = useCallback(
    (id: string | null, reason: string) => {
      const n = notificationFor(
        { event: "gate_refused", id, reason },
        { ...filter, self: [], now: Date.now() },
      );
      if (n) void show(n);
    },
    [filter, show],
  );

  /** Asked on a click, never on load. A silent "denied" is a fine outcome. */
  const askPermission = useCallback(async () => {
    if (typeof Notification === "undefined")
      return setPermission("unsupported");
    const result = await Notification.requestPermission().catch(
      () => "denied" as NotificationPermission,
    );
    setPermission(result);
    // Nobody switches notifications on in order to receive nothing.
    if (result === "granted" && !prefs.categories.length) {
      update({ ...prefs, categories: Object.keys(CATEGORIES) });
    }
  }, [prefs, update]);

  // Events arrive as a growing array; only the tail since the last render is new.
  useEffect(() => {
    if (!events.length) return;
    const stamp = (e: StoreEvent) => `${e.ts}|${e.event}|${e.id ?? ""}`;
    const latest = stamp(events[events.length - 1]);
    if (latest === seen) return;
    const at = seen === null ? -1 : events.findIndex((e) => stamp(e) === seen);
    setSeen(latest);
    if (seen === null) return; // the first load is history, not news
    const now = Date.now();
    for (const e of events.slice(at + 1)) {
      const n = notificationFor(e, { ...filter, self: selfWrites, now });
      if (n) void show(n);
    }
  }, [events, seen, filter, show]);

  // ── the worker ─────────────────────────────────────────────────────────────
  const replay = useCallback(
    () =>
      outbox.replay(
        async (entry: Entry) => {
          markSelfWrite(entry.taskId);
          try {
            const res = await fetch(entry.url, {
              method: entry.method,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(entry.body ?? {}),
            });
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            return { ok: res.ok, status: res.status, error: data.error };
          } catch {
            return { offline: true };
          }
        },
        (entry: Entry, result: { error?: string }) =>
          announceRefusal(
            entry.taskId,
            result.error || "the queued write was refused",
          ),
      ),
    [announceRefusal],
  );

  useEffect(() => {
    void outbox.hydrate();
    const stop = outbox.subscribe((q: Entry[]) => setQueue(q));
    // Not in dev: `npm run dev` serves the unsubstituted sw.js source straight
    // from the project root, and a worker caching the shell fights HMR anyway.
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return stop;
    // Registered after first paint: precaching the shell should not compete with it.
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        /* no worker support — the board is a plain SPA, which still works */
      });
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "replay") void replay();
      // The worker is the only thing that knows it answered from cache.
      if (e.data?.type === "stale") setStale(Boolean(e.data.value));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      stop();
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [replay]);

  useEffect(() => {
    const go = () => void replay();
    window.addEventListener("online", go);
    return () => window.removeEventListener("online", go);
  }, [replay]);

  // The browser being online says nothing about a 127.0.0.1 server being back,
  // so a non-empty queue gets its own slow retry. It stops when it drains.
  useEffect(() => {
    if (!queue.some((e) => e.status === "queued")) return;
    const t = setInterval(() => void replay(), 10_000);
    return () => clearInterval(t);
  }, [queue, replay]);

  // ── install prompt ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // hold it: unprompted, it fires once and is gone
      setInstaller(e as InstallEvent);
    };
    const onInstalled = () => setInstaller(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // ── badge ──────────────────────────────────────────────────────────────────
  // What you would otherwise reopen the tab to check: how much is in flight.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    void (
      inProgress ? nav.setAppBadge(inProgress) : nav.clearAppBadge?.()
    )?.catch(() => {});
  }, [inProgress]);

  const pendingByTask = useMemo(() => outbox.pendingByTask(), [queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const watching = useMemo(() => new Set(prefs.watching), [prefs.watching]);

  const api = {
    stale,
    queue,
    pendingByTask,
    replay,
    discardEntry: (key: string) => outbox.discardEntry(key),
    retryEntry: (key: string) => {
      outbox.retryEntry(key);
      void replay();
    },
    permission,
    askPermission,
    adoptServerPrefs,
    categories: prefs.categories,
    toggleCategory: (c: string) =>
      update({
        ...prefs,
        categories: prefs.categories.includes(c)
          ? prefs.categories.filter((x) => x !== c)
          : [...prefs.categories, c],
      }),
    me: prefs.me,
    setMe: (me: string | null) => update({ ...prefs, me: me || null }),
    watching,
    toggleWatch: (id: string) =>
      update({
        ...prefs,
        watching: watching.has(id)
          ? prefs.watching.filter((x) => x !== id)
          : [...prefs.watching, id],
      }),
    installer: prefs.installDismissed ? null : installer,
    install: async () => {
      if (!installer) return;
      await installer.prompt();
      await installer.userChoice;
      setInstaller(null);
    },
    dismissInstall: () => {
      setInstaller(null);
      update({ ...prefs, installDismissed: true });
    },
  };
  useEffect(() => {
    shared = api;
    for (const fn of sharedListeners) fn();
  });
  return api;
}
