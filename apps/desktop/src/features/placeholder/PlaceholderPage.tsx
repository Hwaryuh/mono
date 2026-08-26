import { Link } from "react-router";
import { Card, Icon } from "@mono/ui";

export function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className="placeholder-page">
      <Card className="placeholder-page__card">
        <span className="placeholder-page__eyebrow">이번 세션 구현 범위</span>
        <h1>{name}</h1>
        <p>앱 셸과 라우팅만 연결했다. 상세 화면 구현은 대시보드 이후 단계다.</p>
        <Link to="/dashboard">
          <Icon name="arrowLeft" size={13} />
          대시보드로
        </Link>
      </Card>
    </div>
  );
}
