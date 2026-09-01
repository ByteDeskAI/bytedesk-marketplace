import { X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  /** What the chip encodes; picks the colour role. Status and priority read from `value`. */
  kind?: "status" | "priority" | "label" | "count" | "plain";
  value?: string;
  tone?: "ok" | "warn" | "bad" | "info" | "accent";
  /** Always render the dot: colour is never the only carrier, but the dot makes scanning fast. */
  dot?: boolean;
  onRemove?: () => void;
  children: ReactNode;
}

/** A dot and a word. Clickable when `onClick` is given, removable when `onRemove` is. */
export function Chip({ kind = "plain", value, tone, dot = kind === "status" || kind === "priority", onRemove, children, onClick, className, ...rest }: ChipProps) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      className={["tm-chip", className].filter(Boolean).join(" ")}
      data-kind={kind}
      data-value={value}
      data-tone={tone}
      onClick={onClick}
      {...(onClick ? { type: "button" } : {})}
      {...(rest as object)}
    >
      {dot && <span className="tm-chip__dot" aria-hidden />}
      {children}
      {onRemove && (
        <button type="button" className="tm-chip__x" aria-label={`remove ${String(children)}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <X size={12} />
        </button>
      )}
    </Tag>
  );
}
