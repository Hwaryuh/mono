import { Button, Checkbox, ColorPicker, Icon, IconButton, Input, Modal, MorphingIcon, type IconName } from "@mono/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import type { DashboardRepository } from "../features/dashboard/dashboard-repository";
import { dashboardQueryKey, formatMediaSize, QuickCapture } from "../features/dashboard/QuickCapture";
import type { InboxRepository } from "../features/inbox/inbox-repository";
import type { TodoRepository } from "../features/todo/todo-repository";
import type { RoutineRepository } from "../features/routine/routine-repository";
import type { CalendarRepository } from "../features/calendar/calendar-repository";
import type { ScrapRepository } from "../features/scrap/scrap-repository";
import { useMediaStore } from "../infrastructure/media/media-store-context";
import { referencedMediaIds } from "../infrastructure/media/referenced-media-ids";
import { useNavigate } from "react-router";
import { currentIsoDate, koreanDateLabel, koreanMonthLabel } from "@mono/domain";
import { accentForegroundOf, LocalStorageAccentColorPreferenceStore } from "./accent-color-preference";
import { InMemoryAiSettingsStore, type AiProviderId, type AiSettingsStore } from "../infrastructure/ai/ai-settings-store";

type NavigationItem = {
  to: string;
  label: string;
  icon: IconName;
  badge?: string;
  nested?: boolean;
};

type Theme = "light" | "dark";
type SettingsSectionId = "appearance" | "ai" | "accessibility" | "storage" | "about";

interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: IconName;
}

const settingsSections: SettingsSectionDefinition[] = [
  { id: "appearance", label: "화면", icon: "sun" },
  { id: "ai", label: "AI", icon: "sparkles" },
  { id: "accessibility", label: "접근성", icon: "todo" },
  { id: "storage", label: "저장공간", icon: "layers" },
  { id: "about", label: "정보", icon: "note" },
];

const accentColorPreferenceStore = LocalStorageAccentColorPreferenceStore.of(window.localStorage);
const defaultAiSettingsStore = new InMemoryAiSettingsStore();

const routeMeta: Record<string, { title: string; subtitle: string; icon: IconName; action?: string }> = {
  "/dashboard": { title: "대시보드", subtitle: "", icon: "grid" },
  "/inbox": { title: "수집함", subtitle: "", icon: "inbox" },
  "/todo": { title: "할 일", subtitle: "", icon: "todo", action: "새 할 일" },
  "/routine": { title: "루틴", subtitle: "", icon: "routine", action: "새 루틴" },
  "/calendar": { title: "일정", subtitle: "", icon: "calendar", action: "새 일정" },
  "/scrap": { title: "스크랩", subtitle: "", icon: "scrap", action: "스크랩 추가" },
  "/ledger": { title: "가계부", subtitle: "", icon: "wallet", action: "지출 추가" },
};

export function AppShell({ aiSettingsStore = defaultAiSettingsStore, dashboardRepository, inboxRepository, todoRepository, routineRepository, calendarRepository, scrapRepository }: { aiSettingsStore?: AiSettingsStore; dashboardRepository: DashboardRepository; inboxRepository: InboxRepository; todoRepository: TodoRepository; routineRepository: RoutineRepository; calendarRepository: CalendarRepository; scrapRepository: ScrapRepository }) {
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [accentColor, setAccentColor] = useState(() => accentColorPreferenceStore.read());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
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
    document.documentElement.dataset.reducedMotion = reducedMotion ? "true" : "false";
  }, [reducedMotion]);

  useEffect(() => {
    setQuickCaptureOpen(false);
  }, [pathname]);

  useEffect(() => {
    const openQuickCapture = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (!event.repeat) setQuickCaptureOpen(true);
    };
    window.addEventListener("keydown", openQuickCapture);
    return () => window.removeEventListener("keydown", openQuickCapture);
  }, []);

  useEffect(() => {
    const toggleSettings = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key !== ",") return;
      event.preventDefault();
      if (!event.repeat) setSettingsOpen((current) => !current);
    };
    window.addEventListener("keydown", toggleSettings);
    return () => window.removeEventListener("keydown", toggleSettings);
  }, []);

  useEffect(() => {
    const openNewItem = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "n" || !meta.action) return;
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
              <strong>내 플랫폼</strong>
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
              title={settingsOpen ? "설정 닫기" : "설정"}
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
            {meta.action && <Button onClick={openNewItemModal} title={`${meta.action} (Ctrl+N)`} variant="primary"><Icon name="plus" size={13} strokeWidth={2} />{meta.action}</Button>}
          </div>
        </header>
        <section className="workspace__content"><Outlet /></section>
      </main>

      <SettingsModal
        accentColor={accentColor}
        aiSettingsStore={aiSettingsStore}
        inboxRepository={inboxRepository}
        onClose={() => setSettingsOpen(false)}
        onAccentColorChange={setAccentColor}
        onReducedMotionChange={setReducedMotion}
        onThemeChange={setTheme}
        open={settingsOpen}
        reducedMotion={reducedMotion}
        scrapRepository={scrapRepository}
        theme={theme}
      />
      <Modal className="quick-capture-modal" icon="sparkles" onClose={() => setQuickCaptureOpen(false)} open={quickCaptureOpen} title="빠른 캡처">
        <QuickCapture autoFocus repository={dashboardRepository} snapshot={dashboardQuery.data} />
        <div className="quick-capture-shortcut" aria-hidden="true"><kbd>ESC</kbd><span>닫기</span></div>
      </Modal>
    </div>
  );
}

