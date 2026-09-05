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
const VERSION = "c50c381c8abe";
const SHELL = "tm-shell-" + VERSION;
const DATA = "tm-data-" + VERSION;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/assets/Activity-C0dlhE8r.js","/assets/Activity-pPaknp5j.css","/assets/Backlog-CfdzFSAc.js","/assets/Bars-CUguV5VS.js","/assets/Board-DAfQcsBC.js","/assets/Capabilities-D6j7N5LQ.css","/assets/Capabilities-eTPfD0pP.js","/assets/CapabilityInspector-BAK76UDT.js","/assets/Checkbox-UztiKWCj.js","/assets/Combobox-CRHUtuaY.js","/assets/CreateModals-DUTgNORT.js","/assets/DecisionInspector-_KPm8rbg.js","/assets/Decisions-DY4AgOjw.css","/assets/Decisions-pdEfgT4K.js","/assets/Doctor-BHy3s7fe.css","/assets/Doctor-aeJuDM4B.js","/assets/EmptyState-BY5gOeoA.js","/assets/EpicInspector-L3CRFLEl.js","/assets/Epics-BHCe3a3O.js","/assets/GoalPlanner-CS7iV1Zo.js","/assets/GoalPlanner-Cdv_VVGT.css","/assets/Graph-C3bS-yU0.css","/assets/Graph-CJErZ715.js","/assets/Help-BTTysM8a.css","/assets/Help-C4ASSYX-.js","/assets/InlineEdit-PGnUGVcL.js","/assets/Markdown-DD5RT7Gl.js","/assets/MarkdownEdit-DzO1KVkI.js","/assets/PlanPreview-xdBbrD-F.js","/assets/Plans-B9IR7tRu.js","/assets/Plans-CY__11Qs.css","/assets/Progress-BTFgC1rb.js","/assets/Reports-CHyh1iwg.css","/assets/Reports-DQO-aXUm.js","/assets/Search-BdghV5jR.js","/assets/Search-PN_LPO2n.css","/assets/Sessions-Blq5gy08.css","/assets/Sessions-CmLG9fvv.js","/assets/Settings-Dx5zURZa.js","/assets/SprintInspector-7dVKec3g.js","/assets/Sprints-CXV9Y6Hp.js","/assets/Standup-B5jDJSIC.css","/assets/Standup-ILgXqzu1.js","/assets/Table-DW2l6WIv.js","/assets/Tabs-DLTHjf7V.js","/assets/TaskInspector-C2lVR8fN.css","/assets/TaskInspector-KQ3aD1n0.js","/assets/Toolbar-UoW4gMZW.js","/assets/detail-CpwxV7UP.css","/assets/filters-C6LDBqpG.js","/assets/index-DCo8vAGI.css","/assets/index-VY0Rqjkw.js","/assets/lanes-Dbmpa1SZ.js","/assets/metrics-RCzJw4Z5.js","/assets/model-CQhTV-9a.js","/assets/model-DTbJdYND.css","/assets/shared-DGgEHN5q.js","/assets/sprints-9Lm-TYQn.css","/assets/sprints-DWinw8A4.js","/assets/types-CcbCguJB.js","/assets/vendor-BkmA2Gwp.js","/fonts/ibm-plex-mono-latin-400-normal.woff2","/fonts/ibm-plex-mono-latin-500-normal.woff2","/fonts/ibm-plex-sans-latin-400-normal.woff2","/fonts/ibm-plex-sans-latin-500-normal.woff2","/fonts/ibm-plex-sans-latin-600-normal.woff2","/icons/icon-192.png","/icons/icon-512.png","/icons/maskable-512.png"];

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
