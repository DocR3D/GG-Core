import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

/** Red = the expected action now (one at a time); the others are outlined; `danger` = destroys something. */
export function Button({
  primary = false,
  danger = false,
  small = false,
  type = 'button',
  children,
  ...rest
}: {
  primary?: boolean;
  danger?: boolean;
  small?: boolean;
  type?: 'button' | 'submit';
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const look = primary
    ? 'bg-red text-white hover:bg-red-light'
    : danger
      ? 'border border-red-light/60 text-red-light hover:border-red-light'
      : 'border border-line-strong text-text hover:border-text hover:text-white';
  return (
    <button
      type={type}
      className={`${small ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'} font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${look}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-w-0 border border-line-strong bg-surface px-2 py-1.5 text-white placeholder:text-muted disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = '', children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={`border border-line-strong bg-surface px-2 py-1.5 text-white disabled:opacity-50 ${className}`} {...rest}>
      {children}
    </select>
  );
}

export interface Notice {
  ok: boolean;
  text: string;
}

/**
 * Runs actions one at a time and keeps the last answer to show it (done, or why it was refused, as the API says).
 * `after` runs once an action succeeded (reload the data).
 */
export function useAction(after?: () => void) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await fn();
      setNotice({ ok: true, text: label });
      after?.();
      return result;
    } catch (e) {
      setNotice({ ok: false, text: `${label} : refusé. ${e instanceof ApiError ? e.message : ''}` });
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, run, clear: () => setNotice(null) };
}

export function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return <p className={notice.ok ? 'text-sm text-ok' : 'text-sm text-red-light'}>{notice.text}</p>;
}
