import { translate } from "../i18n/i18n";
import { StatusIndicator } from "@mono/ui";
import { useRouteError } from "react-router";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return translate("routeError.text.001");
}

export function RouteErrorScreen() {
  const error = useRouteError();
  // 로그만 남기고 재시도는 새로고침에 맡긴다. 별도 리포팅 붙일 때 여기 확장.
  console.error(error);

  return (
    <div className="route-error" role="alert">
      <StatusIndicator icon="alert" label={translate("routeError.text.002")} tone="danger" />
      <p>{errorMessage(error)}</p>
      <button onClick={() => window.location.reload()} type="button">{translate("routeError.text.003")}</button>
    </div>
  );
}
