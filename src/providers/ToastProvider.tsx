import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { Toast, type ToastMessage } from '@/components/Toast';

interface ToastContextValue {
  show: (text: string, undo?: () => void) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  const show = useCallback((text: string, undo?: () => void) => {
    setMessage({ id: crypto.randomUUID(), text, undo });
  }, []);
  const dismiss = useCallback(() => setMessage(null), []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast message={message} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return ctx;
}
