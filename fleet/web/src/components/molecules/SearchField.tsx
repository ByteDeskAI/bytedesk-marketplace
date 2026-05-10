import { useState } from 'preact/hooks';

export interface SearchFieldProps {
  placeholder?: string;
  initial?: string;
  onChange?: (value: string) => void;
}

export function SearchField({ placeholder = 'Search…', initial = '', onChange }: SearchFieldProps) {
  const [v, setV] = useState(initial);
  return (
    <div class="search-field">
      <input
        type="text"
        value={v}
        placeholder={placeholder}
        onInput={(e) => {
          const next = (e.currentTarget as HTMLInputElement).value;
          setV(next);
          onChange?.(next);
        }}
      />
    </div>
  );
}
