import { Button, Icon, IconButton, Modal, MorphingIcon, type IconName } from "@mono/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import type { DashboardRepository } from "../features/dashboard/dashboard-repository";
import { dashboardQueryKey, QuickCapture } from "../features/dashboard/QuickCapture";
import type { InboxRepository } from "../features/inbox/inbox-repository";
import type { TodoRepository } from "../features/todo/todo-repository";
import type { RoutineRepository } from "../features/routine/routine-repository";
import type { CalendarRepository } from "../features/calendar/calendar-repository";
import { currentIsoDate } from "@mono/domain";
import { accentForegroundOf, LocalStorageAccentColorPreferenceStore } from "./accent-color-preference";
import { InMemoryAiSettingsStore, type AiSettingsStore } from "../infrastructure/ai/ai-settings-store";
import { InMemoryMediaMaintenance, type MediaMaintenance } from "../infrastructure/media/media-maintenance";
import { InMemoryR2SettingsStore, type R2SettingsStore } from "../infrastructure/media/r2-settings-store";
import type { ServerSettingsStore } from "../infrastructure/server/server-settings-store";
import { TauriServerSettingsStore } from "../infrastructure/server/tauri-server-settings-store";
import { checkServerCompatibility, serverBehindOf } from "../infrastructure/server/server-compatibility";
import { SettingsModal, type Theme } from "../features/settings/SettingsModal";
import { useI18n } from "../i18n/i18n";
import type { TranslationKey } from "../i18n/messages.ko";

type NavigationItem = {
  to: string;
  label: string;
  icon: IconName;
  badge?: string;
  nested?: boolean;
};

const MIN_SIDEBAR_WIDTH = 168;
const MAX_SIDEBAR_WIDTH = 224;
const COLLAPSED_SIDEBAR_WIDTH = 56; // must match .app-shell--collapsed's first-column width
const SIDEBAR_WIDTH_STORAGE_KEY = "mono:sidebar-width";
// If narrower than this width when the drag is released, it snaps to collapsed; if wider, to expanded.
const SIDEBAR_SNAP_AT = 120;
// At or below this width, the label and indentation interpolation finishes and it stays icon-only.
const SIDEBAR_LABEL_GONE_AT = COLLAPSED_SIDEBAR_WIDTH + 24;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

// The expanded(0) ↔ collapsed(1) progress. The narrower the drag width, the closer to 1, and CSS uses this single value to
// interpolate the label opacity, width, and icon position.
function sidebarCollapseProgress(width: number): number {
  return Math.max(0, Math.min(1, (MIN_SIDEBAR_WIDTH - width) / (MIN_SIDEBAR_WIDTH - SIDEBAR_LABEL_GONE_AT)));
}

function readSidebarWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampSidebarWidth(stored);
  } catch {
    // Starts at the default width if storage is blocked.
  }
  return MAX_SIDEBAR_WIDTH;
}

function writeSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Even if storage is blocked, the current session's width is kept.
  }
}

const accentColorPreferenceStore = LocalStorageAccentColorPreferenceStore.of(window.localStorage);
const defaultAiSettingsStore = new InMemoryAiSettingsStore();
const defaultMediaMaintenance = new InMemoryMediaMaintenance();
const defaultR2SettingsStore = new InMemoryR2SettingsStore();
const defaultServerSettingsStore = new TauriServerSettingsStore();

const routeMeta: Record<string, { titleKey: TranslationKey; icon: IconName; actionKey?: TranslationKey }> = {
  "/dashboard": { titleKey: "app.navigation.dashboard", icon: "grid" },
  "/inbox": { titleKey: "app.navigation.inbox", icon: "inbox" },
  "/todo": { titleKey: "app.navigation.todo", icon: "todo", actionKey: "app.action.newTodo" },
  "/routine": { titleKey: "app.navigation.routine", icon: "routine", actionKey: "app.action.newRoutine" },
  "/timer": { titleKey: "app.navigation.timer", icon: "clock" },
  "/calendar": { titleKey: "app.navigation.calendar", icon: "calendar", actionKey: "app.action.newCalendar" },
  "/scrap": { titleKey: "app.navigation.scrap", icon: "scrap", actionKey: "app.action.newScrap" },
  "/ledger": { titleKey: "app.navigation.ledger", icon: "wallet", actionKey: "app.action.newLedger" },
};

