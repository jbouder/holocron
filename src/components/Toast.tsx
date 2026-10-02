import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export interface ToastMessage {
  id: string;
  text: string;
  undo?: () => void;
}

interface ToastProps {
  message: ToastMessage | null;
  onDismiss: () => void;
}

/**
 * Enter and exit are pure CSS: `.toast` transitions from display:none with
 * `@starting-style` and `transition-behavior: allow-discrete` (see index.css).
 * The element always exists; React only toggles the `open` class and content.
 */
export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <output className={`toast ${message ? 'open' : ''}`} aria-live="polite">
      <span className="min-w-0 flex-1 truncate text-sm">{message?.text}</span>
      {message?.undo && (
        <Button
          size="sm"
          variant="secondary"
          className="press"
          onClick={() => {
            message.undo?.();
            onDismiss();
          }}
        >
          Undo
        </Button>
      )}
    </output>
  );
}
