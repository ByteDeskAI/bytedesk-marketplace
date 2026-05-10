import type { ComponentChildren } from 'preact';

export interface ButtonProps {
  variant?: 'default' | 'primary';
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  children: ComponentChildren;
}

export function Button({ variant = 'default', type = 'button', onClick, disabled, children }: ButtonProps) {
  const cls = variant === 'primary' ? 'btn btn--primary' : 'btn';
  return (
    <button class={cls} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
