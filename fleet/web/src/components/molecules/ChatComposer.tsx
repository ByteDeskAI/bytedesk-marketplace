// ChatComposer — shared textarea + send button for ChatTile and the
// main-tile chat body. Owns local draft + sending state; the host
// supplies the async onSend handler.

import { useState } from 'preact/hooks';

export interface ChatComposerProps {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({ onSend, disabled, placeholder }: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    try {
      await onSend(text);
      setDraft('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const inert = !!disabled || sending;

  return (
    <>
      <form
        class="chat-tile__composer"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <textarea
          class="chat-tile__input"
          rows={1}
          value={draft}
          placeholder={placeholder}
          disabled={inert}
          onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={onKeyDown as any}
        />
        <button
          type="submit"
          class="chat-tile__send"
          disabled={inert || !draft.trim()}
          title="Send (Enter)"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
      {err ? <div class="chat-tile__send-err">{err}</div> : null}
    </>
  );
}
