# Architecture Issue Scan Implementation Guidance

## Scan Checklist

Object-design risks:

- branching repeated across methods;
- constructors creating unrelated dependencies;
- domain code importing vendor SDKs;
- god services that coordinate unrelated workflows;
- inheritance used only for configuration;
- wrappers that change contracts rather than extend behavior.

Integration risks:

- producers knowing all consumers;
- no correlation identifier across async boundaries;
- no duplicate handling under retry;
- no terminal failure or dead-letter policy;
- schema or format version is implicit;
- routing rules are hidden in multiple consumers;
- observability depends on ad hoc logs.

## Severity Guidance

- P1: data loss, duplicate side effects, unrecoverable integration failure, or security/privacy exposure.
- P2: likely regression risk, brittle extension path, missing test seam, or opaque production support path.
- P3: maintainability smell with low immediate risk.

## Recommendation Rules

- Recommend the smallest pattern that removes the risk.
- Prefer language idioms and framework primitives over textbook shape.
- Name a pattern only when it changes the next implementation step.
- Always include a verification path.

