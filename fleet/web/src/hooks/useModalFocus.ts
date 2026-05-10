// useModalFocus — keyboard + screen-reader plumbing for modal dialogs (BDM-41).
//
// On mount: stores the previously-focused element, then focuses the first
//           focusable element inside the modal `ref`.
// While open: traps Tab / Shift+Tab inside the modal (Tab from last → first;
//             Shift+Tab from first → last).
// On unmount: restores focus to the previously-focused element.
//
// Pair with `role="dialog" aria-modal="true" aria-label="..."` on the modal
// element. The backdrop div is just a click target — the dialog role goes
// on the inner `.modal` div.

import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useModalFocus<T extends HTMLElement>(ref: RefObject<T>): void {
  useEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Defer one frame so child inputs render before we look for them.
    const focusFrame = window.setTimeout(() => {
      const els = focusableIn(modal);
      if (els.length > 0) els[0].focus();
      else modal.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = focusableIn(modal);
      if (els.length === 0) { e.preventDefault(); return; }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    modal.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusFrame);
      modal.removeEventListener('keydown', onKeyDown);
      // Restore focus only if the previously-focused element is still
      // attached and visible. Avoids ping-pong if the trigger unmounted.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [ref]);
}
