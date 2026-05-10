// AskUserQuestionCard — structured form for claude's `AskUserQuestion`
// tool when it appears as a tool-call in chat (BDM-33). Replaces the
// generic JSON-dump card with radio/checkbox UI.
//
// Submit constructs an arrow-key sequence and POSTs it via
// useFleetChat's sendKeys helper, which lands as
//   tmux send-keys -t <session> Down Down Enter ...
// driving claude's CLI list-picker. This is brittle to claude's CLI
// redesigning the picker — if it stops accepting Up/Down/Space/Enter
// on a list, this component is the place to update.

import { useMemo, useState } from 'preact/hooks';
import type { UIPart } from '../../api';

export interface AskUserQuestionCardProps {
  part: UIPart;
  onSubmit: (keys: string[]) => Promise<void>;
}

interface QuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

const MAX_LIST = 32; // upper bound for the leading "Up" volley to force cursor to position 0

export function AskUserQuestionCard({ part, onSubmit }: AskUserQuestionCardProps) {
  const questions = (part.input?.questions as Question[] | undefined) ?? [];
  // selections[q] = number for single, number[] for multi
  const [selections, setSelections] = useState<Record<number, number | number[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submitted = part.state === 'done' || part.state === 'error';
  const ready = useMemo(() => {
    return questions.every((q, qi) => {
      const sel = selections[qi];
      if (q.multiSelect) return Array.isArray(sel) && sel.length > 0;
      return typeof sel === 'number';
    });
  }, [questions, selections]);

  const onChangeSingle = (qi: number, oi: number) => {
    setSelections((s) => ({ ...s, [qi]: oi }));
  };
  const onToggleMulti = (qi: number, oi: number) => {
    setSelections((s) => {
      const cur = (s[qi] as number[] | undefined) ?? [];
      const has = cur.includes(oi);
      const next = has ? cur.filter((x) => x !== oi) : [...cur, oi];
      return { ...s, [qi]: next };
    });
  };

  const submit = async () => {
    if (!ready || submitting || submitted) return;
    setSubmitting(true);
    setErr(null);
    try {
      const keys = buildKeySequence(questions, selections);
      await onSubmit(keys);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div class="auq-card auq-card--submitted">
        <header class="auq-card__head">AskUserQuestion · answered</header>
        <pre class="auq-card__answer">{part.output || '(no answer captured)'}</pre>
      </div>
    );
  }

  return (
    <div class="auq-card">
      <header class="auq-card__head">AskUserQuestion</header>
      {questions.map((q, qi) => (
        <fieldset key={qi} class="auq-card__question">
          <legend class="auq-card__legend">
            {q.header ? <span class="auq-card__chip">{q.header}</span> : null}
            <span class="auq-card__qtext">{q.question}</span>
            {q.multiSelect ? <span class="auq-card__multi">(multi)</span> : null}
          </legend>
          <ul class="auq-card__options">
            {q.options.map((opt, oi) => {
              const selected = q.multiSelect
                ? Array.isArray(selections[qi]) && (selections[qi] as number[]).includes(oi)
                : selections[qi] === oi;
              return (
                <li key={oi} class={`auq-card__opt ${selected ? 'is-selected' : ''}`}>
                  <label>
                    <input
                      type={q.multiSelect ? 'checkbox' : 'radio'}
                      name={`auq-${qi}`}
                      checked={selected}
                      disabled={submitting}
                      onChange={() =>
                        q.multiSelect ? onToggleMulti(qi, oi) : onChangeSingle(qi, oi)
                      }
                    />
                    <span class="auq-card__label">{opt.label}</span>
                    {opt.description ? (
                      <span class="auq-card__desc">{opt.description}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
      <div class="auq-card__actions">
        <button
          type="button"
          class="auq-card__submit"
          onClick={submit}
          disabled={!ready || submitting}
        >
          {submitting ? 'submitting…' : 'Submit'}
        </button>
        {err ? <span class="auq-card__err">{err}</span> : null}
      </div>
      <p class="auq-card__hint">Sends arrow keys + Enter to claude's TUI. If the picker is in an unexpected state, switch to terminal mode and answer there.</p>
    </div>
  );
}

// buildKeySequence — turn the user's selections into a tmux key
// stream. For each question:
//   - "Up × MAX_LIST" to force the cursor to position 0 (idempotent)
//   - For single-select: "Down × N" to land on N, then Enter.
//   - For multi-select: navigate to each chosen index, Space to toggle,
//     then a final Enter to commit.
function buildKeySequence(
  questions: Question[],
  selections: Record<number, number | number[]>,
): string[] {
  const out: string[] = [];
  questions.forEach((q, qi) => {
    // Force cursor to top of list.
    for (let i = 0; i < MAX_LIST; i++) out.push('Up');
    if (q.multiSelect) {
      const chosen = ((selections[qi] as number[] | undefined) ?? []).slice().sort((a, b) => a - b);
      let cur = 0;
      for (const target of chosen) {
        for (let i = cur; i < target; i++) out.push('Down');
        out.push('Space');
        cur = target;
      }
      out.push('Enter');
    } else {
      const target = selections[qi] as number;
      for (let i = 0; i < target; i++) out.push('Down');
      out.push('Enter');
    }
  });
  return out;
}
