import type { ComponentChildren } from 'preact';

export interface ButtonProps {
  variant?: 'default' | 'primary';
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: ComponentChildren;
}

export function Button({ variant = 'default', type = 'button', onClick, disabled, title, children }: ButtonProps) {
  const cls = variant === 'primary' ? 'btn btn--primary' : 'btn';
  return (
    <button class={cls} type={type} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}
