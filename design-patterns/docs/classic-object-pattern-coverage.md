# Classic Object Pattern Coverage

This is a source-neutral coverage audit for the object-design baseline commonly organized as creational, structural, and behavioral patterns. The catalog itself remains organized by domain, group, language, relationship, and implementation guidance rather than by provenance.

## Python Coverage

Python is already a first-class language profile:

- `plugins/design-patterns/data/languages/python.md`
- every pattern in `plugins/design-patterns/data/patterns/*.md` includes `python` in its `languages` frontmatter
- `plugins/design-patterns/data/frameworks/python-celery-faststream.md` provides Python-specific integration implementation guidance

## Creational

- `abstract-factory`
- `builder`
- `factory-method`
- `prototype`
- `singleton`

## Structural

- `adapter`
- `bridge`
- `composite`
- `decorator`
- `facade`
- `flyweight`
- `proxy`

## Behavioral

- `chain-of-responsibility`
- `command`
- `interpreter`
- `iterator`
- `mediator`
- `memento`
- `observer`
- `state`
- `strategy`
- `template-method`
- `visitor`

## Validation

`scripts/validate_catalog.py` enforces that these object-design entries exist and that Python remains present across the pattern catalog.
