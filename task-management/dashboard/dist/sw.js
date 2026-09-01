/* eslint-disable no-undef */
/**
 * The board's service worker. Source file: build-pwa.mjs substitutes the version
 * and precache tokens below from the real build output and emits dist/sw.js.
 * Do not name those tokens in prose up here — a plain string replace would land
 * on the comment instead of the code, and ship a worker that cannot install.
 *
 * Three jobs, in order of how much they matter:
 *   1. show notifications while the tab is in the background
 *   2. serve the app shell offline, and the last board it saw, clearly stale
 *   3. nudge the page to replay queued writes when the network comes back
 *
 * Deliberately hand-written: a build-time-generated worker is ~90 lines, and a
 * framework for it would be the largest dependency in the plugin.
 */
const VERSION = "d8d41fcf28a0";
const SHELL = "tm-shell-" + VERSION;
const DATA = "tm-data-" + VERSION;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/assets/Activity-Ju_EL8Ev.js","/assets/Activity-pPaknp5j.css","/assets/Backlog-TR2Heu_l.js","/assets/Bars-Das7Ym5P.js","/assets/Board-BaMKXU0I.js","/assets/Capabilities-BizMv4P4.js","/assets/Capabilities-DwswHRFe.css","/assets/CapabilityInspector-DrVw-qYH.js","/assets/Checkbox-DbZRvnZu.js","/assets/Combobox-C6XVwyzR.js","/assets/CreateModals-or7O3o4a.js","/assets/DecisionInspector-cHjIGyHY.js","/assets/Decisions-B6BNzBGe.js","/assets/Decisions-DY4AgOjw.css","/assets/Doctor-BHy3s7fe.css","/assets/Doctor-BnEAHEsA.js","/assets/EmptyState-UeuRM5Cb.js","/assets/EpicInspector-4_nGjd12.js","/assets/Epics-CkZO6wmR.js","/assets/Graph-C3bS-yU0.css","/assets/Graph-sgSGjP_n.js","/assets/Help-DIUPDqQw.js","/assets/Help-DZxzRUow.css","/assets/InlineEdit-B0pGL2cw.js","/assets/KpiTile-B0aIFfJL.js","/assets/Markdown-D3EaqVXv.js","/assets/MarkdownEdit-UZ-CwPqZ.js","/assets/PlanPreview-O5l_vsuU.js","/assets/Plans-Bfev2dVZ.js","/assets/Plans-CY__11Qs.css","/assets/Progress-BZORtHou.js","/assets/Reports-C5Pmd-zH.css","/assets/Reports-meK1tD6S.js","/assets/Search-CFzQu0iF.js","/assets/Search-PN_LPO2n.css","/assets/Sessions-B53OA-cK.js","/assets/Sessions-CLWUoECS.css","/assets/Settings-Muz2HpUI.js","/assets/SprintInspector-BcoioVMH.js","/assets/Sprints-CwS8URDW.js","/assets/Standup-COBaK1-I.css","/assets/Standup-CvJ3omMP.js","/assets/Table-D5s_keJW.js","/assets/Tabs-dFhuTSNM.js","/assets/TaskInspector-C2lVR8fN.css","/assets/TaskInspector-C7IHiuTf.js","/assets/Toolbar-DkTNP5_X.js","/assets/detail-C2MF8KFZ.css","/assets/filters-CauvWfpR.js","/assets/index-BL4kAE7J.js","/assets/index-CUvmu5ry.css","/assets/lanes-Dbmpa1SZ.js","/assets/metrics-RCzJw4Z5.js","/assets/model-DBCuBtFp.css","/assets/model-DbSXO6aK.js","/assets/shared-CdIow3o6.js","/assets/sprints-9Lm-TYQn.css","/assets/types-CcbCguJB.js","/assets/vendor-BdezM1B8.js","/fonts/ibm-plex-mono-latin-400-normal.woff2","/fonts/ibm-plex-mono-latin-500-normal.woff2","/fonts/ibm-plex-sans-latin-400-normal.woff2","/fonts/ibm-plex-sans-latin-500-normal.woff2","/fonts/ibm-plex-sans-latin-600-normal.woff2","/icons/icon-192.png","/icons/icon-512.png","/icons/maskable-512.png"];

/**
 * The reads worth keeping a last-known copy of: the board itself, the log, and the
 * screens that render from one GET. Everything else is live or nothing — writes, the
 * SSE stream, a task's work stream, and an export (a stale export is a wrong file).
 */
const CACHED_READS = ["/api/board", "/api/events", "/api/meta", "/api/graph", "/api/time", "/api/claims", "/api/sessions", "/api/doctor", "/api/find", "/api/standup", "/api/skills"];
const isBoardData = (path) => CACHED_READS.some((p) => path === p || path.startsWith(p + "?") || path.startsWith(p + "/"));
const isLive = (path) => path === "/events" || path.endsWith("/stream") || path.startsWith("/api/export");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL && n !== DATA).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Writes are never cached, never replayed from here, never touched. Anything
  // that isn't a plain same-origin GET goes straight to the network.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The SSE streams must stay live connections — caching one would hang the board.
  if (isLive(url.pathname)) return;

  if (isBoardData(url.pathname)) {
    e.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/")) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname === "/manifest.webmanifest") {
    e.respondWith(cacheFirst(req));
  }
});

/** The hashed filename is the cache key — a changed asset is a different URL. */
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch (err) {
    // A navigation with nothing cached is the one case we can still answer.
    const shell = await caches.match("/index.html");
    if (shell) return shell;
    throw err;
  }
}

/**
 * Fresh if we can, last-known if we can't — and say which. The page reads
 * `X-TM-Stale` and marks the board rather than pretending it is live.
 */
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(DATA)).put(req, res.clone());
    ping("stale", false);
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (!hit) throw err;
    // The page cannot tell a cached board from a live one, and a board that
    // silently shows yesterday's cards is worse than no board. Both the header
    // and the message say so; the message is what the UI actually reads.
    ping("stale", true);
    const headers = new Headers(hit.headers);
    headers.set("X-TM-Stale", "1");
    return new Response(await hit.blob(), { status: 200, headers });
  }
}

/**
 * Background Sync, honestly: it fires when the *browser* regains connectivity,
 * which on a 127.0.0.1 board says nothing about whether the server is back. So
 * it is a nudge to any open tab, not a replay engine — the page owns the retry,
 * and with no tab open the queue simply waits for the next one.
 */
self.addEventListener("sync", (e) => {
  if (e.tag === "tm-replay") e.waitUntil(ping("replay"));
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

async function ping(type, value) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type, value });
}

/** Clicking a notification should land you on the board, not a second copy of it. */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) return open.focus();
      return self.clients.openWindow("/");
    }),
  );
});
