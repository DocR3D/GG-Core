import { useEffect, useState } from 'react';
import { API_ERROR_EVENT, ApiError } from '../lib/api';

interface Shown {
  id: number;
  title: string;
  reason: string;
  detail: string;
}

const STATUS: Record<number, string> = {
  0: 'serveur injoignable',
  400: 'demande invalide',
  401: 'connexion requise',
  403: 'accès refusé',
  404: 'introuvable',
  409: 'refusé (conflit)',
  500: 'erreur du serveur',
};

let next = 1;

/**
 * Errors popup (asked by the user, to diagnose): every API refusal and every uncaught error of the page, with the
 * API's reason, the request (method, address, what was sent) and a copy button. Also written to the browser
 * console; the backend logs the same refusals ("HTTP" lines of docker logs).
 */
export function ErrorPopups() {
  const [shown, setShown] = useState<Shown[]>([]);
  useEffect(() => {
    const push = (s: Omit<Shown, 'id'>) => setShown((list) => [...list.slice(-4), { ...s, id: next++ }]);
    const onApi = (e: Event) => {
      const err = (e as CustomEvent<ApiError>).detail;
      push({
        title: `Erreur ${err.status || ''} ${STATUS[err.status] ?? ''}`.replace(/\s+/g, ' ').trim(),
        reason: err.message,
        detail: `${err.method} ${err.path}${err.sent ? `\nenvoyé : ${err.sent}` : ''}\nréponse : ${err.status} ${err.message}\nà ${new Date().toLocaleTimeString('fr-FR')}`,
      });
    };
    const onError = (e: ErrorEvent) =>
      push({ title: 'Erreur de la page', reason: e.message, detail: `${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ''}` });
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ApiError) return; // already shown by the API event
      push({ title: 'Erreur de la page', reason: String(e.reason?.message ?? e.reason), detail: String(e.reason?.stack ?? '') });
    };
    window.addEventListener(API_ERROR_EVENT, onApi);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener(API_ERROR_EVENT, onApi);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  if (!shown.length) return null;
  const close = (id: number) => setShown((list) => list.filter((s) => s.id !== id));
  return (
    <div role="alert" className="fixed right-4 bottom-4 left-4 z-50 ml-auto flex max-w-md flex-col gap-2">
      {shown.map((s) => (
        <div key={s.id} className="border border-red-light/70 bg-surface p-3 text-sm shadow-lg">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-red-light">{s.title}</p>
              <p className="mt-1 break-words text-white">{s.reason}</p>
            </div>
            <button type="button" onClick={() => close(s.id)} className="text-muted hover:text-white" aria-label="Fermer">
              ✕
            </button>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted hover:text-white">Détails pour le diagnostic</summary>
            <pre className="mt-1 max-h-40 overflow-auto font-mono text-xs break-all whitespace-pre-wrap text-text">{s.detail}</pre>
            <button
              type="button"
              className="mt-1 text-xs text-muted underline hover:text-white"
              onClick={() => navigator.clipboard?.writeText(`${s.title} : ${s.reason}\n${s.detail}`).catch(() => undefined)}
            >
              Copier
            </button>
          </details>
        </div>
      ))}
      {shown.length > 1 && (
        <button type="button" className="self-end text-xs text-muted underline hover:text-white" onClick={() => setShown([])}>
          Tout fermer
        </button>
      )}
    </div>
  );
}
