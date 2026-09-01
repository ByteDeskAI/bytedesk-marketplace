import { blocks } from "../../lib/markdown.mjs";

type Span = { kind: "text" | "strong" | "code"; text: string };
type Block =
  | { kind: "h"; level: number; spans: Span[] }
  | { kind: "p"; spans: Span[] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: { spans: Span[]; checked?: boolean }[] }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "rule" };

const Spans = ({ spans }: { spans: Span[] }) => (
  <>
    {spans.map((r, i) => (r.kind === "strong" ? <strong key={i}>{r.text}</strong> : r.kind === "code" ? <code key={i}>{r.text}</code> : <span key={i}>{r.text}</span>))}
  </>
);

/** Block model → elements. No HTML string is ever built, so there is nothing to inject. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const items = blocks(source ?? "") as Block[];
  return (
    <div className={["tm-md", className].filter(Boolean).join(" ")}>
      {items.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const Tag = `h${Math.min(4, Math.max(1, b.level))}` as "h1" | "h2" | "h3" | "h4";
            return <Tag key={i}><Spans spans={b.spans} /></Tag>;
          }
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i}>
                {b.items.map((it, j) => (
                  <li key={j} data-check={it.checked == null ? undefined : String(it.checked)}>
                    {it.checked != null && <input type="checkbox" checked={it.checked} readOnly aria-label={it.checked ? "done" : "open"} />}
                    <span><Spans spans={it.spans} /></span>
                  </li>
                ))}
              </Tag>
            );
          }
          case "code":
            return <pre key={i} data-lang={b.lang ?? undefined}><code>{b.text}</code></pre>;
          case "quote":
            return <blockquote key={i}><Spans spans={b.spans} /></blockquote>;
          case "rule":
            return <hr key={i} />;
          default:
            return <p key={i}><Spans spans={(b as { spans: Span[] }).spans} /></p>;
        }
      })}
    </div>
  );
}
