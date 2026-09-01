/** A key, drawn like a key. */
export const Kbd = ({ children }: { children: string }) => <kbd className="tm-kbd">{children}</kbd>;

/** "⌘K / Ctrl-K" and friends: a run of keys with separators. */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="tm-row" style={{ gap: "var(--tm-s1)" }}>
      {keys.map((k, i) => (
        <span key={k} className="tm-row" style={{ gap: "var(--tm-s1)" }}>
          {i > 0 && <span className="tm-faint">/</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}
