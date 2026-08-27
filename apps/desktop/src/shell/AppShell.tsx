import { Button, ColorPicker, Icon, IconButton, Input, Modal, MorphingIcon, type IconName } from "@mono/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import type { DashboardRepository } from "../features/dashboard/dashboard-repository";
import { dashboardQueryKey, formatMediaSize, QuickCapture } from "../features/dashboard/QuickCapture";
import type { InboxRepository } from "../features/inbox/inbox-repository";
import type { TodoRepository } from "../features/todo/todo-repository";
import type { RoutineRepository } from "../features/routine/routine-repository";
import type { CalendarRepository } from "../features/calendar/calendar-repository";
import { useNavigate } from "react-router";
import { currentIsoDate, koreanDateLabel, koreanMonthLabel } from "@mono/domain";
import { accentForegroundOf, LocalStorageAccentColorPreferenceStore } from "./accent-color-preference";
import { InMemoryAiSettingsStore, type AiProviderId, type AiSettingsStore } from "../infrastructure/ai/ai-settings-store";
import { InMemoryMediaMaintenance, type MediaMaintenance } from "../infrastructure/media/media-maintenance";
import { InMemoryR2SettingsStore, type R2SettingsStore } from "../infrastructure/media/r2-settings-store";

type NavigationItem = {
  to: string;
  label: string;
  icon: IconName;
  badge?: string;
  nested?: boolean;
};

type Theme = "light" | "dark";
type SettingsSectionId = "appearance" | "ai" | "storage" | "about";

interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: IconName;
}

const settingsSections: SettingsSectionDefinition[] = [
  { id: "appearance", label: "화면", icon: "sun" },
  { id: "ai", label: "AI", icon: "sparkles" },
  { id: "storage", label: "저장공간", icon: "layers" },
  { id: "about", label: "정보", icon: "note" },
];

const accentColorPreferenceStore = LocalStorageAccentColorPreferenceStore.of(window.localStorage);
const defaultAiSettingsStore = new InMemoryAiSettingsStore();
const defaultMediaMaintenance = new InMemoryMediaMaintenance();
const defaultR2SettingsStore = new InMemoryR2SettingsStore();

const routeMeta: Record<string, { title: string; subtitle: string; icon: IconName; action?: string }> = {
  "/dashboard": { title: "대시보드", subtitle: "", icon: "grid" },
  "/inbox": { title: "수집함", subtitle: "", icon: "inbox" },
  "/todo": { title: "할 일", subtitle: "", icon: "todo", action: "새 할 일" },
  "/routine": { title: "루틴", subtitle: "", icon: "routine", action: "새 루틴" },
  "/calendar": { title: "일정", subtitle: "", icon: "calendar", action: "새 일정" },
  "/scrap": { title: "스크랩", subtitle: "", icon: "scrap", action: "스크랩 추가" },
  "/ledger": { title: "가계부", subtitle: "", icon: "wallet", action: "지출 추가" },
};

