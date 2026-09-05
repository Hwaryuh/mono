import { useState } from "react";

/** The errorMessage helper that used to be copy-pasted into each settings panel. Just stringifies non-Error values. */
export function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SettingsHeading({ title, description }: { title: string; description: string }) {
  return <header className="settings-heading"><strong>{title}</strong><p>{description}</p></header>;
}

/**
 * The pending/message/error + try/catch/finally wrapper that used to be copy-pasted into every settings panel.
 * `run(action, op)` sets pending to action, resets message/error, then runs op.
 * Inside op, set the success message directly via setMessage.
 */
export function useAsyncAction<Action extends string>() {
  const [pending, setPending] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action, operation: () => Promise<void>) {
    setPending(action);
    setMessage(null);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  return { pending, message, error, setMessage, setError, run };
}
