import { forwardRef, type HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  live?: boolean;
  changed?: boolean;
  selected?: boolean;
  pad?: "sm" | "md" | "none";
}

/** One surface. No card inside a card — a section rule separates, not a second box. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ interactive, live, changed, selected, pad = "md", className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={["tm-card", className].filter(Boolean).join(" ")}
      data-interactive={interactive || undefined}
      data-live={live || undefined}
      data-changed={changed || undefined}
      data-selected={selected || undefined}
      data-pad={pad === "md" ? undefined : pad}
      {...rest}
    />
  );
});
