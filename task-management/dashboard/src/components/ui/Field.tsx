import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/** Label, control, hint, error — wired by id so a screen reader hears all of it. */
export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const describe = [hint && `${fid}-hint`, error && `${fid}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="tm-field">
      <label className="tm-field__label" htmlFor={fid}>{label}</label>
      {children({ id: fid, "aria-describedby": describe, ...(error ? { "aria-invalid": true as const } : {}) })}
      {hint && <span className="tm-field__hint" id={`${fid}-hint`}>{hint}</span>}
      {error && <span className="tm-field__error" id={`${fid}-err`} role="alert">{error}</span>}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  /** An icon on the left, a key hint on the right. */
  leading?: ReactNode;
  trailing?: ReactNode;
}
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ mono, leading, trailing, className, ...rest }, ref) {
  const input = <input ref={ref} className={["tm-input", className].filter(Boolean).join(" ")} data-mono={mono || undefined} {...rest} />;
  if (!leading && !trailing) return input;
  return (
    <span className="tm-input-wrap">
      {leading}
      {input}
      {trailing}
    </span>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function TextArea({ mono, className, ...rest }, ref) {
  return <textarea ref={ref} className={["tm-textarea", className].filter(Boolean).join(" ")} data-mono={mono || undefined} {...rest} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string; disabled?: boolean }[];
  /** A first, empty choice — for "any" / "none". */
  placeholder?: string;
}
/** Native select for a single choice: keyboard, touch and screen readers for free. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, placeholder, className, ...rest }, ref) {
  return (
    <select ref={ref} className={["tm-select", className].filter(Boolean).join(" ")} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  );
});
