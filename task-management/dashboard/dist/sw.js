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
const VERSION = "a70e554e594f";
const SHELL = "tm-shell-" + VERSION;
const DATA = "tm-data-" + VERSION;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/assets/atlassian-dark-C22RWu96.js","/assets/atlassian-dark-D-WqG4t5.js","/assets/atlassian-dark-D5NjCmap.js","/assets/atlassian-dark-Dtrl5SWs.js","/assets/atlassian-dark-future-B_i_YWfA.js","/assets/atlassian-dark-future-CCJR4psC.js","/assets/atlassian-dark-future-CPVklbuo.js","/assets/atlassian-dark-future-CszGLZU7.js","/assets/atlassian-dark-future-DXA6Ui-t.js","/assets/atlassian-dark-future-kx1PVUQl.js","/assets/atlassian-dark-gJgPx5Vn.js","/assets/atlassian-dark-increased-contrast-38MzS-41.js","/assets/atlassian-dark-increased-contrast-CajsUR0A.js","/assets/atlassian-dark-increased-contrast-D1GpcLgy.js","/assets/atlassian-dark-increased-contrast-DMwN24gI.js","/assets/atlassian-dark-increased-contrast-Oi8TkIGg.js","/assets/atlassian-dark-increased-contrast-TOHBKfHd.js","/assets/atlassian-dark-nBNbqyET.js","/assets/atlassian-light-B-KTqgZ8.js","/assets/atlassian-light-BiJrKHK4.js","/assets/atlassian-light-CC8xNmNd.js","/assets/atlassian-light-CvbVfuTh.js","/assets/atlassian-light-DBDWc_2-.js","/assets/atlassian-light-DRlJ33LC.js","/assets/atlassian-light-future-C1T507sp.js","/assets/atlassian-light-future-CGCgwG3T.js","/assets/atlassian-light-future-DIKfDR2M.js","/assets/atlassian-light-future-Dos-lLez.js","/assets/atlassian-light-future-DrmFY0BK.js","/assets/atlassian-light-future-haVDxNsm.js","/assets/atlassian-light-increased-contrast-Byw6qjE7.js","/assets/atlassian-light-increased-contrast-C3v4Is3c.js","/assets/atlassian-light-increased-contrast-Csul5nK1.js","/assets/atlassian-light-increased-contrast-Dg1KuTMS.js","/assets/atlassian-light-increased-contrast-DwbAWIvX.js","/assets/atlassian-light-increased-contrast-V2oFg0Uy.js","/assets/atlassian-motion-BGFm5CGC.js","/assets/atlassian-motion-CK5TsoOg.js","/assets/atlassian-motion-CwMvKRK-.js","/assets/atlassian-motion-DFw9FTZA.js","/assets/atlassian-motion-DrNBzO3S.js","/assets/atlassian-motion-mr1sIdfg.js","/assets/atlassian-shape-BSe0mfYC.js","/assets/atlassian-shape-Bf-lgf8R.js","/assets/atlassian-shape-By2JHheW.js","/assets/atlassian-shape-DOjPgp7P.js","/assets/atlassian-shape-DelOxayy.js","/assets/atlassian-shape-O8wvX12g.js","/assets/atlassian-spacing-1f3oj8Ec.js","/assets/atlassian-spacing-BNKpardO.js","/assets/atlassian-spacing-C6WUig3y.js","/assets/atlassian-spacing-CA3AXmrN.js","/assets/atlassian-spacing-CCtUtBQN.js","/assets/atlassian-spacing-D81JrCos.js","/assets/atlassian-typography-BCsuJgmx.js","/assets/atlassian-typography-CO8-bpbU.js","/assets/atlassian-typography-CTrKyUB-.js","/assets/atlassian-typography-Nrq6e1a7.js","/assets/atlassian-typography-Nzuktow3.js","/assets/atlassian-typography-fjKDk5VU.js","/assets/custom-theme-BxmPYXXv.js","/assets/custom-theme-C2oaPgtD.js","/assets/custom-theme-CSMzZcrq.js","/assets/custom-theme-ClIRwXKT.js","/assets/custom-theme-DJACIsNZ.js","/assets/custom-theme-yCUEVgjG.js","/assets/index-BEY3TEtk.js","/assets/index-CZIixFPL.css","/icons/icon-192.png","/icons/icon-512.png","/icons/maskable-512.png"];

/** The two reads worth keeping a copy of. Everything else is live or nothing. */
const isBoardData = (path) => path === "/api/board" || path.startsWith("/api/events");

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
  // The SSE stream must stay a live connection — caching it would hang the board.
  if (url.pathname === "/events") return;

  if (isBoardData(url.pathname)) {
    e.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
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
