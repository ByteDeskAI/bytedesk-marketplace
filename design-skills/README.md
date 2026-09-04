# design-skills

Design craft skills, split out of the old `design-system` plugin on 4 September 2026 when that
plugin became the thin eight-skill procedure set that lives in the design-system repository.

These twenty skills are general craft and carry no ByteDesk design content: motion and animation
(`animate`, `animate-expo`, `animation-vocabulary`, `find-animation-opportunities`,
`improve-animations`, `review-animations`), platform and web craft (`apple-design`,
`web-design-engineer`, `emil-design-eng`, `awwwards-creative-frontend`,
`awwwards-micro-interactions`, `awwwards-webgl-shaders`, `write-swift`), and composition and tooling
(`beautiful-article`, `web-video-presentation`, `prototype`, `pick-ui-library`, `gpt-image-2`,
`ask-sonner`, `kb-retriever`). The four specialist agents beside them are unchanged.

For anything about the ByteDesk design system itself — adopting it, syncing the vendored tree,
looking up a token, reviewing a diff against a profile, running the studio, cutting a release —
install `design-system@bytedesk` instead. It reads the published catalog and the consumer's own
tree at run time and carries no payload.

```
/plugin install design-skills@bytedesk
```

Versionless by design: every commit to this marketplace is a new version, so consumers update
without a bump. The upstream extraction of the same content lives in `ByteDeskAI/design-skills`.
