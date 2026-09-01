import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Icon-only: square, and `aria-label` is required. */
  icon?: ReactNode;
  pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", icon, pending, children, className, type = "button", disabled, ...rest },
  ref,
) {
  const iconOnly = Boolean(icon) && !children;
  return (
    <button
      ref={ref}
      type={type}
      className={["tm-btn", className].filter(Boolean).join(" ")}
      data-variant={variant}
      data-size={size}
      data-icon={iconOnly || undefined}
      data-pending={pending || undefined}
      disabled={disabled || pending}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
