import { translate } from "../i18n/i18n";
import { errorMessage } from "../i18n/error-message";
import { StatusIndicator } from "@mono/ui";
import { useRouteError } from "react-router";

export function RouteErrorScreen() {
  const error = useRouteError();
  // 로그만 남기고 재시도는 새로고침에 맡긴다. 별도 리포팅 붙일 때 여기 확장.
  console.error(error);

  return (
    <div className="route-error" role="alert">
      <StatusIndicator icon="alert" label={translate("routeError.title")} tone="danger" />
      <p>{errorMessage(error, "routeError.unknown")}</p>
      <button onClick={() => window.location.reload()} type="button">{translate("routeError.retry")}</button>
    </div>
  );
}
