import { StatusIndicator } from "@mono/ui";
import { useRouteError } from "react-router";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "알 수 없는 오류가 발생했습니다.";
}

export function RouteErrorScreen() {
  const error = useRouteError();
  // 로그만 남기고 재시도는 새로고침에 맡긴다. 별도 리포팅 붙일 때 여기 확장.
  console.error(error);

  return (
    <div className="route-error" role="alert">
      <StatusIndicator icon="alert" label="화면을 표시하지 못했습니다" tone="danger" />
      <p>{errorMessage(error)}</p>
      <button onClick={() => window.location.reload()} type="button">다시 시도</button>
    </div>
  );
}
