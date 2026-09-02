import { Badge, Button, ColorPicker, Icon, IconButton, Input, Modal, MorphingIcon, Select, StatusIndicator, type IconName } from "@mono/ui";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import type { DashboardRepository } from "../features/dashboard/dashboard-repository";
import { dashboardQueryKey, formatMediaSize, QuickCapture } from "../features/dashboard/QuickCapture";
import type { InboxRepository } from "../features/inbox/inbox-repository";
import type { TodoRepository } from "../features/todo/todo-repository";
import type { RoutineRepository } from "../features/routine/routine-repository";
import type { CalendarRepository } from "../features/calendar/calendar-repository";
import { useNavigate } from "react-router";
import { currentIsoDate } from "@mono/domain";
import { accentForegroundOf, LocalStorageAccentColorPreferenceStore } from "./accent-color-preference";
import { InMemoryAiSettingsStore, type AiProviderId, type AiSettingsStore } from "../infrastructure/ai/ai-settings-store";
import { InMemoryMediaMaintenance, type MediaMaintenance } from "../infrastructure/media/media-maintenance";
import { InMemoryR2SettingsStore, type R2SettingsStore } from "../infrastructure/media/r2-settings-store";
import {
  looksLikeRemoteApiUrl,
  trimBaseUrl,
  type ServerConnection,
  type ServerMode,
  type ServerSettingsStore,
} from "../infrastructure/server/server-settings-store";
import { TauriServerSettingsStore } from "../infrastructure/server/tauri-server-settings-store";
import { checkServerCompatibility, serverBehindOf } from "../infrastructure/server/server-compatibility";
import { CHECK_UPDATE_EVENT } from "../features/updater/AppUpdater";
import { TimerSettingsPanel } from "../features/timer/TimerSettingsPanel";
import { LocalStorageTimerSettingsStore } from "../features/timer/timer-settings-store";
import { localeOptions, translate, useI18n, type Locale } from "../i18n/i18n";
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
const COLLAPSED_SIDEBAR_WIDTH = 56; // .app-shell--collapsed 의 첫 열 폭과 같아야 한다
const SIDEBAR_WIDTH_STORAGE_KEY = "mono:sidebar-width";
// 드래그를 놓았을 때 이 폭보다 좁으면 접힘, 넓으면 펼침으로 붙는다.
const SIDEBAR_SNAP_AT = 120;
// 이 폭 이하에서는 라벨과 들여쓰기 보간이 끝나고 아이콘-only 상태를 유지한다.
const SIDEBAR_LABEL_GONE_AT = COLLAPSED_SIDEBAR_WIDTH + 24;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

// 펼침(0) ↔ 접힘(1) 진행도. 드래그 폭이 좁을수록 1에 가까워지고, CSS가 이 값 하나로
// 라벨 투명도·너비·아이콘 위치를 보간한다.
function sidebarCollapseProgress(width: number): number {
  return Math.max(0, Math.min(1, (MIN_SIDEBAR_WIDTH - width) / (MIN_SIDEBAR_WIDTH - SIDEBAR_LABEL_GONE_AT)));
}

function readSidebarWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampSidebarWidth(stored);
  } catch {
    // 저장소가 차단되면 기본 폭으로 시작한다.
  }
  return MAX_SIDEBAR_WIDTH;
}

function writeSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // 저장소가 차단돼도 현재 세션 폭은 유지한다.
  }
}

type Theme = "light" | "dark";
type SettingsSectionId = "appearance" | "timer" | "server" | "ai" | "storage" | "about";

interface SettingsSectionDefinition {
  id: SettingsSectionId;
  labelKey: TranslationKey;
  icon: IconName;
  groupKey: TranslationKey;
}

const settingsSections: SettingsSectionDefinition[] = [
  { id: "appearance", labelKey: "settings.section.appearance", icon: "sun", groupKey: "settings.group.appearance" },
  { id: "server", labelKey: "settings.section.server", icon: "server", groupKey: "settings.group.connection" },
  { id: "ai", labelKey: "settings.section.ai", icon: "sparkles", groupKey: "settings.group.connection" },
  { id: "storage", labelKey: "settings.section.storage", icon: "layers", groupKey: "settings.group.connection" },
  { id: "timer", labelKey: "settings.section.timer", icon: "clock", groupKey: "settings.group.module" },
  { id: "about", labelKey: "settings.section.about", icon: "note", groupKey: "settings.group.etc" },
];

