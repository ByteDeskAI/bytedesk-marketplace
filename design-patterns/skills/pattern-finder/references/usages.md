# Pattern Finder Usage

Use this reference when the user has a design problem but does not know which pattern to ask for.

## Invocation Modes

- Force discovery: identify whether the real problem is construction, behavior, structure, routing, transformation, endpoint behavior, or operations.
- Shortlist generation: produce a narrow set of likely patterns.
- Smell-to-pattern mapping: connect a repeated design smell to a candidate pattern.
- Language-sensitive search: restrict candidates to the user's language and idioms.
- No-pattern recommendation: explain why a simpler language feature or framework primitive is enough.

## Input Expectations

Extract these from the prompt or inspected code:

- what changes most often;
- what currently knows too much;
- whether the problem is local object design or cross-system integration;
- whether the user needs implementation now or only selection advice;
- language, framework, runtime, and delivery constraints.

## Output Contract

Use a tight shortlist:

1. Best-fit pattern.
2. One backup pattern.
3. One simpler alternative or "no pattern yet" path.
4. Signals that would change the recommendation.
5. Next lookup or implementation step.

Avoid long surveys unless explicitly requested.

Each shortlist item should include the force it addresses, why it may be wrong, and one observable sign in code or architecture that would confirm or reject it. Prefer three useful options over many shallow candidates.
