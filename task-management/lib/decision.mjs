/**
 * Decision-map tickets: labels, HITL vs AFK, and the ## Answer that closing requires.
 *
 * Shared by the done gate, MCP, and the dashboard so a card, a drawer and `tm done`
 * cannot disagree about whether an answer exists.
 */
export const DECISION_KIND = [
  "decision:interview",
  "decision:research",
  "decision:prototype",
  "decision:unblock",
];

export const MAP_HEADINGS = [
  "Destination",
  "Notes",
  "Decisions so far",
  "Not yet specified",
  "Out of scope",
];

export function decisionRole(labels = []) {
  return (labels || []).find((l) => DECISION_KIND.includes(l)) || null;
}

/** HITL vs AFK — derived from the role, never from status. */
export function attentionOf(role) {
  if (!role) return null;
  return role === "decision:research" ? "AFK" : "HITL";
}

/**
 * Split a markdown body on `##` headings. Leading text before the first heading
 * is `{ heading: null }`.
 */
export function sectionsOf(body) {
  const src = String(body || "").replace(/\r\n/g, "\n");
  if (!src.trim()) return [];
  const re = /^##\s+(.+?)\s*$/gm;
  const parts = [];
  let heading = null;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (heading !== null) parts.push({ heading, body: src.slice(last, m.index).trim() });
    else if (m.index > 0 && src.slice(0, m.index).trim()) {
      parts.push({ heading: null, body: src.slice(0, m.index).trim() });
    }
    heading = m[1].trim();
    last = m.index + m[0].length;
  }
  if (heading !== null) parts.push({ heading, body: src.slice(last).trim() });
  else parts.push({ heading: null, body: src.trim() });
  return parts;
}

/** Text under `## Answer`, or null when that heading is missing. Empty string if present but blank. */
export function answerOf(body) {
  const ans = sectionsOf(body).find((s) => /^answer$/i.test(s.heading || ""));
  if (!ans) return null;
  return ans.body;
}

export function hasAnswer(body) {
  return Boolean(answerOf(body));
}

/** Replace or append the `## Answer` section. Other headings stay put. */
export function setAnswer(body, answer) {
  const parts = sectionsOf(body);
  const text = String(answer || "").trim();
  const idx = parts.findIndex((s) => /^answer$/i.test(s.heading || ""));
  if (idx >= 0) parts[idx] = { heading: "Answer", body: text };
  else parts.push({ heading: "Answer", body: text });
  return (
    parts
      .map((p) => (p.heading ? `## ${p.heading}\n\n${p.body}`.trim() : p.body))
      .filter(Boolean)
      .join("\n\n")
      .trim() + "\n"
  );
}