export function AppShell({
  aiSettingsStore = defaultAiSettingsStore, dashboardRepository, inboxRepository, mediaMaintenance = defaultMediaMaintenance,
  r2SettingsStore = defaultR2SettingsStore, serverSettingsStore = defaultServerSettingsStore, todoRepository, routineRepository, calendarRepository,
}: {
  aiSettingsStore?: AiSettingsStore; dashboardRepository: DashboardRepository; inboxRepository: InboxRepository; mediaMaintenance?: MediaMaintenance;
  r2SettingsStore?: R2SettingsStore; serverSettingsStore?: ServerSettingsStore; todoRepository: TodoRepository; routineRepository: RoutineRepository; calendarRepository: CalendarRepository;
}) {
  const { formatDate, locale, setLocale, t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [accentColor, setAccentColor] = useState(() => accentColorPreferenceStore.read());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [serverWarningDismissed, setServerWarningDismissed] = useState(false);
  const serverCompatQuery = useQuery({
    queryKey: ["server-compatibility"],
    queryFn: checkServerCompatibility,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const serverBehind = serverBehindOf(serverCompatQuery.data);
  const isMacintosh = navigator.userAgent.includes("Macintosh");
  const shortcutModifier = isMacintosh ? "⌘" : "Ctrl+";
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const today = currentIsoDate();
  const baseMeta = routeMeta[pathname] ?? routeMeta["/dashboard"];
  const inboxQuery = useQuery({ queryKey: ["inbox"], queryFn: () => inboxRepository.getSnapshot() });
  const pendingCount = inboxQuery.data?.items.filter(
    (item) => item.status === "pending" || item.status === "processing",
  ).length ?? 0;
  const todoQuery = useQuery({ queryKey: ["todo"], queryFn: () => todoRepository.getSnapshot() });
  const todoCount = todoQuery.data?.items.filter((item) => !item.done).length ?? 0;
  const routineQuery = useQuery({ queryKey: ["routine"], queryFn: () => routineRepository.getSnapshot() });
  const routineCount = routineQuery.data?.items.length ?? 0;
  const calendarQuery = useQuery({ queryKey: ["calendar"], queryFn: () => calendarRepository.getSnapshot() });
  const todayEventCount = calendarQuery.data?.events.filter((event) => event.startDate === calendarQuery.data?.today).length ?? 0;
  const dashboardQuery = useQuery({
    enabled: quickCaptureOpen,
    queryKey: dashboardQueryKey,
    queryFn: () => dashboardRepository.getSnapshot(),
  });
  const subtitle = pathname === "/dashboard" ? formatDate(today) : "";
  const meta = {
    ...baseMeta,
    action: baseMeta.actionKey ? t(baseMeta.actionKey) : undefined,
    subtitle,
    title: t(baseMeta.titleKey),
  };

  function openNewItemModal() {
    if (!meta.action) return;
    navigate(`${pathname}?modal=new`);
  }

  function matchesModifier(event: KeyboardEvent) {
    if (event.altKey || event.shiftKey) return false;
    return isMacintosh
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  }
  const moduleNavigationGroup: { label: string; items: NavigationItem[] } = {
    label: t("app.navigation.modules"),
    items: [
      { to: "/todo", label: t("app.navigation.todo"), icon: "todo", badge: String(todoCount) },
      { to: "/routine", label: t("app.navigation.routine"), icon: "routine", badge: String(routineCount), nested: true },
      { to: "/timer", label: t("app.navigation.timer"), icon: "clock" },
      { to: "/calendar", label: t("app.navigation.calendar"), icon: "calendar", badge: String(todayEventCount) },
      { to: "/scrap", label: t("app.navigation.scrap"), icon: "scrap" },
      { to: "/ledger", label: t("app.navigation.ledger"), icon: "wallet" },
    ],
  };
  const navigationGroups: Array<{ label?: string; items: NavigationItem[] }> = [
    {
      items: [
        { to: "/dashboard", label: t("app.navigation.dashboard"), icon: "grid" },
        { to: "/inbox", label: t("app.navigation.inbox"), icon: "inbox", badge: String(pendingCount) },
      ],
    },
    moduleNavigationGroup,
  ];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-accent", accentColor);
    root.style.setProperty("--color-accent-foreground", accentForegroundOf(accentColor));
    accentColorPreferenceStore.write(accentColor);
  }, [accentColor]);

  useEffect(() => {
    setQuickCaptureOpen(false);
  }, [pathname]);

  useEffect(() => {
    const openQuickCapture = (event: KeyboardEvent) => {
      if (!matchesModifier(event) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (!event.repeat) setQuickCaptureOpen(true);
    };
    window.addEventListener("keydown", openQuickCapture);
    return () => window.removeEventListener("keydown", openQuickCapture);
  }, []);

  useEffect(() => {
    const toggleSettings = (event: KeyboardEvent) => {
      if (!matchesModifier(event) || event.key !== ",") return;
      event.preventDefault();
      if (!event.repeat) setSettingsOpen((current) => !current);
    };
    window.addEventListener("keydown", toggleSettings);
    return () => window.removeEventListener("keydown", toggleSettings);
  }, []);

  useEffect(() => {
    const openNewItem = (event: KeyboardEvent) => {
      if (!matchesModifier(event) || event.key.toLowerCase() !== "n" || !meta.action) return;
      event.preventDefault();
      if (!event.repeat) openNewItemModal();
    };
    window.addEventListener("keydown", openNewItem);
    return () => window.removeEventListener("keydown", openNewItem);
  }, [meta.action, pathname]);

  useEffect(() => {
    const timeout = setTimeout(() => writeSidebarWidth(sidebarWidth), 200);
    return () => clearTimeout(timeout);
  }, [sidebarWidth]);

  function collapseSidebar() {
    setSettingsOpen(false);
    setCollapsed(true);
  }

  // While dragging, the sidebar width follows the pointer directly (56–224px, no transition).
  // On release, it snaps to whichever of collapsed/expanded the width is closer to — there's no automatic trigger point.
  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const originLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
    const widthAt = (clientX: number) =>
      Math.min(MAX_SIDEBAR_WIDTH, Math.max(COLLAPSED_SIDEBAR_WIDTH, Math.round(clientX - originLeft)));
    try { handle.setPointerCapture(event.pointerId); } catch { /* environment without capture support */ }
    setDragWidth(collapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth);

    const onMove = (move: PointerEvent) => setDragWidth(widthAt(move.clientX));
    const endDrag = (up: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", endDrag);
      handle.removeEventListener("pointercancel", endDrag);
      try { handle.releasePointerCapture(up.pointerId); } catch { /* already released */ }
      const finalWidth = widthAt(up.clientX);
      setDragWidth(null);
      if (finalWidth < SIDEBAR_SNAP_AT) {
        collapseSidebar();
      } else {
        setCollapsed(false);
        setSidebarWidth(clampSidebarWidth(finalWidth));
      }
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  const draggingSidebar = dragWidth !== null;
  const showCollapsed = collapsed && !draggingSidebar;

  return (
    <div
      className={`app-shell ${showCollapsed ? "app-shell--collapsed" : ""} ${draggingSidebar ? "app-shell--resizing" : ""}`}
      style={{
        "--sidebar-width": `${dragWidth ?? sidebarWidth}px`,
        "--sidebar-collapse": dragWidth === null ? (collapsed ? 1 : 0) : sidebarCollapseProgress(dragWidth),
      } as CSSProperties}
    >
      <aside className="sidebar" ref={sidebarRef}>
        <div className="sidebar__brand">
          <div className="sidebar__brand-copy">
            <strong>mono</strong>
            <span>{formatDate(today, "short")}</span>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label={t("app.navigation.primary")}>
          {navigationGroups.map((group, groupIndex) => (
            <div className="sidebar__group" key={group.label ?? groupIndex}>
              {group.label && (
                <div className="sidebar__group-title"><span>{group.label}</span><span>{group.items.length}</span></div>
              )}
              {group.items.map((item) => (
                <NavLink
                  className={({ isActive }) => `sidebar__link ${isActive ? "sidebar__link--active" : ""} ${item.nested ? "sidebar__link--nested" : ""}`}
                  key={item.to}
                  title={showCollapsed ? item.label : undefined}
                  to={item.to}
                >
                  <span className="sidebar__link-content">
                    <Icon name={item.icon} size={15} strokeWidth={1.5} />
                    <span className="sidebar__link-label">{item.label}</span>
                  </span>
                  {item.badge && item.badge !== "0" && <span className={`sidebar__badge ${item.to === "/inbox" ? "sidebar__badge--hot" : ""}`}>{item.badge}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <button
            aria-expanded={settingsOpen}
            aria-hidden={showCollapsed || undefined}
            aria-label={settingsOpen ? t("settings.close") : t("settings.open")}
            className="sidebar__settings-trigger"
            id="sidebar-settings-trigger"
            onClick={() => setSettingsOpen((value) => !value)}
            tabIndex={showCollapsed ? -1 : undefined}
            title={`${settingsOpen ? t("settings.close") : t("settings.title")} (${shortcutModifier},)`}
            type="button"
          >
            <MorphingIcon name={settingsOpen ? "close" : "settings"} size={15} />
          </button>
          <button
            aria-label={showCollapsed ? t("app.sidebar.expand") : t("app.sidebar.collapse")}
            aria-pressed={showCollapsed}
            className="sidebar__collapse"
            onClick={() => {
              if (!collapsed) setSettingsOpen(false);
              setCollapsed((value) => !value);
            }}
            title={showCollapsed ? t("app.sidebar.expand") : t("app.sidebar.collapse")}
            type="button"
          >
            <Icon name={showCollapsed ? "panelExpand" : "panelCollapse"} size={15} />
          </button>
        </div>

        <div
          aria-label={t("app.sidebar.resize")}
          aria-orientation="vertical"
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuemin={COLLAPSED_SIDEBAR_WIDTH}
          aria-valuenow={Math.round(dragWidth ?? (collapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth))}
          className="sidebar__resize"
          onDoubleClick={() => { setCollapsed(false); setSidebarWidth(MAX_SIDEBAR_WIDTH); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              if (collapsed) return;
              if (sidebarWidth <= MIN_SIDEBAR_WIDTH) collapseSidebar();
              else setSidebarWidth((width) => clampSidebarWidth(width - 8));
            } else if (event.key === "ArrowRight") {
              if (collapsed) setCollapsed(false);
              else setSidebarWidth((width) => clampSidebarWidth(width + 8));
            } else return;
            event.preventDefault();
          }}
          onPointerDown={startSidebarResize}
          role="separator"
          tabIndex={0}
        />
      </aside>

      <main className="workspace">
        {serverBehind && !serverWarningDismissed && (
          <div className="server-warning" role="status">
            <Icon name="alert" size={14} strokeWidth={1.8} />
            <p>
              {t("app.serverBehind", { serverVersion: serverBehind.serverVersion, appVersion: serverBehind.appVersion })}
            </p>
            <IconButton aria-label={t("app.action.closeWarning")} onClick={() => setServerWarningDismissed(true)} size="small" title={t("app.action.close")} variant="ghost"><Icon name="close" size={13} /></IconButton>
          </div>
        )}
        <header className="topbar">
          <Icon name={meta.icon} size={17} strokeWidth={1.5} />
          <div className="topbar__title">
            <strong>{meta.title}</strong>
            {meta.subtitle && <span>{meta.subtitle}</span>}
          </div>
          {meta.action && (
            <div className="topbar__actions">
              <Button onClick={openNewItemModal} title={`${meta.action} (${shortcutModifier}N)`} variant="primary"><Icon name="plus" size={13} strokeWidth={2} />{meta.action}</Button>
            </div>
          )}
        </header>
        <section className="workspace__content"><Outlet /></section>
      </main>

      <SettingsModal
        accentColor={accentColor}
        aiSettingsStore={aiSettingsStore}
        mediaMaintenance={mediaMaintenance}
        onClose={() => setSettingsOpen(false)}
        onAccentColorChange={setAccentColor}
        locale={locale}
        onLocaleChange={setLocale}
        onThemeChange={setTheme}
        open={settingsOpen}
        r2SettingsStore={r2SettingsStore}
        serverSettingsStore={serverSettingsStore}
        theme={theme}
      />
      <Modal className="quick-capture-modal" icon="sparkles" onClose={() => setQuickCaptureOpen(false)} open={quickCaptureOpen} title={t("app.quickCapture.title")}>
        <QuickCapture autoFocus repository={dashboardRepository} snapshot={dashboardQuery.data} />
        <div className="quick-capture-shortcut" aria-hidden="true">
          <kbd>{shortcutModifier}K</kbd><span>{t("app.quickCapture.title")}</span><kbd>ESC</kbd><span>{t("app.action.close")}</span>
        </div>
      </Modal>
    </div>
  );
}
