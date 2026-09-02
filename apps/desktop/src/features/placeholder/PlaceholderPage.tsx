import { translate } from "../../i18n/i18n";
import { Link } from "react-router";
import { Card, Icon } from "@mono/ui";

export function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className="placeholder-page">
      <Card className="placeholder-page__card">
        <span className="placeholder-page__eyebrow">{translate("placeholder.scope.title")}</span>
        <h1>{name}</h1>
        <p>{translate("placeholder.scope.description")}</p>
        <Link to="/dashboard">
          <Icon name="arrowLeft" size={13} />
          {translate("placeholder.action.dashboard")}</Link>
      </Card>
    </div>
  );
}
