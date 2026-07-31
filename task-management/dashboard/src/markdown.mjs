/**
 * A task body is markdown, and the board had nowhere to show it.
 *
 * This turns that markdown into a small block model. It deliberately does NOT produce HTML: the
 * renderer walks these blocks into React elements, so there is no `dangerouslySetInnerHTML` and
 * therefore no injection surface at all. A task body can come from a goal doc, a plan, an agent,
 * or a teammate's PR — untrusted enough that "we escape carefully" is the wrong answer when
 * "we never build a string" is available.
 *
 * ponytail: no markdown dependency. This handles the blocks that actually appear in a task body —
 * headings, paragraphs, lists, fenced code, quotes, rules — and treats anything else as a
 * paragraph, which renders as the author's own text rather than as a mistake. A real markdown
 * library is 40 KB to render text nobody writes tables in; swap one in if that stops being true.
 */

/** Inline runs. Bold and code only, because that is what bodies use and each is unambiguous. */
export function inlines(text) {
  const out = [];
  // One pass, alternating: **bold** or `code`, whichever comes first.
  const re = /(\*\*(?=\S)(.+?)(?<=\S)\*\*|`([^`\n]+)`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ kind: "strong", text: m[2] });
    else out.push({ kind: "code", text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.length ? out : [{ kind: "text", text }];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```\s*(\S*)\s*$/;
/** A task-check line, which acceptance criteria and goal docs both use. */
const CHECK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

/**
 * Markdown → blocks. Every block carries `kind`; text-bearing ones carry `spans` from `inlines`.
 *
 * Fenced code is taken verbatim, including blank lines and anything that looks like markup — a
 * body that documents a `# heading` inside a fence must not render it as one.
 */
export function blocks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;
  let quote = null;

  const flushPara = () => {
    if (!para.length) return;
    out.push({ kind: "p", spans: inlines(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(list);
    list = null;
  };
  const flushQuote = () => {
    if (!quote) return;
    out.push({ kind: "quote", spans: inlines(quote.join(" ")) });
    quote = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushAll();
      const lang = fence[1] || null;
      const body = [];
      i += 1;
      for (; i < lines.length && !FENCE.test(lines[i]); i += 1) body.push(lines[i]);
      out.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    if (RULE.test(line)) {
      flushAll();
      out.push({ kind: "rule" });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      flushAll();
      out.push({ kind: "h", level: h[1].length, spans: inlines(h[2]) });
      continue;
    }

    const q = QUOTE.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote = quote || [];
      quote.push(q[1]);
      continue;
    }
    flushQuote();

    // A checkbox is a bullet, so it has to be tested first.
    const c = CHECK.exec(line);
    if (c) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { kind: "list", ordered: false, items: [] };
      }
      list.items.push({ checked: c[1].toLowerCase() === "x", spans: inlines(c[2]) });
      continue;
    }

    const b = BULLET.exec(line);
    const n = NUMBER.exec(line);
    if (b || n) {
      flushPara();
      const ordered = Boolean(n);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { kind: "list", ordered, items: [] };
      }
      list.items.push({ spans: inlines(ordered ? n[2] : b[1]) });
      continue;
    }

    // A continuation of the current list item, not a new paragraph.
    if (list && /^\s+\S/.test(line)) {
      const item = list.items[list.items.length - 1];
      item.spans = inlines(`${item.spans.map((s) => s.text).join("")} ${line.trim()}`);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return out;
}

/** Plain text, for a one-line preview on a card. */
export function excerpt(markdown, max = 140) {
  const first = blocks(markdown).find((b) => b.kind === "p" || b.kind === "h");
  if (!first) return "";
  const text = first.spans.map((s) => s.text).join("");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
