import { useState } from 'preact/hooks';

export interface SearchFieldProps {
  placeholder?: string;
  initial?: string;
  onChange?: (value: string) => void;
}

// Search field — leverages .search-field CSS which renders a leading "/"
// glyph as the prompt. Placeholder is rendered all-caps for the
// mission-control look.
export function SearchField({ placeholder = 'SEARCH…', initial = '', onChange }: SearchFieldProps) {
  const [v, setV] = useState(initial);
  return (
    <div class="search-field" role="search">
      <input
        type="text"
        value={v}
        placeholder={placeholder}
        aria-label={placeholder}
        spellcheck={false}
        autocorrect="off"
        autocapitalize="off"
        onInput={(e) => {
          const next = (e.currentTarget as HTMLInputElement).value;
          setV(next);
          onChange?.(next);
        }}
      />
    </div>
  );
}
