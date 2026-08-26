import type { DashboardSnapshot } from "@mono/contracts";
import { Badge, Card, Checkbox, Chip, Icon, SectionHeader, StatusIndicator, type IconName } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { DashboardRepository } from "./dashboard-repository";
import { dashboardQueryKey, QuickCapture } from "./QuickCapture";

function formatWon(amount: number) {
  return `₩ ${amount.toLocaleString("ko-KR")}`;
}

function WidgetLink({ to }: { to: string }) {
  return <Link className="widget-link" to={to}>열기<Icon name="chevronRight" size={11} strokeWidth={2} /></Link>;
}

function Widget({ title, icon, to, wide = false, className = "", children }: { title: string; icon: IconName; to: string; wide?: boolean; className?: string; children: ReactNode }) {
  return (
    <Card className={`dashboard-widget ${wide ? "dashboard-widget--span-2" : ""} ${className}`.trim()}>
      <SectionHeader action={<WidgetLink to={to} />} title={<span className="section-title-with-icon"><Icon name={icon} size={14} strokeWidth={1.5} />{title}</span>} />
      {children}
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="dashboard dashboard--loading" aria-label="대시보드 불러오는 중">
      <Card className="dashboard-skeleton dashboard-skeleton--wide" />
      <div className="dashboard-grid">{Array.from({ length: 5 }, (_, index) => <Card className="dashboard-skeleton" key={index} />)}</div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="dashboard-state">
      <Card><StatusIndicator icon="alert" label="불러오지 못했습니다" tone="danger" /><span>대시보드 데이터를 읽는 중 문제가 생겼습니다.</span></Card>
    </div>
  );
}

export function DashboardPage({ repository }: { repository: DashboardRepository }) {
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: dashboardQueryKey, queryFn: () => repository.getSnapshot() });
  const toggleTaskMutation = useMutation({
    mutationFn: (taskId: string) => repository.toggleTask(taskId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["todo"] }),
        queryClient.invalidateQueries({ queryKey: ["routine"] }),
      ]);
    },
  });

  if (snapshotQuery.isPending) return <LoadingState />;
  if (snapshotQuery.isError) return <ErrorState />;

  const snapshot = snapshotQuery.data;

  return (
    <div className="dashboard">
      <Card className="capture-card">
        <QuickCapture repository={repository} showHeading snapshot={snapshot} />
      </Card>

      <div className="dashboard-grid">
        <TodayTasks snapshot={snapshot} onToggle={(taskId) => toggleTaskMutation.mutate(taskId)} />
        <TodayEvents snapshot={snapshot} />
        <MonthlyExpense snapshot={snapshot} />
        <RoutineWidget snapshot={snapshot} />
        <RecentScraps snapshot={snapshot} />
      </div>
    </div>
  );
}

function TodayTasks({ snapshot, onToggle }: { snapshot: DashboardSnapshot; onToggle: (taskId: string) => void }) {
  return (
    <Widget icon="todo" title="오늘 할 일" to="/todo" wide>
      <div className="task-list">
        {snapshot.tasks.map((task) => (
          <div className={`task-row ${task.done ? "task-row--done" : ""}`} key={task.id}>
            <Checkbox checked={task.done} label={`${task.title} ${task.done ? "미완료" : "완료"} 처리`} onCheckedChange={() => onToggle(task.id)} />
            <span className="task-row__title">{task.title}</span>
            {task.isRoutine && <Badge>루틴</Badge>}
            <Chip dotColor={task.labelColor}>{task.label}</Chip>
          </div>
        ))}
      </div>
    </Widget>
  );
}

function TodayEvents({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Widget icon="calendar" title="오늘 일정" to="/calendar">
      <div className="event-list">
        {snapshot.events.map((event) => <div className="event-row" key={event.id}><i style={{ backgroundColor: event.color }} /><time>{event.time}</time><span>{event.title}</span></div>)}
        {snapshot.events.length === 0 && <div className="widget-empty">오늘은 일정이 없습니다</div>}
      </div>
    </Widget>
  );
}

function MonthlyExpense({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Widget className="expense-widget" icon="wallet" title="이번 달 지출" to="/ledger">
      <strong className="expense-widget__total">{formatWon(snapshot.monthlyExpense.total)}</strong>
      <div className="expense-categories">
        {snapshot.monthlyExpense.categories.map((category) => (
          <div key={category.name}><span className="color-square" style={{ background: category.color }} /><span>{category.name}</span><span>{formatWon(category.amount)}</span></div>
        ))}
      </div>
    </Widget>
  );
}

function RoutineWidget({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Widget icon="routine" title="루틴 스트릭" to="/routine" wide>
      <div className="routine-list">
        {snapshot.routines.map((routine) => (
          <div className="routine-row" key={routine.id}>
            <span className="routine-row__title">{routine.title}</span>
            <div className="routine-week" aria-label={`${routine.title} 최근 7일`}>
              {routine.week.map((done, index) => <span className={done ? "routine-day routine-day--done" : "routine-day"} key={index} />)}
            </div>
            <span>{routine.period}</span>
          </div>
        ))}
      </div>
    </Widget>
  );
}

function RecentScraps({ snapshot }: { snapshot: DashboardSnapshot }) {
  const kindIcon = { 사진: "image", 링크: "scrap", 메모: "note", 동영상: "video" } as const;
  return (
    <Widget icon="scrap" title="최근 스크랩" to="/scrap" wide>
      <div className="scrap-grid">
        {snapshot.scraps.map((scrap) => (
          <Link className="scrap-card" key={scrap.id} to={`/scrap?detail=${encodeURIComponent(scrap.id)}`}>
            <div className="scrap-card__meta"><Icon name={kindIcon[scrap.kind]} size={12} /><span>{scrap.kind}</span><span>댓글 {scrap.commentCount}</span></div>
            <strong>{scrap.title}</strong>
          </Link>
        ))}
      </div>
    </Widget>
  );
}
