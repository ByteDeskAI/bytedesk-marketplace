// markdown.ts — render claude's text parts as markdown.
//
// Pipeline: marked.parse → DOMPurify.sanitize → string for
// dangerouslySetInnerHTML. Defense in depth: claude's output is the
// only source today, but the sanitizer cheaply guards against future
// untrusted-text paths and ensures `<script>` / event handlers /
// `javascript:` URLs can't slip through.
//
// Also exports `<MarkdownText>` — a smart container used by per-tool
// visualizers (BDM-34) for fields that MAY contain markdown (sub-agent
// prompts, fetched-page summaries, free-form tool output). It renders
// markdown when markers are detected and falls back to a <pre> block
// to preserve indentation/whitespace for raw code-shaped text.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { JSX } from 'preact';

marked.setOptions({
  gfm: true,        // GitHub-flavored: tables, fenced code, autolinks
  breaks: true,     // soft \n inside paragraphs → <br> (matches chat UX)
});

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const raw = marked.parse(src) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    // Strip `target` rewriting / referrer policy entirely; default
    // sanitization is sufficient. ALLOWED_TAGS narrowed to the set
    // claude actually emits — no <iframe>, <object>, <form>, etc.
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'del', 's',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote',
      'pre', 'code',
      'a',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr',
      'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'title', 'class', 'lang'],
  });
}

// Heuristic: does this source string look like markdown? We check for
// the cheap-to-detect markers — fenced code blocks, ATX headers,
// list bullets, bold, links. False negatives are fine (we just fall
// back to <pre>); false positives are also fine (markdown handles
// plain prose gracefully).
const MARKDOWN_HINT = /(```|^#{1,6}\s|^\s*[-*]\s|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|^\s*\d+\.\s)/m;

export function looksLikeMarkdown(src: string): boolean {
  if (!src) return false;
  return MARKDOWN_HINT.test(src);
}

export interface MarkdownTextProps {
  src: string;
  /** Class applied when rendering as markdown (defaults to the chat
   * bubble's text class so headers/lists/code styles cascade). */
  markdownClass?: string;
  /** Class applied when falling back to <pre>. */
  preClass?: string;
}

/** Markdown-when-it-looks-like-markdown, <pre> otherwise. Used by
 *  visualizers that surface free-form text from claude (sub-agent
 *  prompts, fetched-page summaries, …). */
export function MarkdownText({
  src,
  markdownClass = 'message-bubble__text',
  preClass = 'viz-misc__pre',
}: MarkdownTextProps): JSX.Element | null {
  if (!src) return null;
  if (looksLikeMarkdown(src)) {
    return (
      <div
        class={markdownClass}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }}
      />
    );
  }
  return <pre class={preClass}>{src}</pre>;
}