export function AppShell({
  aiSettingsStore = defaultAiSettingsStore, dashboardRepository, inboxRepository, mediaMaintenance = defaultMediaMaintenance,
  r2SettingsStore = defaultR2SettingsStore, todoRepository, routineRepository, calendarRepository,
}: {
  aiSettingsStore?: AiSettingsStore; dashboardRepository: DashboardRepository; inboxRepository: InboxRepository; mediaMaintenance?: MediaMaintenance;
  r2SettingsStore?: R2SettingsStore; todoRepository: TodoRepository; routineRepository: RoutineRepository; calendarRepository: CalendarRepository;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [accentColor, setAccentColor] = useState(() => accentColorPreferenceStore.read());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
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
  const subtitle = pathname === "/dashboard" ? koreanDateLabel(today)
    : pathname === "/ledger" ? koreanMonthLabel(today)
    : baseMeta.subtitle;
  const meta = { ...baseMeta, subtitle };

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
    label: "모듈",
    items: [
      { to: "/todo", label: "할 일", icon: "todo", badge: String(todoCount) },
      { to: "/routine", label: "루틴", icon: "routine", badge: String(routineCount), nested: true },
      { to: "/calendar", label: "일정", icon: "calendar", badge: String(todayEventCount) },
      { to: "/scrap", label: "스크랩", icon: "scrap" },
      { to: "/ledger", label: "가계부", icon: "wallet" },
    ],
  };
  const navigationGroups: Array<{ label?: string; items: NavigationItem[] }> = [
    {
      items: [
        { to: "/dashboard", label: "대시보드", icon: "grid" },
        { to: "/inbox", label: "수집함", icon: "inbox", badge: String(pendingCount) },
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

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar__brand">
          {!collapsed && (
            <div className="sidebar__brand-copy">
              <strong>mono</strong>
              <span>{koreanDateLabel(today, "short")}</span>
            </div>
          )}
        </div>

        <nav className="sidebar__nav" aria-label="주요 메뉴">
          {navigationGroups.map((group, groupIndex) => (
            <div className="sidebar__group" key={group.label ?? groupIndex}>
              {group.label && !collapsed && (
                <div className="sidebar__group-title"><span>{group.label}</span><span>{group.items.length}</span></div>
              )}
              {group.items.map((item) => (
                <NavLink
                  className={({ isActive }) => `sidebar__link ${isActive ? "sidebar__link--active" : ""}`}
                  key={item.to}
                  title={collapsed ? item.label : undefined}
                  to={item.to}
                  style={{ paddingLeft: !collapsed && item.nested ? 26 : undefined }}
                >
                  <Icon name={item.icon} size={15} strokeWidth={1.5} />
                  {!collapsed && <span className="sidebar__link-label">{item.label}</span>}
                  {!collapsed && item.badge && item.badge !== "0" && <span className={`sidebar__badge ${item.to === "/inbox" ? "sidebar__badge--hot" : ""}`}>{item.badge}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          {!collapsed && (
            <button
              aria-expanded={settingsOpen}
              aria-label={settingsOpen ? "설정 닫기" : "설정 열기"}
              className="sidebar__settings-trigger"
              id="sidebar-settings-trigger"
              onClick={() => setSettingsOpen((value) => !value)}
              title={`${settingsOpen ? "설정 닫기" : "설정"} (${shortcutModifier},)`}
              type="button"
            >
              <MorphingIcon name={settingsOpen ? "close" : "settings"} size={15} />
            </button>
          )}
          <button
            aria-label={collapsed ? "사이드바 확장" : "사이드바 축소"}
            aria-pressed={collapsed}
            className="sidebar__collapse"
            onClick={() => {
              if (!collapsed) setSettingsOpen(false);
              setCollapsed((value) => !value);
            }}
            title={collapsed ? "사이드바 확장" : "사이드바 축소"}
            type="button"
          >
            <Icon name={collapsed ? "panelExpand" : "panelCollapse"} size={15} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <Icon name={meta.icon} size={17} strokeWidth={1.5} />
          <div className="topbar__title">
            <strong>{meta.title}</strong>
            {meta.subtitle && <span>{meta.subtitle}</span>}
          </div>
          <div className="topbar__actions">
            <IconButton aria-label="검색" title="검색"><Icon name="search" size={14} strokeWidth={1.7} /></IconButton>
            {meta.action && <Button onClick={openNewItemModal} title={`${meta.action} (${shortcutModifier}N)`} variant="primary"><Icon name="plus" size={13} strokeWidth={2} />{meta.action}</Button>}
          </div>
        </header>
        <section className="workspace__content"><Outlet /></section>
      </main>

      <SettingsModal
        accentColor={accentColor}
        aiSettingsStore={aiSettingsStore}
        mediaMaintenance={mediaMaintenance}
        onClose={() => setSettingsOpen(false)}
        onAccentColorChange={setAccentColor}
        onThemeChange={setTheme}
        open={settingsOpen}
        r2SettingsStore={r2SettingsStore}
        theme={theme}
      />
      <Modal className="quick-capture-modal" icon="sparkles" onClose={() => setQuickCaptureOpen(false)} open={quickCaptureOpen} title="빠른 캡처">
        <QuickCapture autoFocus repository={dashboardRepository} snapshot={dashboardQuery.data} />
        <div className="quick-capture-shortcut" aria-hidden="true">
          <kbd>{shortcutModifier}K</kbd><span>빠른 캡처</span><kbd>ESC</kbd><span>닫기</span>
        </div>
      </Modal>
    </div>
  );
}

function SettingsModal({ open, onClose, theme, onThemeChange, accentColor, onAccentColorChange, aiSettingsStore, mediaMaintenance, r2SettingsStore }: {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  accentColor: string;
  onAccentColorChange: (accentColor: string) => void;
  aiSettingsStore: AiSettingsStore;
  mediaMaintenance: MediaMaintenance;
  r2SettingsStore: R2SettingsStore;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  return (
    <Modal className="settings-modal" icon="settings" onClose={onClose} open={open} title="설정">
      <div className="settings-layout">
        <aside className="settings-navigation">
          <span>설정</span>
          <nav aria-label="설정 항목">
            {settingsSections.map((section) => (
              <button
                aria-current={activeSection === section.id ? "page" : undefined}
                className={activeSection === section.id ? "settings-navigation__item settings-navigation__item--active" : "settings-navigation__item"}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <Icon name={section.icon} size={14} />
                <span>{section.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="settings-content">
          {activeSection === "appearance" && (
            <>
              <SettingsHeading description="앱 전체의 색상과 화면 표현을 변경합니다." title="화면" />
              <section className="settings-group">
                <header><strong>테마</strong><span>변경 사항은 모든 화면에 즉시 적용됩니다.</span></header>
                <div aria-label="화면 테마" className="settings-theme-options" role="radiogroup">
                  <button aria-checked={theme === "light"} onClick={() => onThemeChange("light")} role="radio" type="button">
                    <span className="settings-theme-preview settings-theme-preview--light" />
                    <span><Icon name="sun" size={13} />라이트</span>
                  </button>
                  <button aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")} role="radio" type="button">
                    <span className="settings-theme-preview settings-theme-preview--dark" />
                    <span><Icon name="moon" size={13} />다크</span>
                  </button>
                </div>
              </section>
              <section className="settings-group">
                <header><strong>강조색</strong><span>버튼, 선택 상태와 포커스에 앱 전체에서 적용됩니다.</span></header>
                <div className="settings-accent-control">
                  <ColorPicker icon="edit" label="강조색" onChange={onAccentColorChange} selected value={accentColor} />
                  <span>{accentColor.toUpperCase()}</span>
                </div>
              </section>
            </>
          )}

          {activeSection === "ai" && <AiSettingsPanel store={aiSettingsStore} />}

          {activeSection === "storage" && (
            <>
              <StorageSettingsPanel mediaMaintenance={mediaMaintenance} />
              <R2CredentialsSection store={r2SettingsStore} />
            </>
          )}

          {activeSection === "about" && (
            <>
              <SettingsHeading description="현재 설치된 앱과 데이터 처리 정보를 확인합니다." title="정보" />
              <section className="settings-group settings-about">
                <div><span>앱</span><strong>mono</strong></div>
                <div><span>버전</span><strong>0.1.1</strong></div>
                <div><span>데이터</span><strong>이 기기에 저장</strong></div>
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
      <SettingsHeading description="R2에 남은 사진·영상 파일을 관리합니다." title="저장공간" />
      <section aria-label="미사용 미디어 정리" className="settings-group settings-ai">
        <header>
          <strong>미사용 미디어</strong>
          <span>수집함과 스크랩 어느 항목도 참조하지 않는 사진·영상입니다. 항목을 지워도 파일은 남아 있습니다.</span>
        </header>
        <div className="settings-ai__status">
          <span>정리 대상</span>
          <strong>
            {usage === null ? "확인 필요" : usage.count === 0 ? "없음" : `${usage.count}개 · ${formatMediaSize(usage.bytes)}`}
          </strong>
          <Button loading={pending === "scan"} onClick={() => void run("scan", async () => {
            const scanned = await mediaMaintenance.orphanUsage();
            setUsage(scanned);
            if (scanned.count === 0) setMessage("정리할 미디어가 없습니다.");
          })} type="button">확인</Button>
          <Button
            disabled={!usage || usage.count === 0}
            loading={pending === "clean"}
            onClick={() => void run("clean", async () => {
              const deleted = await mediaMaintenance.gc();
              setUsage({ count: 0, bytes: 0 });
              setMessage(`미디어 ${deleted}개를 삭제했습니다.`);
            })}
            type="button"
            variant="danger"
          >
            정리
          </Button>
        </div>
        {message && <p className="settings-ai__message" role="status">{message}</p>}
        {error && <p className="settings-ai__error" role="alert">{error}</p>}
        <p className="settings-ai__notice-text">삭제한 파일은 되돌릴 수 없습니다.</p>
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
    <section aria-label="R2 자격증명 설정" className="settings-group settings-ai">
      <header>
        <strong>Cloudflare R2</strong>
        <span>사진·영상은 이 자격증명으로 R2 버킷에 저장됩니다. 서버에 암호화되어 저장되며 앱 화면으로 다시 노출되지 않습니다.</span>
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
          setMessage("R2 자격증명을 저장했습니다.");
        });
      }}>
        <Input aria-label="계정 ID" autoComplete="off" onChange={(event) => setAccountId(event.target.value)} placeholder="계정 ID" value={accountId} />
        <Input aria-label="액세스 키 ID" autoComplete="off" onChange={(event) => setAccessKeyId(event.target.value)} placeholder="액세스 키 ID" type="password" value={accessKeyId} />
        <Input aria-label="시크릿 액세스 키" autoComplete="off" onChange={(event) => setSecretAccessKey(event.target.value)} placeholder="시크릿 액세스 키" type="password" value={secretAccessKey} />
        <Input aria-label="버킷 이름" autoComplete="off" onChange={(event) => setBucket(event.target.value)} placeholder="버킷 이름" value={bucket} />
        <Button disabled={!canSave} loading={pending === "save"} type="submit" variant="primary">저장</Button>
      </form>
      <div className="settings-ai__status">
        <span>상태</span>
        <strong>{hasCredentials === null ? "확인 중" : hasCredentials ? "설정됨" : "설정 안 됨"}</strong>
        <Button disabled={!hasCredentials} loading={pending === "test"} onClick={() => void run("test", async () => {
          await store.testConnection();
          setMessage("R2 연결에 성공했습니다.");
        })} type="button">연결 테스트</Button>
        <Button disabled={!hasCredentials} loading={pending === "delete"} onClick={() => void run("delete", async () => {
          await store.deleteCredentials();
          setHasCredentials(false);
          setMessage("R2 자격증명을 삭제했습니다.");
        })} type="button">삭제</Button>
      </div>
      {message && <p className="settings-ai__message" role="status">{message}</p>}
      {error && <p className="settings-ai__error" role="alert">{error}</p>}
    </section>
  );
}

const providerMeta: Record<AiProviderId, { label: string; keyPlaceholder: string; keySource: string; dataNotice: string; model: string }> = {
  gemini: {
    label: "Gemini",
    keyPlaceholder: "Google AI Studio API 키",
    keySource: "Google AI Studio",
    dataNotice: "분류할 텍스트와 사진은 Google Gemini API로 전송됩니다. 무료 등급에서는 Google 정책에 따라 제출 데이터가 제품 개선에 사용될 수 있습니다.",
    model: "gemini-2.5-flash-lite",
  },
  openai: {
    label: "OpenAI",
    keyPlaceholder: "OpenAI API 키",
    keySource: "OpenAI Platform",
    dataNotice: "분류할 텍스트와 사진은 OpenAI API로 전송됩니다.",
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
      <SettingsHeading description="각 API 키에서 빠른 캡처에 사용할 모델을 선택합니다." title="AI" />
      {providerError?.provider === null && <p className="settings-ai__error settings-ai__provider-error" role="alert">{providerError.message}</p>}
      <div aria-label="사용할 AI 모델" className="settings-ai-providers" role="radiogroup">
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
    <section aria-label={`${meta.label} API 키 설정`} className={`settings-group settings-ai settings-ai--provider ${active ? "settings-ai--active" : "settings-ai--inactive"}`}>
      <header className="settings-ai__provider-header">
        <label>
          <input checked={active} disabled={providerPending} name="active-ai-provider" onChange={onSelect} type="radio" />
          <span className="settings-ai__provider-title"><strong>{meta.label} API 키</strong><small>{meta.model}</small></span>
        </label>
        <span>서버에 암호화되어 저장되며 앱 화면으로 다시 노출되지 않습니다.</span>
      </header>
      <div className="settings-ai__body">
        <form onSubmit={(event) => {
          event.preventDefault();
          void run("save", async () => {
            await store.setApiKey(provider, apiKey);
            setApiKey("");
            setHasKey(true);
            setMessage("API 키를 저장했습니다.");
          });
        }}>
          <Input
            aria-label={`${meta.label} API 키`}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasKey ? "새 키로 교체" : meta.keyPlaceholder}
            type="password"
            value={apiKey}
          />
          <Button disabled={!apiKey.trim()} loading={pending === "save"} type="submit" variant="primary">저장</Button>
        </form>
        <div className="settings-ai__status">
          <span>상태</span>
          <strong>{hasKey === null ? "확인 중" : hasKey ? "키 저장됨" : "키 없음"}</strong>
          <Button disabled={!hasKey} loading={pending === "test"} onClick={() => void run("test", async () => {
            await store.testConnection(provider);
            setMessage(`${meta.label} 연결에 성공했습니다.`);
          })} type="button">연결 테스트</Button>
          <Button disabled={!hasKey} loading={pending === "delete"} onClick={() => void run("delete", async () => {
            await store.deleteApiKey(provider);
            setHasKey(false);
            setMessage("API 키를 삭제했습니다.");
          })} type="button">삭제</Button>
        </div>
        {selectionError && <p className="settings-ai__error" role="alert">{selectionError}</p>}
        {message && <p className="settings-ai__message" role="status">{message}</p>}
        {error && <p className="settings-ai__error" role="alert">{error}</p>}
        <p className="settings-ai__notice-text">{meta.dataNotice}</p>
      </div>
    </section>
  );
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function SettingsHeading({ title, description }: { title: string; description: string }) {
  return <header className="settings-heading"><strong>{title}</strong><p>{description}</p></header>;
}