const accentColorPreferenceStore = LocalStorageAccentColorPreferenceStore.of(window.localStorage);
const timerSettingsStore = LocalStorageTimerSettingsStore.of(window.localStorage);
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

  // 드래그하는 동안 사이드바 폭이 포인터를 그대로 따라간다(56–224px, transition 없음).
  // 놓는 순간의 폭만 보고 접힘/펼침 중 가까운 쪽으로 붙는다 — 자동 격발 지점은 없다.
  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const originLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
    const widthAt = (clientX: number) =>
      Math.min(MAX_SIDEBAR_WIDTH, Math.max(COLLAPSED_SIDEBAR_WIDTH, Math.round(clientX - originLeft)));
    try { handle.setPointerCapture(event.pointerId); } catch { /* 캡처 미지원 환경 */ }
    setDragWidth(collapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth);

    const onMove = (move: PointerEvent) => setDragWidth(widthAt(move.clientX));
    const endDrag = (up: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", endDrag);
      handle.removeEventListener("pointercancel", endDrag);
      try { handle.releasePointerCapture(up.pointerId); } catch { /* 이미 해제됨 */ }
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

function SettingsModal({ open, onClose, theme, onThemeChange, accentColor, onAccentColorChange, locale, onLocaleChange, aiSettingsStore, mediaMaintenance, r2SettingsStore, serverSettingsStore }: {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  accentColor: string;
  onAccentColorChange: (accentColor: string) => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  aiSettingsStore: AiSettingsStore;
  mediaMaintenance: MediaMaintenance;
  r2SettingsStore: R2SettingsStore;
  serverSettingsStore: ServerSettingsStore;
}) {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  return (
    <Modal className="settings-modal" icon="settings" onClose={onClose} open={open} title={t("settings.title")}>
      <div className="settings-layout">
        <aside className="settings-navigation">
          <span>{t("settings.title")}</span>
          <nav aria-label={t("settings.navigation")}>
            {settingsSections.map((section, index) => (
              <Fragment key={section.id}>
                {section.groupKey !== settingsSections[index - 1]?.groupKey && (
                  <span className="settings-navigation__group">{t(section.groupKey)}</span>
                )}
                <button
                  aria-current={activeSection === section.id ? "page" : undefined}
                  className={activeSection === section.id ? "settings-navigation__item settings-navigation__item--active" : "settings-navigation__item"}
                  onClick={() => setActiveSection(section.id)}
                  type="button"
                >
                  <Icon name={section.icon} size={14} />
                  <span>{t(section.labelKey)}</span>
                </button>
              </Fragment>
            ))}
          </nav>
        </aside>

        <section className="settings-content">
          {activeSection === "appearance" && (
            <>
              <SettingsHeading description={t("settings.appearance.description")} title={t("settings.section.appearance")} />
              <section className="settings-group">
                <header><strong>{t("settings.theme.title")}</strong><span>{t("settings.theme.description")}</span></header>
                <div aria-label={t("settings.theme.label")} className="settings-theme-options" role="radiogroup">
                  <button aria-checked={theme === "light"} onClick={() => onThemeChange("light")} role="radio" type="button">
                    <span className="settings-theme-preview settings-theme-preview--light" />
                    <span><Icon name="sun" size={13} />{t("settings.theme.light")}</span>
                  </button>
                  <button aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")} role="radio" type="button">
                    <span className="settings-theme-preview settings-theme-preview--dark" />
                    <span><Icon name="moon" size={13} />{t("settings.theme.dark")}</span>
                  </button>
                </div>
              </section>
              <section className="settings-group">
                <header><strong>{t("settings.accent.title")}</strong><span>{t("settings.accent.description")}</span></header>
                <div className="settings-accent-control">
                  <ColorPicker icon="edit" label={t("settings.accent.title")} onChange={onAccentColorChange} selected value={accentColor} />
                  <span>{accentColor.toUpperCase()}</span>
                </div>
              </section>
              <section className="settings-group">
                <header><strong>{t("settings.locale.title")}</strong><span>{t("settings.locale.description")}</span></header>
                <div className="settings-locale-control">
                  <Select
                    label={t("settings.locale.label")}
                    onChange={(value) => onLocaleChange(value as Locale)}
                    options={localeOptions.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    value={locale}
                  />
                </div>
              </section>
            </>
          )}

          {activeSection === "timer" && <TimerSettingsPanel store={timerSettingsStore} />}

          {activeSection === "server" && <ServerSettingsPanel store={serverSettingsStore} />}

          {activeSection === "ai" && <AiSettingsPanel store={aiSettingsStore} />}

          {activeSection === "storage" && (
            <>
              <StorageSettingsPanel mediaMaintenance={mediaMaintenance} />
              <R2CredentialsSection store={r2SettingsStore} />
            </>
          )}

          {activeSection === "about" && (
            <>
              <SettingsHeading description={t("settings.about.description")} title={t("settings.section.about")} />
              <section aria-label={t("settings.about.update")} className="settings-group">
                <div className="settings-version"><span>{t("settings.about.version")}</span><strong>{__APP_VERSION__}</strong></div>
                <Button onClick={() => window.dispatchEvent(new Event(CHECK_UPDATE_EVENT))} type="button">{t("settings.about.checkUpdate")}</Button>
              </section>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

/**
 * 미사용 미디어 정리. R2 참조 여부는 서버가 자체 DB(수집함·스크랩)로 계산하므로 클라이언트는
 * 확인·정리 버튼만 누르면 된다 — keepIds를 직접 모아 넘기던 예전 방식은 없앴다.
 */
function StorageSettingsPanel({ mediaMaintenance }: { mediaMaintenance: MediaMaintenance }) {
  const [usage, setUsage] = useState<{ count: number; bytes: number } | null>(null);
  const [pending, setPending] = useState<"scan" | "clean" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "scan" | "clean", operation: () => Promise<void>) {
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

  return (
    <>
      <SettingsHeading description={translate("settings.storage.description")} title={translate("settings.section.storage")} />
      <section aria-label={translate("settings.storage.cleanupTitle")} className="settings-group settings-ai">
        <header>
          <strong>{translate("settings.storage.unusedMedia")}</strong>
          <span>{translate("settings.storage.unusedMediaDescription")}</span>
        </header>
        <div className="settings-ai__status">
          <span>{translate("settings.storage.cleanupTarget")}</span>
          <strong>
            {usage === null ? translate("common.status.needsCheck") : usage.count === 0 ? translate("common.none") : translate("settings.storage.usageSummary", { count: usage.count, size: formatMediaSize(usage.bytes) })}
          </strong>
          <Button loading={pending === "scan"} onClick={() => void run("scan", async () => {
            const scanned = await mediaMaintenance.orphanUsage();
            setUsage(scanned);
            if (scanned.count === 0) setMessage(translate("settings.storage.cleanupEmpty"));
          })} type="button">{translate("common.action.check")}</Button>
          <Button
            disabled={!usage || usage.count === 0}
            loading={pending === "clean"}
            onClick={() => void run("clean", async () => {
              const deleted = await mediaMaintenance.gc();
              setUsage({ count: 0, bytes: 0 });
              setMessage(translate("settings.storage.cleanupResult", { count: deleted }));
            })}
            type="button"
            variant="danger"
          >
            {translate("common.action.clean")}</Button>
        </div>
        {message && <p className="settings-ai__message" role="status">{message}</p>}
        {error && <p className="settings-ai__error" role="alert">{error}</p>}
        <p className="settings-ai__notice-text">{translate("common.warning.irreversibleDelete")}</p>
      </section>
    </>
  );
}

function R2CredentialsSection({ store }: { store: R2SettingsStore }) {
  const [accountId, setAccountId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucket, setBucket] = useState("");
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [pending, setPending] = useState<"save" | "test" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    store.hasCredentials()
      .then((configured) => { if (active) setHasCredentials(configured); })
      .catch((cause: unknown) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [store]);

  async function run(action: "save" | "test" | "delete", operation: () => Promise<void>) {
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

  const canSave = accountId.trim().length > 0 && accessKeyId.trim().length > 0 && secretAccessKey.trim().length > 0 && bucket.trim().length > 0;

  return (
    <section aria-label={translate("settings.r2.title")} className="settings-group settings-ai">
      <header>
        <strong>Cloudflare R2</strong>
        <span>{translate("settings.r2.description")}</span>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault();
        void run("save", async () => {
          await store.setCredentials({ accountId, accessKeyId, secretAccessKey, bucket });
          setAccountId("");
          setAccessKeyId("");
          setSecretAccessKey("");
          setBucket("");
          setHasCredentials(true);
          setMessage(translate("settings.r2.saved"));
        });
      }}>
        <Input aria-label={translate("settings.r2.accountId")} autoComplete="off" onChange={(event) => setAccountId(event.target.value)} placeholder={translate("settings.r2.accountId")} value={accountId} />
        <Input aria-label={translate("settings.r2.accessKeyId")} autoComplete="off" onChange={(event) => setAccessKeyId(event.target.value)} placeholder={translate("settings.r2.accessKeyId")} type="password" value={accessKeyId} />
        <Input aria-label={translate("settings.r2.secretAccessKey")} autoComplete="off" onChange={(event) => setSecretAccessKey(event.target.value)} placeholder={translate("settings.r2.secretAccessKey")} type="password" value={secretAccessKey} />
        <Input aria-label={translate("settings.r2.bucketName")} autoComplete="off" onChange={(event) => setBucket(event.target.value)} placeholder={translate("settings.r2.bucketName")} value={bucket} />
        <Button disabled={!canSave} loading={pending === "save"} type="submit" variant="primary">{translate("common.action.save")}</Button>
      </form>
      <div className="settings-ai__status">
        <span>{translate("common.status.label")}</span>
        <strong>{hasCredentials === null ? translate("common.status.checking") : hasCredentials ? translate("common.status.configured") : translate("common.status.notConfigured")}</strong>
        <Button disabled={!hasCredentials} loading={pending === "test"} onClick={() => void run("test", async () => {
          await store.testConnection();
          setMessage(translate("settings.r2.connectionSuccess"));
        })} type="button">{translate("common.action.testConnection")}</Button>
        <Button disabled={!hasCredentials} loading={pending === "delete"} onClick={() => void run("delete", async () => {
          await store.deleteCredentials();
          setHasCredentials(false);
          setMessage(translate("settings.r2.deleted"));
        })} type="button">{translate("common.action.delete")}</Button>
      </div>
      {message && <p className="settings-ai__message" role="status">{message}</p>}
      {error && <p className="settings-ai__error" role="alert">{error}</p>}
    </section>
  );
}

const providerMeta: Record<AiProviderId, { label: string; keyPlaceholder: string; keySource: string; dataNotice: string; model: string }> = {
  gemini: {
    label: "Gemini",
    keyPlaceholder: translate("settings.ai.geminiTitle"),
    keySource: "Google AI Studio",
    dataNotice: translate("settings.ai.geminiDescription"),
    model: "gemini-2.5-flash-lite",
  },
  openai: {
    label: "OpenAI",
    keyPlaceholder: translate("settings.ai.openaiTitle"),
    keySource: "OpenAI Platform",
    dataNotice: translate("settings.ai.openaiDescription"),
    model: "gpt-5-nano",
  },
};

function AiSettingsPanel({ store }: { store: AiSettingsStore }) {
  const [activeProvider, setActiveProviderState] = useState<AiProviderId | null>(null);
  const [providerPending, setProviderPending] = useState(false);
  const [providerError, setProviderError] = useState<{ provider: AiProviderId | null; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    store.getActiveProvider()
      .then((provider) => { if (active) setActiveProviderState(provider); })
      .catch((cause: unknown) => { if (active) setProviderError({ provider: null, message: messageOf(cause) }); });
    return () => { active = false; };
  }, [store]);

  async function selectProvider(provider: AiProviderId) {
    setProviderPending(true);
    setProviderError(null);
    try {
      await store.setActiveProvider(provider);
      setActiveProviderState(provider);
    } catch (cause) {
      setProviderError({ provider, message: messageOf(cause) });
    } finally {
      setProviderPending(false);
    }
  }

  return (
    <>
      <SettingsHeading description={translate("settings.ai.description")} title="AI" />
      {providerError?.provider === null && <p className="settings-ai__error settings-ai__provider-error" role="alert">{providerError.message}</p>}
      <div aria-label={translate("settings.ai.providerLabel")} className="settings-ai-providers" role="radiogroup">
        {(Object.keys(providerMeta) as AiProviderId[]).map((provider) => (
          <ApiKeySection
            active={activeProvider === provider}
            key={provider}
            onSelect={() => void selectProvider(provider)}
            provider={provider}
            providerPending={providerPending}
            selectionError={providerError?.provider === provider ? providerError.message : null}
            store={store}
          />
        ))}
      </div>
    </>
  );
}

function ApiKeySection({ active, onSelect, provider, providerPending, selectionError, store }: {
  active: boolean;
  onSelect: () => void;
  provider: AiProviderId;
  providerPending: boolean;
  selectionError: string | null;
  store: AiSettingsStore;
}) {
  const meta = providerMeta[provider];
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [pending, setPending] = useState<"save" | "test" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    store.hasApiKey(provider)
      .then((configured) => { if (active) setHasKey(configured); })
      .catch((cause: unknown) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [provider, store]);

  async function run(action: "save" | "test" | "delete", operation: () => Promise<void>) {
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

  return (
    <section aria-label={translate("settings.ai.keySectionLabel", { provider: meta.label })} className={`settings-group settings-ai settings-ai--provider ${active ? "settings-ai--active" : "settings-ai--inactive"}`}>
      <header className="settings-ai__provider-header">
        <label>
          <input checked={active} disabled={providerPending} name="active-ai-provider" onChange={onSelect} type="radio" />
          <span className="settings-ai__provider-title"><strong>{translate("settings.ai.keyTitle", { provider: meta.label })}</strong><small>{meta.model}</small></span>
        </label>
        <span>{translate("settings.ai.keySecurityDescription")}</span>
      </header>
      <div className="settings-ai__body">
        <form onSubmit={(event) => {
          event.preventDefault();
          void run("save", async () => {
            await store.setApiKey(provider, apiKey);
            setApiKey("");
            setHasKey(true);
            setMessage(translate("settings.ai.keySaved"));
          });
        }}>
          <Input
            aria-label={translate("settings.ai.keyLabel", { provider: meta.label })}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasKey ? translate("settings.ai.replaceKey") : meta.keyPlaceholder}
            type="password"
            value={apiKey}
          />
          <Button disabled={!apiKey.trim()} loading={pending === "save"} type="submit" variant="primary">{translate("common.action.save")}</Button>
        </form>
        <div className="settings-ai__status">
          <span>{translate("common.status.label")}</span>
          <strong>{hasKey === null ? translate("common.status.checking") : hasKey ? translate("settings.ai.keyConfigured") : translate("settings.ai.keyMissing")}</strong>
          <Button disabled={!hasKey} loading={pending === "test"} onClick={() => void run("test", async () => {
            await store.testConnection(provider);
            setMessage(translate("settings.ai.connectionSuccess", { provider: meta.label }));
          })} type="button">{translate("common.action.testConnection")}</Button>
          <Button disabled={!hasKey} loading={pending === "delete"} onClick={() => void run("delete", async () => {
            await store.deleteApiKey(provider);
            setHasKey(false);
            setMessage(translate("settings.ai.keyDeleted"));
          })} type="button">{translate("common.action.delete")}</Button>
        </div>
        {selectionError && <p className="settings-ai__error" role="alert">{selectionError}</p>}
        {message && <p className="settings-ai__message" role="status">{message}</p>}
        {error && <p className="settings-ai__error" role="alert">{error}</p>}
        <p className="settings-ai__notice-text">{meta.dataNotice}</p>
      </div>
    </section>
  );
}

const SERVER_MODE_OPTIONS: { id: ServerMode; label: string; description: string }[] = [
  { id: "embedded", label: translate("settings.server.localMode"), description: translate("settings.server.localModeDescription") },
  { id: "remote", label: translate("settings.server.remoteMode"), description: translate("settings.server.remoteModeDescription") },
];

type CurrentConnectionStatus = { state: "checking" } | { state: "online" } | { state: "offline"; detail: string };

function CurrentConnectionBadge({ status }: { status: CurrentConnectionStatus }) {
  if (status.state === "online") return <StatusIndicator icon="check" label={translate("settings.server.connected")} tone="success" />;
  if (status.state === "offline") return <StatusIndicator icon="alert" label={translate("settings.server.unreachable")} tone="danger" />;
  return <StatusIndicator icon="sync" label={translate("common.status.checking")} tone="neutral" />;
}

/**
 * 이 기기가 어느 mono API 서버를 쓸지 정한다. 설정은 server.json에 저장되고 적용은 다음
 * 실행부터다 — lib.rs가 실행 시 한 번만 연결을 결정한다. 그래서 "저장"과 "다시 시작"이
 * 분리돼 있고, restartRequired로 둘의 어긋남을 드러낸다.
 */
function ServerSettingsPanel({ store }: { store: ServerSettingsStore }) {
  const [connection, setConnection] = useState<ServerConnection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftMode, setDraftMode] = useState<ServerMode>("embedded");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [current, setCurrent] = useState<CurrentConnectionStatus>({ state: "checking" });
  const [pending, setPending] = useState<"save" | "test" | "restart" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  function applyConnection(next: ServerConnection) {
    setConnection(next);
    setDraftMode(next.mode);
    setDraftUrl(next.remoteUrl);
    setDraftToken(next.remoteToken);
  }

  useEffect(() => {
    let active = true;
    store.read()
      .then((next) => { if (active) applyConnection(next); })
      .catch((cause: unknown) => { if (active) setLoadError(messageOf(cause)); });
    return () => { active = false; };
  }, [store]);

  const effectiveApiBaseUrl = connection?.effectiveApiBaseUrl;
  // 원격 연결이면 저장된 토큰으로 프로브해야 한다 — 안 그러면 토큰이 걸린 서버가
  // 정상인데도 인증 엔드포인트가 401이라 "응답 없음"으로 뜬다. 임베드는 토큰 없음.
  const effectiveToken = connection && !connection.runningEmbedded
    ? connection.remoteToken || undefined
    : undefined;
  useEffect(() => {
    if (!effectiveApiBaseUrl) return;
    let active = true;
    setCurrent({ state: "checking" });
    store.probe(effectiveApiBaseUrl, effectiveToken)
      .then(() => { if (active) setCurrent({ state: "online" }); })
      .catch((cause: unknown) => { if (active) setCurrent({ state: "offline", detail: messageOf(cause) }); });
    return () => { active = false; };
  }, [store, effectiveApiBaseUrl, effectiveToken]);

  const dirty = Boolean(connection) && (
    draftMode !== connection?.mode
    || (draftMode === "remote" && trimBaseUrl(draftUrl) !== connection?.remoteUrl)
    || (draftMode === "remote" && draftToken.trim() !== connection?.remoteToken)
  );
  const draftUrlValid = draftMode === "embedded" || looksLikeRemoteApiUrl(draftUrl);
  const canSave = Boolean(connection?.manageable) && dirty && draftUrlValid && pending === null;

  async function save() {
    setPending("save");
    setMessage(null);
    setError(null);
    try {
      const next = await store.save({ mode: draftMode, remoteUrl: draftUrl, token: draftToken });
      applyConnection(next);
      setTestResult(null);
      setMessage(next.restartRequired ? translate("settings.server.savedRestartRequired") : translate("settings.server.savedApplied"));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  async function testConnection() {
    setPending("test");
    setMessage(null);
    setError(null);
    setTestResult(null);
    try {
      await store.probe(trimBaseUrl(draftUrl), draftToken.trim() || undefined);
      setTestResult({ ok: true, text: translate("settings.server.connectionSuccess") });
    } catch (cause) {
      setTestResult({ ok: false, text: messageOf(cause) });
    } finally {
      setPending(null);
    }
  }

  async function restart() {
    setPending("restart");
    setError(null);
    try {
      await store.restart();
    } catch (cause) {
      setError(messageOf(cause));
      setPending(null);
    }
  }

  return (
    <>
      <SettingsHeading description={translate("settings.server.description")} title={translate("settings.server.title")} />

      {loadError && <p className="settings-ai__error" role="alert">{loadError}</p>}

      {connection && (
        <>
          <section aria-label={translate("settings.server.title")} className="settings-group">
            <div className="settings-server__status">
              <span className={`settings-server__tag ${connection.runningEmbedded ? "" : "settings-server__tag--remote"}`}>
                {connection.runningEmbedded ? translate("settings.server.localMode") : translate("settings.server.remoteMode")}
              </span>
              <CurrentConnectionBadge status={current} />
              {(connection.envOverride || connection.restartRequired) && (
                <code className="settings-server__url" title={connection.effectiveApiBaseUrl}>{connection.effectiveApiBaseUrl}</code>
              )}
            </div>
            {current.state === "offline" && <p className="settings-server__status-detail" role="alert">{current.detail}</p>}
            {connection.envOverride && (
              <p className="settings-server__status-detail">
                {translate("settings.server.environmentOverride", { variable: "MONO_API_BASE_URL" })}</p>
            )}

            <div aria-label={translate("settings.server.modeLabel")} className="settings-server__modes" role="radiogroup">
              {SERVER_MODE_OPTIONS.map((option) => (
                <button
                  aria-checked={draftMode === option.id}
                  className="settings-server__mode"
                  disabled={!connection.manageable || pending !== null}
                  key={option.id}
                  onClick={() => { setDraftMode(option.id); setMessage(null); setError(null); }}
                  role="radio"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="settings-server__mode-hint">
              {SERVER_MODE_OPTIONS.find((option) => option.id === draftMode)?.description}
            </p>

            {draftMode === "remote" && (
              <div className="settings-server__remote">
                <form onSubmit={(event) => { event.preventDefault(); void testConnection(); }}>
                  <Input
                    aria-label={translate("settings.server.remoteUrl")}
                    autoComplete="off"
                    disabled={!connection.manageable}
                    invalid={draftUrl.trim().length > 0 && !draftUrlValid}
                    inputMode="url"
                    onChange={(event) => { setDraftUrl(event.target.value); setTestResult(null); }}
                    placeholder="https://mono.example.com"
                    spellCheck={false}
                    value={draftUrl}
                  />
                  <Button disabled={!looksLikeRemoteApiUrl(draftUrl) || pending !== null} loading={pending === "test"} type="submit">
                    {translate("common.action.testConnection")}</Button>
                </form>
                <Input
                  aria-label={translate("settings.server.apiToken")}
                  autoComplete="off"
                  disabled={!connection.manageable}
                  onChange={(event) => { setDraftToken(event.target.value); setTestResult(null); }}
                  placeholder={translate("settings.server.apiTokenOptional")}
                  spellCheck={false}
                  type="password"
                  value={draftToken}
                />
                <p className="settings-server__hint">
                  {translate("settings.server.connectionHint", { variable: "MONO_API_TOKEN" })}</p>
                {testResult && (
                  <p
                    className={testResult.ok ? "settings-ai__message" : "settings-ai__error"}
                    role={testResult.ok ? "status" : "alert"}
                  >
                    {testResult.text}
                  </p>
                )}
              </div>
            )}

            <div className="settings-server__actions">
              <Button disabled={!canSave} loading={pending === "save"} onClick={() => void save()} type="button" variant="primary">{translate("common.action.save")}</Button>
            </div>

            {message && <p className="settings-ai__message" role="status">{message}</p>}
            {error && <p className="settings-ai__error" role="alert">{error}</p>}
          </section>

          {connection.restartRequired && (
            <section aria-label={translate("settings.server.restartNotice")} className="settings-server__restart">
              <div>
                <strong>{translate("settings.server.restartRequired")}</strong>
                <span>{translate("settings.server.restartDescription")}</span>
              </div>
              <Button loading={pending === "restart"} onClick={() => void restart()} type="button" variant="primary">{translate("settings.server.restartNow")}</Button>
            </section>
          )}
        </>
      )}
    </>
  );
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function SettingsHeading({ title, description }: { title: string; description: string }) {
  return <header className="settings-heading"><strong>{title}</strong><p>{description}</p></header>;
}
