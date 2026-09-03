import { translate } from "../../i18n/i18n";
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
  return <Link className="widget-link" to={to}>{translate("dashboard.action.open")}<Icon name="chevronRight" size={11} strokeWidth={2} /></Link>;
}

function Widget({ title, icon, to, wide = false, className = "", children }: { title: string; icon: IconName; to: string; wide?: boolean; className?: string; children: ReactNode }) {
  return (
    <Card className={`dashboard-widget ${wide ? "dashboard-widget--span-2" : ""} ${className}`.trim()}>
      <SectionHeader action={<WidgetLink to={to} />} title={<span className="section-title-with-icon"><Icon name={icon} size={14} strokeWidth={1.5} />{title}</span>} />
      {children}
    </Card>
  );
}

function WidgetEmpty({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="dashboard-widget-empty">
      <Icon name={icon} size={22} strokeWidth={1.4} />
      <span>{children}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="dashboard dashboard--loading" aria-label={translate("dashboard.loading")}>
      <Card className="dashboard-skeleton dashboard-skeleton--wide" />
      <div className="dashboard-grid">{Array.from({ length: 5 }, (_, index) => <Card className="dashboard-skeleton" key={index} />)}</div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="dashboard-state">
      <Card><StatusIndicator icon="alert" label={translate("dashboard.error.title")} tone="danger" /><span>{translate("dashboard.error.description")}</span></Card>
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
    <Widget icon="todo" title={translate("dashboard.todayTodos.title")} to="/todo" wide>
      {snapshot.tasks.length === 0 ? <WidgetEmpty icon="todo">{translate("dashboard.todayTodos.empty")}</WidgetEmpty> : (
        <div className="task-list">
          {snapshot.tasks.slice(0, 3).map((task) => (
            <div className={`task-row ${task.done ? "task-row--done" : ""}`} key={task.id}>
              <Checkbox checked={task.done} label={translate("routine.action.toggleCompletion", { title: task.title, state: task.done ? translate("routine.status.incomplete") : translate("todo.filter.completed") })} onCheckedChange={() => onToggle(task.id)} />
              <span className="task-row__title">{task.title}</span>
              {task.isRoutine && <Badge>{translate("app.navigation.routine")}</Badge>}
              <Chip dotColor={task.labelColor}>{task.label}</Chip>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

function TodayEvents({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Widget icon="calendar" title={translate("dashboard.todayEvents.title")} to="/calendar">
      {snapshot.events.length === 0 ? <WidgetEmpty icon="calendar">{translate("dashboard.todayEvents.empty")}</WidgetEmpty> : (
        <div className="event-list">
          {snapshot.events.map((event) => <div className="event-row" key={event.id}><i style={{ backgroundColor: event.color }} /><time>{event.time}</time><span>{event.title}</span></div>)}
        </div>
      )}
    </Widget>
  );
}

function MonthlyExpense({ snapshot }: { snapshot: DashboardSnapshot }) {
  const hasExpense = snapshot.monthlyExpense.total > 0 || snapshot.monthlyExpense.categories.length > 0;
  return (
    <Widget className="expense-widget" icon="wallet" title={translate("dashboard.monthlyExpense.title")} to="/ledger">
      {hasExpense ? (
        <>
          <strong className="expense-widget__total">{formatWon(snapshot.monthlyExpense.total)}</strong>
          <div className="expense-categories">
            {snapshot.monthlyExpense.categories.map((category) => (
              <div key={category.name}><span className="color-square" style={{ background: category.color }} /><span>{category.name}</span><span>{formatWon(category.amount)}</span></div>
            ))}
          </div>
        </>
      ) : <WidgetEmpty icon="wallet">{translate("dashboard.monthlyExpense.empty")}</WidgetEmpty>}
    </Widget>
  );
}

function RoutineWidget({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Widget icon="routine" title={translate("dashboard.routineStreak.title")} to="/routine" wide>
      {snapshot.routines.length === 0 ? <WidgetEmpty icon="routine">{translate("routine.empty.title")}</WidgetEmpty> : (
        <div className="routine-list">
          {snapshot.routines.map((routine) => (
            <div className="routine-row" key={routine.id}>
              <span className="routine-row__title">{routine.title}</span>
              <div className="routine-week" aria-label={translate("dashboard.routineStreak.summary", { title: routine.title })}>
                {routine.week.map((done, index) => <span className={done ? "routine-day routine-day--done" : "routine-day"} key={index} />)}
              </div>
              <span>{routine.period}</span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

function RecentScraps({ snapshot }: { snapshot: DashboardSnapshot }) {
  const kindIcon = { 사진: "image", 링크: "scrap", 메모: "note", 동영상: "video", 파일: "file" } as const;
  return (
    <Widget icon="scrap" title={translate("dashboard.recentScraps.title")} to="/scrap" wide>
      {snapshot.scraps.length === 0 ? <WidgetEmpty icon="scrap">{translate("scrap.empty.title")}</WidgetEmpty> : (
        <div className="scrap-grid">
          {snapshot.scraps.map((scrap) => (
            <Link className="scrap-card" key={scrap.id} to={`/scrap?detail=${encodeURIComponent(scrap.id)}`}>
              <div className="scrap-card__meta"><Icon name={kindIcon[scrap.kind]} size={12} /><span>{scrap.kind}</span><span>{translate("dashboard.recentScraps.commentCount", { count: scrap.commentCount })}</span></div>
              <strong>{scrap.title}</strong>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}
