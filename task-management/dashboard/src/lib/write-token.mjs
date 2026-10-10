/**
 * TM-468: the board's write token, on every write this page sends.
 *
 * The server refuses a POST/PATCH without `x-tm-token`. The token reaches the page once, in the
 * fragment of the link `tm-dashboard` prints and opens (`/#tm-token=…`) — a fragment is never sent
 * to a server — and is kept in this origin's localStorage so a reload or a bookmark still writes.
 * The fragment is stripped at once so it does not linger in the address bar or history.
 *
 * One wrapper around `fetch`, rather than a header at each call site: api.ts, the PWA outbox
 * replay, prefs and saved views all write, and a site that forgot the header would fail only
 * after a restart rotated the token. Reads go out untouched; so does anything cross-origin.
 *
 * ponytail: plain JS so node:test can exercise it with a fake window.
 */
export const TOKEN_KEY = "tm.writeToken";
export const TOKEN_HEADER = "x-tm-token";

export function installWriteToken(win = globalThis) {
  let memory = null; // when storage is blocked, the token still lives for this page
  const read = () => {
    try {
      return win.localStorage.getItem(TOKEN_KEY) || memory;
    } catch {
      return memory;
    }
  };
  const loc = win.location;
  const found = /(?:^#|&)tm-token=([A-Za-z0-9_-]+)/.exec(loc.hash || "");
  if (found) {
    memory = found[1];
    try {
      win.localStorage.setItem(TOKEN_KEY, found[1]);
    } catch {
      /* private mode: memory only */
    }
    win.history.replaceState(win.history.state, "", loc.pathname + loc.search);
  }

  const base = win.fetch.bind(win);
  win.fetch = (input, init = {}) => {
    const method = String(init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    const token = read();
    if (method === "GET" || method === "HEAD" || !token) return base(input, init);
    const href = typeof input === "string" ? input : input?.url ?? String(input);
    if (new URL(href, loc.href).origin !== loc.origin) return base(input, init);
    const headers = new win.Headers(init.headers || (typeof input === "object" ? input?.headers : undefined));
    headers.set(TOKEN_HEADER, token);
    return base(input, { ...init, headers });
  };
}