function SettingsModal({ open, onClose, theme, onThemeChange, accentColor, onAccentColorChange, reducedMotion, onReducedMotionChange, aiSettingsStore, inboxRepository, scrapRepository }: {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  accentColor: string;
  onAccentColorChange: (accentColor: string) => void;
  reducedMotion: boolean;
  onReducedMotionChange: (reducedMotion: boolean) => void;
  aiSettingsStore: AiSettingsStore;
  inboxRepository: InboxRepository;
  scrapRepository: ScrapRepository;
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

          {activeSection === "accessibility" && (
            <>
              <SettingsHeading description="움직임과 상호작용 효과를 편안하게 조정합니다." title="접근성" />
              <section className="settings-group settings-toggle-row">
                <div><strong>애니메이션 줄이기</strong><span>모핑 아이콘과 창 전환 애니메이션을 끕니다.</span></div>
                <Checkbox checked={reducedMotion} label="애니메이션 줄이기" onCheckedChange={onReducedMotionChange} />
              </section>
            </>
          )}

          {activeSection === "ai" && <AiSettingsPanel store={aiSettingsStore} />}

          {activeSection === "storage" && (
            <StorageSettingsPanel inboxRepository={inboxRepository} scrapRepository={scrapRepository} />
          )}

          {activeSection === "about" && (
            <>
              <SettingsHeading description="현재 설치된 앱과 데이터 처리 정보를 확인합니다." title="정보" />
              <section className="settings-group settings-about">
                <div><span>앱</span><strong>내 플랫폼</strong></div>
                <div><span>버전</span><strong>0.1.0</strong></div>
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
 * 미사용 미디어 정리. 사진·영상 바이트는 이 PC에만 있고 참조는 서버에만 있어서, 참조 목록을
 * 못 받은 채로 지우면 살아 있는 미디어가 날아간다. 그래서 자동 실행 대신 수동 2단계로 둔다.
 * 1) 확인: 서버 참조 목록을 받아 삭제 대상 개수·용량만 계산한다(지우지 않는다).
 * 2) 정리: 참조 목록을 다시 받아 그 기준으로 지운다 — 확인 이후 추가된 미디어를 지우지 않으려고.
 * 어느 단계든 스냅샷 조회가 실패하면 던져서 삭제까지 가지 않는다.
 */
function StorageSettingsPanel({ inboxRepository, scrapRepository }: {
  inboxRepository: InboxRepository;
  scrapRepository: ScrapRepository;
}) {
  const mediaStore = useMediaStore();
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
      <SettingsHeading description="이 기기에 남은 사진·영상 파일을 관리합니다." title="저장공간" />
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
            const keepIds = await referencedMediaIds(inboxRepository, scrapRepository);
            const scanned = await mediaStore.orphanUsage(keepIds);
            setUsage(scanned);
            if (scanned.count === 0) setMessage("정리할 미디어가 없습니다.");
          })} type="button">확인</Button>
          <Button
            disabled={!usage || usage.count === 0}
            loading={pending === "clean"}
            onClick={() => void run("clean", async () => {
              const keepIds = await referencedMediaIds(inboxRepository, scrapRepository);
              const deleted = await mediaStore.gc(keepIds);
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
        <p className="settings-ai__notice-text">
          삭제한 파일은 되돌릴 수 없습니다. API 서버에 연결하지 못하면 참조 목록을 확인할 수 없어 아무것도 지우지 않습니다.
        </p>
      </section>
    </>
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
  const [providerError, setProviderError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    store.getActiveProvider()
      .then((provider) => { if (active) setActiveProviderState(provider); })
      .catch((cause: unknown) => { if (active) setProviderError(messageOf(cause)); });
    return () => { active = false; };
  }, [store]);

  async function selectProvider(provider: AiProviderId) {
    setProviderPending(true);
    setProviderError(null);
    try {
      await store.setActiveProvider(provider);
      setActiveProviderState(provider);
    } catch (cause) {
      setProviderError(messageOf(cause));
    } finally {
      setProviderPending(false);
    }
  }

  return (
    <>
      <SettingsHeading description="빠른 캡처의 텍스트와 사진을 분류할 AI 모델을 고릅니다." title="AI" />
      <section className="settings-group">
        <header><strong>사용할 모델</strong><span>API 키를 설정한 쪽을 선택하세요.</span></header>
        <div aria-label="AI provider" className="settings-theme-options" role="radiogroup">
          {(Object.keys(providerMeta) as AiProviderId[]).map((provider) => (
            <button
              aria-checked={activeProvider === provider}
              disabled={providerPending}
              key={provider}
              onClick={() => void selectProvider(provider)}
              role="radio"
              type="button"
            >
              <span>{providerMeta[provider].label}</span>
              <span>{providerMeta[provider].model}</span>
            </button>
          ))}
        </div>
        {providerError && <p className="settings-ai__error" role="alert">{providerError}</p>}
      </section>

      <ApiKeySection
        deleteKey={() => store.deleteGeminiApiKey()}
        hasKey={() => store.hasGeminiApiKey()}
        provider="gemini"
        setKey={(apiKey) => store.setGeminiApiKey(apiKey)}
        testConnection={() => store.testGeminiConnection()}
      />
      <ApiKeySection
        deleteKey={() => store.deleteOpenaiApiKey()}
        hasKey={() => store.hasOpenaiApiKey()}
        provider="openai"
        setKey={(apiKey) => store.setOpenaiApiKey(apiKey)}
        testConnection={() => store.testOpenaiConnection()}
      />
    </>
  );
}

function ApiKeySection({ provider, hasKey: checkHasKey, setKey, deleteKey, testConnection }: {
  provider: AiProviderId;
  hasKey: () => Promise<boolean>;
  setKey: (apiKey: string) => Promise<void>;
  deleteKey: () => Promise<void>;
  testConnection: () => Promise<void>;
}) {
  const meta = providerMeta[provider];
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [pending, setPending] = useState<"save" | "test" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    checkHasKey()
      .then((configured) => { if (active) setHasKey(configured); })
      .catch((cause: unknown) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [checkHasKey]);

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
    <section aria-label={`${meta.label} API 키 설정`} className="settings-group settings-ai">
      <header>
        <strong>{meta.label} API 키</strong>
        <span>서버에 암호화되어 저장되며 앱 화면으로 다시 노출되지 않습니다.</span>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault();
        void run("save", async () => {
          await setKey(apiKey);
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
          await testConnection();
          setMessage(`${meta.label} 연결에 성공했습니다.`);
        })} type="button">연결 테스트</Button>
        <Button disabled={!hasKey} loading={pending === "delete"} onClick={() => void run("delete", async () => {
          await deleteKey();
          setHasKey(false);
          setMessage("API 키를 삭제했습니다.");
        })} type="button">삭제</Button>
      </div>
      {message && <p className="settings-ai__message" role="status">{message}</p>}
      {error && <p className="settings-ai__error" role="alert">{error}</p>}
      <p className="settings-ai__notice-text">{meta.dataNotice} 모델: {meta.model}</p>
    </section>
  );
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function SettingsHeading({ title, description }: { title: string; description: string }) {
  return <header className="settings-heading"><strong>{title}</strong><p>{description}</p></header>;
}
