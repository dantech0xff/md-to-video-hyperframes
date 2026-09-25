import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CircleX, Copy, Info, LoaderCircle } from "lucide-react";
import { errorText } from "../lib/api";

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" aria-label="Đang chạy" />;
}

export function Progress({ percent, indeterminate }: { percent?: number; indeterminate?: boolean }) {
  return (
    <div className={`progress${indeterminate ? " indeterminate" : ""}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
    </div>
  );
}

export function Banner({ kind = "info", children }: { kind?: "info" | "warn" | "error"; children: ReactNode }) {
  const Icon = kind === "error" ? CircleX : kind === "warn" ? AlertTriangle : Info;
  return (
    <div className={`banner ${kind === "info" ? "" : kind}`}>
      <Icon size={17} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return <Banner kind="error">{errorText(error)}</Banner>;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export function CopyButton({ text, label = "Copy", small = true }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      className={`btn${small ? " small" : ""}`}
      onClick={() => {
        void copyText(text).then(() => {
          setDone(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? "Đã copy" : label}
    </button>
  );
}

/** Loads data for a screen; `reload` fetches again without clearing what is shown. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data?: T; error?: unknown; loading: boolean; reload: () => Promise<void> } {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  // `deps` decide when to load again, like useEffect's
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await run();
      if (n === seq.current) setState({ data, loading: false });
    } catch (error) {
      if (n === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [run]);
  useEffect(() => {
    setState({ loading: true });
    void reload();
  }, [reload]);
  return { ...state, reload };
}

/** Runs an action with a busy flag and keeps its error for display. */
export function useAction(): { busy: boolean; error?: unknown; run: (fn: () => Promise<unknown>) => Promise<boolean>; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(undefined) };
}
