// markdown.ts — render claude's text parts as markdown.
//
// Pipeline: marked.parse → DOMPurify.sanitize → string for
// dangerouslySetInnerHTML. Defense in depth: claude's output is the
// only source today, but the sanitizer cheaply guards against future
// untrusted-text paths and ensures `<script>` / event handlers /
// `javascript:` URLs can't slip through.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
