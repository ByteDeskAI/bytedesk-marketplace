/** Who: initials for a person, a mono tag for an agent session. */
export function Avatar({ name, agent, size }: { name?: string | null; agent?: boolean; size?: "lg" }) {
  const label = (name || "?").trim();
  const initials = label.split(/[\s._-]+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("");
  return (
    <span className="tm-avatar" data-agent={agent || undefined} data-size={size} title={label} aria-label={label}>
      {initials || "?"}
    </span>
  );
}
