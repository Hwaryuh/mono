import { translate } from "../i18n/i18n";
import { errorMessage } from "../i18n/error-message";
import { StatusIndicator } from "@mono/ui";
import { useRouteError } from "react-router";

export function RouteErrorScreen() {
  const error = useRouteError();
  // Just logs it and leaves retrying to a page refresh. Extend here when adding dedicated reporting.
  console.error(error);

  return (
    <div className="route-error" role="alert">
      <StatusIndicator icon="alert" label={translate("routeError.title")} tone="danger" />
      <p>{errorMessage(error, "routeError.unknown")}</p>
      <button onClick={() => window.location.reload()} type="button">{translate("routeError.retry")}</button>
    </div>
  );
}
