import { useState } from "react";

/** 예전 각 설정 패널에 복붙돼 있던 errorMessage. Error가 아니면 문자열화만 한다. */
export function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SettingsHeading({ title, description }: { title: string; description: string }) {
  return <header className="settings-heading"><strong>{title}</strong><p>{description}</p></header>;
}

/**
 * 설정 패널마다 복붙되던 pending/message/error + try/catch/finally 래퍼.
 * `run(action, op)`가 pending을 action으로 세우고 message/error를 리셋한 뒤 op를 돌린다.
 * op 내부에서 성공 메시지는 setMessage로 직접 세운다.
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
