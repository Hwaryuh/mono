# mono iOS — SwiftUI 구현 핸드오프

전제: 원격 `mono-api` 서버가 유일한 소스. iOS는 임베드 서버 모드를 갖지 않는다.
IA: 오늘 화면 루트 + NavigationStack. **TabView·하단 탭바·하단 고정 액션·드로어를 쓰지 않는다.**
참고: `HANDOFF-design-system.md`, `prototype/prototype.dc.html`, `prototype/wireframes.dc.html`

---

## 패치 이력

### 2026-09-03 — origin/main 0.3.5 재대조

첫 감사는 `040c3f9`(0.1.271) 기준이었다. `origin/main`이 36커밋 앞서 있었고 pull 후 재대조:

- **루틴 삭제 생겼다.** `DELETE /routine/items/{id}`(`routine.rs`, `feat(routine): delete a routine`). 루틴 + 발생 기록을 지운다. §5-1 공백에서 제거. "중단"은 이제 대체가 아니라 별개 옵션(종료일 설정) — 둘 다 제공.
- **스크랩에 파일 첨부 생겼다.** `scrapKind`에 `"file"` 추가. 스크랩 항목·댓글 모두 이미지가 아닌 파일을 붙일 수 있다(`fileName`/`fileSize`, 최대 50MB). §2-7·§8 미디어 표현에 반영.
- 일정 아젠다 다중일 표시가 서버에서 정직해짐(`polish(calendar)`) — 핸드오프 §2-6 "N일차"와 일치.
- 계약(`packages/contracts/src/index.ts`)이 바뀌었으므로 OpenAPI 재생성 필요.

### 2026-09-02 — 서버 API 대조 반영 (`crates/mono-api/src` 실측)

초안 §5 API 매핑이 `apps/api`(Node) 경로 기억으로 작성돼 실제 axum 서버와 어긋났다. 대조 후 수정:

1. **모든 스냅샷 경로는 `GET /{module}/snapshot`.** `GET /todo` 식이 아니다. 오늘 화면은 `GET /dashboard/snapshot`, 캡처는 `POST /dashboard/capture`.
2. **낙관적 동시성 = `If-Match` 버전 헤더 + `409 Conflict`.** 모든 `PUT`은 레코드별 `version`(스냅샷에 포함)을 `If-Match: "<version>"`로 되돌려보내야 하고, 불일치 시 서버가 409 `"다른 기기에서 먼저 수정했습니다…"`를 낸다. §6 상태 모델에 `conflict` 케이스 추가.
3. **SSE `/events` 스트림이 이미 있다.** 멀티기기 무효화 신호. 인증 없이 공개. §4에 구독 계층, §7에 수용 기준 추가.
4. **수집함 "고정"은 사용자 동작이 아니다.** `pinned`는 서버가 파생한다(영상 소스 → 자동 고정). pin 토글 엔드포인트도, `PUT /inbox/items/{id}` 입력 필드도 없다. §2-3·§5·수용 기준 33 수정.
5. **가계부 월 전환은 서버 호출이 아니다.** `GET /ledger/snapshot`은 파라미터가 없고 항상 이번 달 + 지난달 합계를 준다. `expenses`는 **전체**가 내려오므로 월 전환은 로컬 필터. 특정 과거 월 로드 API 없음.
6. **일정 스냅샷은 `?from=YYYY-MM-DD&to=YYYY-MM-DD`(날짜 범위)** — `?month=`이 아니다. 클라이언트가 보이는 달의 범위를 보낸다.
7. 미디어 정리 = `POST /media/gc`(+ `GET /media/orphan-stats`), `POST /media/cleanup` 아님. `POST /media/credentials/test` 연결 테스트 존재.
8. AI 프로바이더 선택 = `GET/POST /ai/provider`. 프로바이더별 키(`/ai/keys/{provider}`)와 별개.

아래 본문은 이 패치를 이미 반영한 상태다.

---

## 0. 제품 요약 (저장소 감사 결과)

mono는 개인용 작업 공간이다. 텍스트·사진·영상을 한 곳에 던지면(빠른 캡처) AI가 어느 모듈에 속하는지 분류해 수집함에 후보로 쌓고, 사람이 승인하면 해당 모듈의 실제 항목이 된다.

모듈: 오늘(대시보드) · 수집함 · 할 일 · 루틴 · 일정 · 스크랩 · 가계부 · 설정.

관계: 수집함이 다른 네 모듈(할 일·일정·가계부·스크랩)의 입구다. 오늘 화면은 네 모듈의 오늘분 + 수집함 대기 + 월 지출 요약 + 최근 스크랩을 읽기 전용으로 모아 보여주고, 체크 토글만 그 자리에서 처리한다.

주 워크플로:
1. 캡처 → AI 분석 → 수집함 승인 → 모듈 항목 생성
2. 오늘 화면에서 오늘 할 일·루틴 체크
3. 각 모듈에서 직접 생성·편집·삭제
4. 서버 연결과 AI 키 설정

보존할 시각 특성: 따뜻한 중성 배경, 0.5pt 경계와 정밀한 여백, 그림자 없는 조용한 표면, 의미 있는 강조색 하나, 밀도 있지만 차분한 정보 표현.

iOS로 옮기지 않는 데스크톱 전제:
- 좌측 영구 사이드바 (→ 오늘 루트 + 상단 툴바 메뉴)
- 임베드 로컬 서버 모드 (→ 원격 전용)
- R2 자격증명 입력 화면 (→ 서버 관리 작업으로 판단해 제외. 필요하면 추가)
- 강조색 자유 선택기 (→ 큐레이션 5색, 대비 보장)
- 재시작 후 적용되는 서버 설정 (→ 저장 즉시 적용)
- 마우스 호버 상태 (→ 스와이프 + 컨텍스트 메뉴 + 명시적 버튼)

데스크톱 화면과 API의 불일치:
- 상단바에 검색 버튼이 있으나 서버에 검색 엔드포인트가 없다 → iOS는 `.searchable`로 **로컬 필터**만 제공하고, 서버 검색은 API 추가 후.
- 루틴 삭제 UI는 없고 삭제 엔드포인트도 없다 → "중단"(종료일=오늘)으로 대체.
- 분석 재시도 엔드포인트가 없다 → 실패 항목은 직접 채워 승인하거나 버린다.
- 할 일 항목 순서 변경은 없다(라벨 순서만 있다) → 항목 정렬은 마감일 기준 고정.

---

## 1. 내비게이션 모델

### 1-1. 루트

```swift
@main struct MonoApp: App {
    @StateObject private var session = SessionStore()
    var body: some Scene {
        WindowGroup {
            if session.isConnected { RootView() } else { ServerConnectionView(mode: .firstRun) }
        }
        .environmentObject(session)
    }
}

struct RootView: View {
    @State private var path = NavigationPath()
    @State private var sheet: SheetRoute?
    var body: some View {
        NavigationStack(path: $path) {
            TodayView()
                .navigationTitle("오늘")
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { ModuleMenu(path: $path) }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { sheet = .capture } label: { Label("빠른 캡처", systemImage: "sparkles") }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink(value: Route.settings) { Label("설정", systemImage: "slider.horizontal.3") }
                    }
                }
                .navigationDestination(for: Route.self, destination: destination)
        }
        .sheet(item: $sheet) { SheetHost(route: $0) }
    }
}
```

### 1-2. 타입 있는 목적지

```swift
enum Route: Hashable {
    case todo, todoDetail(Todo.ID), todoLabels
    case routine, routineDetail(Routine.ID)
    case calendar, event(CalendarEvent.ID), calendarCategories
    case scrap, scrapDetail(Scrap.ID)
    case ledger, ledgerCategories
    case inbox, inboxItem(InboxItem.ID)
    case settings, appearance, serverConnection, aiSettings, storage, about
}

enum SheetRoute: Identifiable, Hashable {
    case capture
    case todoForm(Todo.ID?)
    case routineForm(Routine.ID?)
    case eventForm(CalendarEvent.ID?)
    case scrapForm(Scrap.ID?)
    case expenseForm(Expense.ID?)
    case inboxTarget(InboxItem.ID)
    case inboxFields(InboxItem.ID)
    var id: String { String(describing: self) }
}
```

### 1-3. 계층

```
오늘 (루트, largeTitle)
├─ 좌측 상단 Menu → 6개 모듈 중 하나 push
├─ 우측 상단 sparkles → 빠른 캡처 sheet
├─ 우측 상단 slider → 설정 push
├─ 모듈 타일(6) → 각 모듈 push
├─ 섹션 헤더 "전체" → 해당 모듈 push
└─ 항목 탭 → 해당 상세 직접 push (모듈 목록을 건너뛴다)

할 일 → 할 일 상세 → (편집 sheet)
      → 라벨 관리
루틴 → 루틴 상세 → (편집 sheet)
일정 → 일정 상세 → (편집 sheet)
      → 라벨 관리
스크랩 → 스크랩 상세 → (편집 sheet)
가계부 → 라벨 관리 / (지출 sheet)
수집함 → 수집 항목 → (대상 모듈 sheet) / (필드 편집 sheet)
설정 → 화면 / 언어 / 서버 연결 / AI / 저장공간 / 정보
```

**전체 화면 커버는 쓰지 않는다.** 미디어 전체 보기만 후보였으나 `.sheet` + `.presentationDetents([.large])`로 충분하다.

### 1-4. 홈으로 돌아가기

- 표준 백 버튼(직전 화면 제목 표시) + 에지 스와이프.
- 오늘 화면 이름을 백 버튼 라벨에 그대로 쓴다 — "‹ 오늘".
- 깊은 스택에서 백 버튼 롱프레스 → 시스템 기본 백 스택 메뉴로 루트 이동.
- 오늘 화면 이외에서 좌측 상단 모듈 메뉴를 다시 열 수 있게 하되, 모듈 선택 시 `path`를 **교체**한다(누적하지 않는다): `path = NavigationPath([.calendar])`.

### 1-5. 상태 복원 · 딥링크

```swift
@SceneStorage("navigationPath") private var pathData: Data?
```

`Route`가 `Codable`이면 `NavigationPath`의 `codable` 표현을 직렬화한다. 복원 규칙:

- 재실행 시 서버 연결이 유효하면 경로를 복원한다. 유효하지 않으면 연결 화면부터 시작하고 경로는 버린다.
- 시트는 복원하지 않는다. 작성 중이던 캡처 초안만 별도로 `@AppStorage`에 남겨 복구를 제안한다.
- 복원한 경로의 상세 화면 대상이 서버에 없으면(삭제됨) 해당 화면을 pop하고 목록에 "항목이 삭제되었습니다" 배너.

딥링크 (`mono://` 또는 유니버설 링크):

| 링크 | 경로 |
|---|---|
| `/inbox` | `[.inbox]` |
| `/inbox/{id}` | `[.inbox, .inboxItem(id)]` |
| `/todo/{id}` | `[.todo, .todoDetail(id)]` |
| `/calendar?date=YYYY-MM-DD` | `[.calendar]` + 선택 날짜 |
| `/capture` | 루트 + `sheet = .capture` |

알림(예: "분석이 끝났습니다")은 `/inbox/{id}`로 연결한다. 항상 루트를 스택 바닥에 두고 목적지를 push하므로 백이 자연스럽다.

### 1-6. 에지 스와이프 보존

- `.navigationBarBackButtonHidden(true)`를 쓰지 않는다.
- 왼쪽 24pt 영역에 `DragGesture`, 커스텀 스와이프 컨트롤, 가로 스크롤 뷰의 시작점을 두지 않는다. 스크랩 가로 스크롤은 좌측 20pt 여백 안쪽에서 시작한다.
- 목록 스와이프 동작은 trailing 쪽만 쓴다(`edge: .trailing`).

---

## 2. 화면 인벤토리

각 항목: 목적 / 진입 / 1차 동작 / 2차 동작 / 필요 데이터 / 로딩 / 빈 / 오류 / 변경 상태 / 목적지 / 접근성

### 2-1. 오늘 (`TodayView`)

- **목적** 오늘 주의가 필요한 것을 우선순위대로 보여주고 모든 모듈의 입구가 된다
- **진입** 앱 루트, 모든 백 경로의 끝
- **1차 동작** 오늘 할 일·루틴 체크
- **2차** 빠른 캡처, 설정, 모듈 이동, 항목 상세 이동, 당겨서 새로고침
- **데이터** `GET /dashboard/snapshot` → `dashboardSnapshot`
- **로딩** 타일 6개 + 상단 두 섹션 스켈레톤
- **빈** 섹션별 한 줄 빈 상태. 타일은 숫자만 0
- **오류** 상단 배너 + 캐시 유지 + 재시도
- **변경** 체크 토글은 낙관적 반영, 실패 시 되돌리고 토스트
- **목적지** 6개 모듈, 각 항목 상세, 설정, 캡처 시트
- **접근성** 타일은 `Label + accessibilityValue(개수)`; 3열 → 접근성 크기에서 2열 → 목록

### 2-2. 빠른 캡처 (`CaptureSheet`)

- **목적** 분류하지 않고 무엇이든 던져 넣는다
- **진입** 오늘·수집함 우측 상단 sparkles, 딥링크
- **1차** 보내기
- **2차** 사진 최대 4장 / 영상 1개 추가·제거, 취소
- **데이터** 없음(쓰기 전용). 상한은 계약값(텍스트 2000자, 사진 4, 영상 1)
- **로딩** 없음
- **빈** 텍스트·미디어 모두 없으면 보내기 비활성
- **오류** 업로드 실패는 항목별 재시도, 분석 실패는 시트에 인라인 오류 + "수집함에 그대로 두기"
- **변경** `uploading(progress) → analyzing → success | failed`
- **목적지** 성공 시 시트 닫고 오늘 화면 배너 갱신, "수집함 열기" 제공
- **접근성** 첨부 제거 버튼에 "사진 1 제거" 라벨; 진행 상태는 `accessibilityValue`로 읽히고 Reduce Motion에서 단계 텍스트만 갱신
- **주의** 작성 중 내용이 있으면 닫기 시 확인 대화상자

### 2-3. 수집함 (`InboxView`, `InboxItemView`)

- **목적** AI 후보를 사람이 확인해 각 모듈로 보낸다
- **진입** 오늘 타일·배너, 모듈 메뉴, 딥링크
- **1차** 승인
- **2차** 대상 모듈 변경, 필드 편집, 버리기, 확신 높은 항목 일괄 승인, 상태 필터
- **데이터** `GET /inbox/snapshot` → `inboxSnapshot`
- **고정** 사용자가 고정할 수 없다. `pinned`는 서버가 영상 소스에 자동으로 붙인다. 고정 섹션은 읽기 전용으로 표시하고 토글 UI를 두지 않는다
- **로딩** 목록 스켈레톤 3행
- **빈** "수집 항목이 없습니다" + 캡처 유도. 필터로 비면 문구 다름
- **오류** 배너 + 재시도
- **변경** 승인은 서버 확인을 기다린다(다른 모듈에 항목을 만드는 동작이므로 낙관적 반영 금지)
- **목적지** 항목 상세, 대상/필드 시트
- **접근성** 확신도는 등급 텍스트로 읽힌다. "확신 보통, 0.74" 식으로 value 병기. 색만으로 구분하지 않는다
- **정직성 규칙** 퍼센트 진행 바로 확신도를 그리지 않는다. 0.7 미만 필드는 "확인 필요" 배지를 단다

### 2-4. 할 일 (`TodoListView`, `TodoDetailView`, `TodoLabelsView`)

- **목적** 마감이 있는 단발 작업 관리
- **진입** 오늘 타일·섹션, 모듈 메뉴, 딥링크
- **1차** 완료 토글
- **2차** 생성, 편집, 삭제, 상태 필터(남은 것/완료/전체), 라벨 필터, 검색, 라벨 관리·순서
- **데이터** `GET /todo/snapshot` → `todoSnapshot`
- **로딩** 스켈레톤 4행
- **빈** 필터 원인과 데이터 없음을 구분
- **오류** 배너 + 재시도
- **변경** 토글·생성·편집은 낙관적, 삭제는 확인 후 서버 확인 대기
- **목적지** 상세, 라벨 관리, 폼 시트
- **접근성** 그룹 헤더(지남/오늘/예정/완료)가 읽기 순서를 만든다. 지남은 심볼 + "2일 지남" 텍스트
- **정렬** 지남 → 오늘 → 예정(마감 오름차순, 마감 없음은 뒤) → 완료

### 2-5. 루틴 (`RoutineListView`, `RoutineDetailView`)

- **목적** 요일 반복 습관 관리
- **진입** 오늘 타일·섹션, 모듈 메뉴
- **1차** 오늘 완료 토글
- **2차** 생성, 편집, 삭제, 중단(종료일 설정), 최근 기록 확인
- **데이터** `GET /routine/snapshot` → `routineSnapshot`
- **로딩** 스켈레톤 3행
- **빈** "루틴이 없습니다" + 생성
- **오류** 배너 + 재시도
- **변경** 오늘 토글 낙관적, 삭제·중단(종료일 변경)은 확인 후 서버 확인
- **목적지** 상세, 폼 시트
- **접근성** 요일 점은 읽기 전용이며 "월·수·금 반복"으로 병합해 읽는다
- **삭제 vs 중단** `DELETE /routine/items/{id}`는 루틴과 과거 기록을 완전히 지운다. "중단"(종료일=오늘)은 기록을 남긴 채 앞으로만 멈춘다. 상세 화면에 둘 다 두고 차이를 한 줄로 설명한다

### 2-6. 일정 (`CalendarView`, `EventDetailView`, `CalendarCategoriesView`)

- **목적** 날짜가 있는 약속 관리
- **진입** 오늘 타일·섹션, 모듈 메뉴, 딥링크
- **1차** 날짜 선택 → 그날 일정 확인
- **2차** 월/아젠다 전환(로컬 세그먼트), 생성, 편집, 삭제, 카테고리 관리
- **데이터** `GET /calendar/snapshot?from=YYYY-MM-DD&to=YYYY-MM-DD` → `calendarSnapshot`. 보이는 달의 첫날~말일(앞뒤 주 채움 포함)을 범위로 보낸다
- **로딩** 월 그리드는 유지하고 하단 목록만 스켈레톤(그리드 자리가 유지되어야 한다)
- **빈** "이 날에 일정이 없습니다"
- **오류** 배너 + 재시도
- **변경** 생성·편집·삭제는 반복 일정이면 범위(this/future/all)를 먼저 묻고 서버 확인 대기
- **목적지** 일정 상세, 카테고리 관리, 폼 시트
- **접근성** 월 셀은 44×44 이상, "8월 9일, 일정 2건". 접근성 크기에서는 점 대신 개수. 아젠다 뷰가 대안 경로
- **표현** 종일은 시간 대신 "종일", 여러 날은 "여러 날 · N일차", 반복은 "매주 수요일"

### 2-7. 스크랩 (`ScrapListView`, `ScrapDetailView`)

- **목적** 메모·링크·사진·영상·파일을 태그로 모아 둔다
- **진입** 오늘 타일·섹션, 모듈 메뉴, 딥링크
- **1차** 항목 열기
- **2차** 태그 필터, 정렬(최근/제목), 생성, 편집, 미디어·파일 교체, 삭제, 댓글 추가(텍스트 또는 파일)
- **데이터** `GET /scrap/snapshot` → `scrapSnapshot`
- **종류** `image` · `url` · `text` · `video` · `file`. `file`은 이미지 아닌 첨부(`fileName`/`fileSize`, 최대 50MB). 목록 행에 문서 아이콘 + 파일명 + 크기, 상세에서 다운로드/공유(`GET /media/{id}`)
- **로딩** 그리드 자리 유지 + 썸네일 placeholder
- **빈** 태그 필터 원인과 데이터 없음을 구분
- **오류** 배너 + 재시도. 오프라인에서는 생성 비활성(업로드 필요)
- **변경** 댓글 추가는 낙관적(파일 첨부 댓글은 업로드 완료 후), 미디어·파일 교체는 업로드 완료 후 저장
- **목적지** 상세, 폼 시트
- **접근성** 그리드 셀·파일 행은 제목 + 종류 + 태그를 하나로 병합해 읽는다. 파일 행은 "파일, 제안서.pdf, 2.4MB"
- **브라우징 모델 근거** 사진·영상은 2열 그리드, 메모·링크·파일은 목록 행. 실제 데이터가 시각물과 텍스트로 반반이라 한 가지 형태로는 둘 중 하나가 낭비된다

### 2-8. 가계부 (`LedgerView`, `LedgerCategoriesView`)

- **목적** 월 지출 파악
- **진입** 오늘 지출 카드, 모듈 메뉴
- **1차** 지출 추가
- **2차** 월 전환(로컬), 편집, 삭제, 카테고리 관리·순서
- **데이터** `GET /ledger/snapshot` → `ledgerSnapshot`. 파라미터 없음. 이번 달·지난달 합계 + **전체** 지출 목록을 준다. 월 전환은 이 목록을 클라이언트가 날짜로 필터해서 처리한다(특정 과거 월 로드 API 없음)
- **로딩** 합계 자리 유지 + 내역 스켈레톤
- **빈** "N월 지출 기록이 없습니다" + 추가
- **오류** 배너 + 재시도
- **변경** 추가·편집은 낙관적(합계 즉시 갱신), 삭제는 확인 + 되돌리기 토스트
- **목적지** 카테고리 관리, 지출 시트
- **접근성** 비율 바는 숨기고 이름·비율·금액 목록을 읽는다. 모든 금액 `.monospacedDigit()`
- **금액 처리** 입력은 숫자 키패드 + 천단위 구분 표시, 저장은 원 단위 정수. `₩ , 원`은 제거해 보낸다

### 2-9. 설정 (`SettingsView` 외)

- **목적** 서버·표시·AI·유지 관리
- **진입** 오늘 우측 상단
- **1차** 없음(허브)
- **2차** 각 하위 화면 push
- **데이터** 로컬 설정 + `GET /version`, `GET /ai/provider`(활성 프로바이더), `GET /ai/keys/{provider}`(키 저장 여부), `GET /media/credentials`
- **로딩** 값 자리에 `ProgressView` 대신 "—"
- **빈** 해당 없음
- **오류** 서버 의존 값만 "확인할 수 없습니다" + 재시도
- **변경** 즉시 반영. 파괴적 동작은 확인 대화상자
- **접근성** `List(.insetGrouped)` 기본. 강조색 스와치는 44×44 + 선택 체크 심볼(색만으로 알리지 않는다)

### 2-10. 서버 연결 (`ServerConnectionView`)

- **목적** 원격 서버 주소·토큰 설정과 검증
- **진입** 첫 실행, 설정 > 서버 연결, 401 배너
- **1차** 연결 테스트
- **2차** 저장/시작하기, 토큰 삭제, 재시도
- **데이터** `GET /health`, `GET /version`, 인증 필요 엔드포인트 1회
- **로딩** "서버 응답을 기다리는 중" + 취소
- **빈** 해당 없음
- **오류** 주소 형식 / 포트 / 연결 불가 / 타임아웃 / 401 / 버전 낮음 각각 별도 문구
- **변경** `idle → testing → ok | failure(reason)`
- **목적지** 성공 시 오늘 화면으로 교체
- **접근성** 토큰 필드는 `.textContentType(.password)` + 저장 후 마스킹, 값을 다시 읽지 않는다
- **보안 문구** "토큰은 이 기기의 보안 저장소에만 보관되고 화면에 다시 표시되지 않습니다"

---

## 3. 컴포넌트 인벤토리

| 이름 | 책임 | 입력 | 상호작용 | 네이티브 기반 | 공유 | Dynamic Type / VoiceOver |
|---|---|---|---|---|---|---|
| `CheckRow` | 체크 가능한 목록 행 | 제목, 보조, 라벨(이름·색), 완료 여부 | 체크 탭, 행 탭 push, 스와이프 | `HStack` in `List` | 공유 (할 일·루틴·오늘) | 세로 스택 전환; label+value+hint |
| `NavRow` | 탐색 목록 행 | 아이콘, 제목, 보조, 값, 배지 | 탭 push | `NavigationLink` | 공유 | 병합해 한 요소로 읽음 |
| `ValueRow` | 읽기 전용 속성 행 | 키, 값 | 없음 | `LabeledContent` | 공유 | 키+값 병합 |
| `ModuleMenu` | 좌측 상단 모듈 선택 | 모듈별 개수 | 메뉴 열기 → push(경로 교체) | `Menu` | 공유 | 각 항목 label+value |
| `ModuleTileGrid` | 오늘 화면 모듈 요약 타일 | 모듈 6개(이름·개수·배지) | 탭 push | `LazyVGrid` | 오늘 전용 | 3열→2열→목록 |
| `StateBanner` | 오프라인·오류·경고·새로고침 | 종류, 제목, 상세, 동작 | 재시도 탭 | `safeAreaInset` / Section | 공유 | 읽기 순서 최상단 |
| `EmptyStateCard` | 빈 상태 | 제목, 설명, 동작 | 동작 탭 | `ContentUnavailableView` 래핑 | 공유 | 기본 동작 |
| `SkeletonList` | 초기 로딩 자리 | 행 수 | 없음 | `Rectangle` + `.redacted` | 공유 | `.accessibilityHidden(true)` + "불러오는 중" 알림 |
| `MonthGridView` | 월 캘린더 | 월, 일별 카테고리 색 | 날짜 선택 | 커스텀 `LazyVGrid` | 일정 전용 | 셀 44pt, 접근성 크기에서 개수 텍스트 |
| `WeekdayPicker` | 루틴 요일 다중 선택 | 선택된 요일 | 토글 | 커스텀 | 루틴 전용 | 44×44, 선택 상태 value |
| `ConfidenceIndicator` | AI 확신도 | 소수값 | 없음 | 커스텀 | 수집함 전용 | 등급 텍스트 필수 |
| `ExpenseBreakdownBar` | 카테고리 구성 | 카테고리·금액 | 없음 | 커스텀 | 가계부 전용 | 바 숨김, 목록으로 읽음 |
| `RoutineDayDots` | 요일 표시 (읽기 전용) | 요일 배열 | 없음 | 커스텀 | 루틴 전용 | "월·수·금 반복"으로 병합 |
| `RoutineStreakGrid` | 최근 10주 완료 격자 | 요일 배열, 종료일, 일별 완료 기록 | 없음(툴팁만) | 커스텀 `LazyHGrid(rows: 7)` | 루틴 전용 | 격자 하나로 병합해 요약 문장을 읽음; 셀 크기·라벨은 고정 12/16pt |
| `MediaTray` | 캡처 첨부 관리 | 사진·영상 목록, 상한 | 추가, 제거 | `PhotosPicker` + 커스텀 트레이 | 캡처·스크랩 공유 | 제거 버튼에 개별 라벨 |
| `MediaPreview` | 사진·영상 미리보기 | mediaId, 종류 | 탭 확대 | `AsyncImage` / `VideoPlayer` | 공유 | 누락 시 자리표시 + 설명 |
| `UploadProgressRow` | 업로드 진행 | 진행률, 취소 | 취소 | `ProgressView` | 공유 | Reduce Motion에서 단계 텍스트만 |
| `LabelDot` | 라벨·카테고리 색 점 | 색, 이름 | 없음 | 커스텀 | 공유 | 점 숨김, 이름만 읽음 |
| `ReorderableLabelList` | 라벨 순서·삭제 | 라벨 목록 | 끌어 옮기기, 삭제 | `List` + `.onMove` + `EditButton` | 공유(할 일·일정·가계부) | 접근성 옮기기 동작 제공 |
| `DestructiveConfirm` | 파괴적 동작 확인 | 제목, 본문, 동작명 | 확인/취소 | `.confirmationDialog` | 공유 | 기본 동작 |
| `Toast` | 성공 피드백 | 문구, 되돌리기 | 되돌리기 탭 | 커스텀 오버레이 | 공유 | `.accessibilityAddTraits(.isStaticText)` + announce |

---

## 4. 프로젝트 구조

```
MonoApp/
├─ App/
│  ├─ MonoApp.swift            // @main, 연결 상태에 따른 루트 분기
│  ├─ RootView.swift           // NavigationStack, 툴바, 시트 호스트
│  └─ Route.swift              // Route, SheetRoute
├─ Core/
│  ├─ Networking/
│  │  ├─ APIClient.swift       // 기본 URL, Bearer, 타임아웃, 오류 매핑, PUT에 If-Match 부착
│  │  ├─ APIError.swift        // unreachable/timeout/unauthorized/conflict/server/decoding
│  │  └─ Endpoints.swift       // 전부 /{module}/snapshot 규칙
│  ├─ Sync/
│  │  └─ ChangeStream.swift    // GET /events SSE 구독, change/resync 이벤트 → 모듈별 재조회 트리거
│  ├─ Authentication/
│  │  ├─ SessionStore.swift    // 연결 상태, 버전 호환성
│  │  └─ KeychainTokenStore.swift
│  ├─ DesignSystem/
│  │  ├─ Theme.swift           // accent(oklch→Color), Canvas/Surface
│  │  ├─ Rows.swift            // CheckRow, NavRow, ValueRow
│  │  ├─ States.swift          // StateBanner, EmptyStateCard, SkeletonList
│  │  └─ Symbols.swift
│  ├─ Media/
│  │  ├─ MediaUploader.swift   // multipart, 진행률, 취소
│  │  └─ MediaCache.swift
│  └─ Localization/
│     ├─ ko.lproj / en.lproj
│     └─ Formatters.swift      // 원 통화, 날짜, 상대 시간
├─ Features/
│  ├─ Today/   ├─ Capture/  ├─ Inbox/   ├─ Tasks/
│  ├─ Routine/ ├─ Calendar/ ├─ Scrap/   ├─ Ledger/
│  └─ Settings/
└─ Resources/Assets.xcassets
```

각 Feature 폴더: `XView.swift`, `XViewModel.swift`(`@Observable`), `XRepository.swift`(프로토콜 + HTTP 구현). 서버가 소스이므로 로컬 도메인 레이어를 따로 만들지 않는다. 계약 타입을 그대로 Codable 모델로 쓴다.

---

## 5. API 매핑

기본 URL: 사용자 설정. 인증: `Authorization: Bearer <token>` (서버에 `MONO_API_TOKEN`이 설정된 경우에만 게이트. `/health` `/version` `/events`는 항상 공개).

경로는 `crates/mono-api/src` 실측이다. `lib.rs`가 모듈 라우터를 prefix 없이 `.merge()` 하므로 아래 경로가 곧 전체 경로다.

| 워크플로 | 엔드포인트 | 낙관적 반영 | 비고 |
|---|---|---|---|
| 연결 확인 | `GET /health` | — | 공개 |
| 버전 호환성 | `GET /version` | — | 공개. `{ version }`. 서버<앱이면 경고, 차단 아님 |
| 변경 스트림 | `GET /events` (SSE) | — | 공개. §5-3 참조 |
| 오늘 화면 | `GET /dashboard/snapshot` | — | 단일 스냅샷 |
| 캡처 생성 | `POST /dashboard/capture` | 아니오 | 미디어는 먼저 업로드해 mediaId 확보. 201 |
| 오늘 할 일 토글 | `POST /dashboard/tasks/{id}/toggle` | 예 | 오늘 화면 전용 토글 경로 |
| 미디어 업로드 | `POST /media` | 아니오 | multipart, 진행률 필요. 본문 한도는 라우트가 검증 |
| 미디어 조회 | `GET /media/{id}` | — | 404 = 누락 처리 |
| 수집함 목록 | `GET /inbox/snapshot` | — | |
| 수집함 항목 수정 | `PUT /inbox/items/{id}` | 예 | 본문 = `{ target, fields[] }`. If-Match 필수 |
| 수집함 승인 | `POST /inbox/items/{id}/approve` | **아니오** | 다른 모듈에 항목 생성 |
| 일괄 승인 | `POST /inbox/approve-high-confidence` | 아니오 | `{ minimum }` 전달, 임계값을 UI에 표시 |
| 수집함 버리기 | `DELETE /inbox/items/{id}` | 아니오 | 확인 후 |
| 할 일 목록 | `GET /todo/snapshot` | — | 레코드별 `version` 포함 |
| 할 일 생성·수정 | `POST /todo/items`, `PUT /todo/items/{id}` | 예 | PUT은 If-Match |
| 할 일 완료 토글 | `POST /todo/items/{id}/toggle` | 예 | |
| 할 일 삭제 | `DELETE /todo/items/{id}` | 아니오 | |
| 라벨 CRUD | `POST /todo/labels`, `PUT/DELETE /todo/labels/{id}` | 예(순서), 아니오(삭제) | 삭제 시 `replacementLabelId` 필수 |
| 라벨 순서 | `PUT /todo/labels/order` | 예 | |
| 루틴 목록 | `GET /routine/snapshot` | — | |
| 루틴 생성·수정 | `POST /routine/items`, `PUT /routine/items/{id}` | 예 | 요일 최소 1개. PUT은 If-Match |
| 루틴 삭제 | `DELETE /routine/items/{id}` | 아니오 | 루틴 + 발생 기록 삭제. 확인 후. "중단"(PUT end_date)과 별개 |
| 루틴 오늘 토글 | `POST /routine/items/{id}/toggle-today` | 예 | 날짜 인자 없음 — 오늘만 |
| 일정 목록 | `GET /calendar/snapshot?from=&to=` | — | 날짜 범위(YYYY-MM-DD). 둘 다 옵셔널이나 iOS는 항상 보낸다 |
| 일정 생성·수정·삭제 | `POST /calendar/events`, `PUT/DELETE /calendar/events/{id}` | 아니오 | 반복은 `scope: this\|future\|all`. PUT은 If-Match |
| 일정 카테고리 | `POST /calendar/categories`, `PUT/DELETE /calendar/categories/{id}`, `PUT /calendar/categories/order` | 예(순서) | 삭제 시 `replacementCategoryId` 필수 |
| 스크랩 목록 | `GET /scrap/snapshot` | — | |
| 스크랩 CRUD | `POST /scrap/items`, `PUT/DELETE /scrap/items/{id}` | 아니오(미디어·파일 포함 시) | 항목당 mediaId 1개. `kind` 파생(`image/url/text/video/file`). `file`은 `fileName`+`fileSize`(≤50MB) 동봉. PUT은 If-Match |
| 스크랩 태그 | `POST /scrap/tags`, `DELETE /scrap/tags/{tag}` | 예 | 항목에 태그 추가·제거는 서버 동작(로컬 아님) |
| 댓글 CRUD | `POST /scrap/items/{id}/comments`, `PUT/DELETE /scrap/items/{id}/comments/{commentId}` | 예(텍스트) | 본문 = `{ text, file? }`. 텍스트나 파일 중 하나는 있어야 함. 파일 댓글은 업로드 후. PUT은 If-Match |
| 가계부 | `GET /ledger/snapshot` | — | 파라미터 없음. 이번 달·지난달 합계 + 전체 지출 목록 |
| 지출 CRUD | `POST /ledger/expenses`, `PUT/DELETE /ledger/expenses/{id}` | 예(추가·수정), 아니오(삭제) | 금액은 원 단위 정수 |
| 가계부 카테고리 | `POST /ledger/categories`, `PUT/DELETE /ledger/categories/{id}`, `PUT /ledger/categories/order` | 예(순서) | 카테고리 PUT은 If-Match |
| AI 프로바이더 | `GET/POST /ai/provider` | 아니오 | 활성 프로바이더. `{ provider }` |
| AI 키 상태 | `GET /ai/keys/{provider}` | — | 저장 여부만 반환 |
| AI 키 저장·삭제 | `POST/DELETE /ai/keys/{provider}` | 아니오 | 키는 서버에 암호화 저장 |
| AI 키 테스트 | `POST /ai/keys/{provider}/test` | — | 키 유효성 확인 |
| 미디어 자격증명 상태 | `GET /media/credentials` | — | iOS는 상태만 표시, 입력 제외 |
| 미디어 자격증명 테스트 | `POST /media/credentials/test` | — | R2 연결 확인 |
| 저장공간 사용량 | `GET /media/orphan-stats` | — | `{ count, bytes }` 고아 오브젝트 |
| 저장공간 정리 | `POST /media/gc` | 아니오 | 파괴적, 확인 필수. `{ deleted }` |
| 링크 미리보기 이미지 | `GET /link-previews/image?...` | — | 스크랩 링크 썸네일 프록시 |

### 5-1. 없는 엔드포인트 (서버 작업 필요)

1. **수집함 고정 토글** — `pinned`는 서버가 영상 소스에 자동으로 붙이고, pin 엔드포인트도 `PUT /inbox/items/{id}` 입력 필드도 없다. 사용자 고정을 원하면 서버 추가 필요. 현재 UI는 고정 섹션을 읽기 전용으로만 표시.
2. **가계부 특정 과거 월 로드** — `GET /ledger/snapshot`은 파라미터가 없다. 전체 지출이 내려오므로 월 전환은 로컬 필터로 되지만, 지출이 아주 많아지면 페이지네이션이 필요해진다.
3. **분석 재시도** — 실패한 수집 항목을 같은 원문으로 다시 분석하는 동작이 없다. 현재는 직접 채워 승인. 우선순위 중간.
4. **검색** — 데스크톱 상단바에 검색이 있으나 서버 검색이 없다. iOS는 로컬 필터로만 구현. 서버 전문 검색이 있으면 UX가 크게 나아진다.
5. **할 일 항목 순서** — 라벨 순서만 있다. 사용자 지정 정렬을 원하면 서버 추가 필요.
6. **루틴 과거 기록 수정** — 지난 날짜의 완료 여부를 바꿀 수 없다. 상세 화면에서 읽기 전용으로 명시.
7. **가계부 카테고리 삭제 시 대체 지정** — 할 일 라벨·일정 카테고리는 `replacement*Id`가 있으나 가계부에는 없다. 사용 중 카테고리 삭제 시 서버가 거절할 수 있어 오류를 그대로 노출하도록 설계했다. 계약 정합성 확인 필요.

> ~~루틴 삭제 엔드포인트 없음~~ — 0.3.5에서 `DELETE /routine/items/{id}` 추가돼 해결.

### 5-3. 변경 스트림 (`GET /events`, SSE)

멀티기기 동기화의 서버 측 메커니즘. `change.rs`.

- **인증 없음.** EventSource가 Bearer 헤더를 못 싣고, 토큰을 쿼리로 넘기면 로그·프록시에 샌다. 페이로드에 실데이터가 없어 공개해도 된다 — 데이터 재조회는 게이트된 snapshot 경로가 막는다.
- 성공한 `POST/PUT/DELETE` 응답을 서버 미들웨어가 감지해 이벤트를 발행한다. 모든 mutation은 `dashboard`를 포함하므로 오늘 화면은 항상 갱신 대상이다.
- 이벤트 종류:
  | `event:` | 데이터 | iOS 처리 |
  |---|---|---|
  | `change` | `{ revision, modules: [String] }` | `modules`에 해당하는 화면의 스냅샷을 재조회. `id:`에 revision |
  | `resync` | `{}` | 클라이언트가 이벤트를 놓침(broadcast lag). 열려 있는 모든 화면 전체 재검증 |
  | (주석) `keep-alive` | — | 15초 간격. 무시 |
- 모듈 이름: `todo` `routine` `calendar` `scrap` `ledger` `inbox` `dashboard`. `POST /inbox/items/{id}/approve`는 `[inbox, todo, calendar, scrap, ledger, dashboard]` 전부를 발행한다.
- `/media/*` `/ai/*`는 이벤트를 발행하지 않는다.
- iOS 구현: 앱 활성 동안 하나의 `URLSession` SSE 태스크. 백그라운드 진입 시 끊고, 포그라운드 복귀 시 재연결하며 즉시 현재 화면을 재조회(끊긴 동안 놓친 변경 흡수).

### 5-4. 낙관적 동시성 (`If-Match` + 409)

`version.rs`. 서버가 서버-우선 배포 기간을 위해 `If-Match`를 옵셔널로 두지만, iOS는 **항상 보낸다**.

- 모든 스냅샷의 레코드는 `version: Int`를 갖는다(할 일·루틴 항목/라벨, 일정 이벤트/카테고리, 가계부 카테고리, 댓글, 수집함 항목).
- `PUT` 요청에 `If-Match: "<version>"` 헤더를 붙인다(따옴표 포함, ETag 형식).
- 버전이 어긋나면 서버가 `409 Conflict` + `"다른 기기에서 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요."`.
- iOS 처리: 편집 시트를 닫지 않고 최신 스냅샷을 재조회해 필드 차이를 보여준 뒤, 사용자가 "덮어쓰기"를 고르면 새 version으로 재시도. 자동 병합하지 않는다.
- 토글·생성·삭제는 If-Match를 쓰지 않는다(토글은 서버가 현재값 반전, 생성은 대상 없음, 삭제는 멱등).

### 5-2. 계약 드리프트 방지

`packages/contracts`는 zod 스키마다. Swift 모델을 손으로 유지하면 필드 추가·이름 변경 때 조용히 깨진다. 권장:

- 서버에서 OpenAPI 3.1 문서를 내보내고 `swift-openapi-generator`로 모델·클라이언트를 생성한다. zod → JSON Schema → OpenAPI 변환은 기존 도구로 가능하다.
- 최소한 CI에 계약 스냅샷 테스트를 둔다: 각 스냅샷 엔드포인트 응답을 고정 fixture로 저장하고 Swift 디코딩을 검증.
- 특히 위험한 지점: oklch 색 문자열(자유 형식), 수집함 `fields`의 label/value 문자열 쌍, 반복 규칙, 금액 정수형.

---

## 6. 뷰 상태 모델

실제 UI가 쓰는 상태만 정의한다.

```swift
enum LoadState<Value> {
    case idle
    case loading                       // 스켈레톤
    case loaded(Value)
    case refreshing(Value)             // 기존 내용 유지 + 인디케이터
    case empty
    case failed(Value?, APIError)      // 캐시 있으면 함께 보여준다
}

enum MutationState {
    case idle
    case submitting
    case succeeded
    case conflict(latest: Snapshot?)   // 409 → 시트 유지, 최신값 재조회 후 덮어쓰기 확인
    case failed(APIError)
}
```

`APIError`가 앱 전역 상태로 승격되는 두 경우:

```swift
enum SessionState {
    case connected(serverVersion: String, compatible: Bool)
    case unauthorized          // 401 → 배너 + 설정 유도
    case incompatibleServer    // 서버<앱 → 경고, 사용 계속 가능
    case disconnected          // 첫 실행 또는 설정 없음
}

// 변경 스트림 (Core/Sync/ChangeStream.swift)
enum ChangeStreamState {
    case disconnected          // 백그라운드 또는 서버 미연결
    case connecting
    case live(lastRevision: UInt64)
    case reconnecting          // 끊김 감지, 복귀 시 전체 재검증 예약
}
```

기능별로 필요한 것:

| 기능 | 상태 |
|---|---|
| 오늘 | `LoadState<DashboardSnapshot>` + 항목별 `MutationState` |
| 캡처 | `idle / uploading(Double) / analyzing / succeeded / failed(reason)` |
| 수집함 | `LoadState<InboxSnapshot>` + 항목별 `MutationState` |
| 할 일 · 루틴 · 스크랩 · 가계부 | `LoadState<Snapshot>` + `MutationState`(`conflict` 포함) |
| 일정 | `LoadState<CalendarSnapshot>` (범위 단위) + `MutationState` + 반복 범위 선택 |
| 서버 연결 | `idle / testing / ok / failed(ConnectionFailure)` |
| 변경 스트림 | `ChangeStreamState` (앱 전역, 1개) |

`ConnectionFailure`: `badURL`, `unsupportedPort`, `unreachable`, `timeout`, `unauthorized`, `serverBehind(server:app:)`

**스트림 → 화면 연결**: `ChangeStream`이 `change` 이벤트의 `modules`를 받으면 해당 모듈을 구독 중인 ViewModel에 재조회를 알린다(NotificationCenter 또는 `AsyncStream` 팬아웃). 편집 시트가 열려 있으면 그 화면은 재조회를 미루고 저장 시 409로 처리한다 — 사용자가 입력 중인 폼을 밑에서 바꾸지 않는다.

---

## 7. 구현 수용 기준

### 실행 · 연결
1. 설정이 없으면 앱이 서버 연결 화면에서 시작하고 다른 화면에 접근할 수 없다.
2. 연결 테스트 성공 후에만 "시작하기"가 활성화된다.
3. 잘못된 주소 형식은 서버 왕복 없이 즉시 인라인 오류를 낸다.
4. http에 4174 외 포트, https에 443·4174 외 포트를 넣으면 저장을 거부하고 이유를 표시한다.
5. 연결 불가·타임아웃·401·버전 낮음이 각각 다른 문구를 낸다.
6. 서버 버전이 낮으면 경고를 띄우지만 계속 진행할 수 있다.
7. 토큰 입력 후 화면에 원문이 다시 표시되지 않는다.
8. 앱을 종료하고 다시 열면 저장된 연결로 바로 오늘 화면이 열린다.
9. 저장된 토큰이 거부되면(401) 오늘 화면 배너가 나타나고 탭하면 서버 연결 화면이 push된다.

### 루트 · 내비게이션
10. 오늘·할 일·루틴·일정·스크랩·가계부·수집함·설정 어느 화면에도 하단 탭바·하단 고정 액션·플로팅 하단 버튼·드로어가 없다.
11. 6개 모듈 전부가 오늘 화면에서 스크롤 없이 1탭에 도달한다.
12. 빠른 캡처가 오늘 화면 우측 상단에서 1탭에 열린다.
13. 설정이 오늘 화면 우측 상단에서 1탭에 열린다.
14. 모든 push 화면에서 왼쪽 에지 스와이프로 뒤로 갈 수 있다.
15. 왼쪽 24pt 영역에 인터랙티브 요소가 없다.
16. 좌측 상단 모듈 메뉴에서 다른 모듈을 고르면 스택이 누적되지 않고 교체된다.
17. 앱 재실행 시 마지막 경로가 복원되고, 대상 항목이 삭제되었으면 목록으로 pop한다.
18. `mono://inbox/{id}` 딥링크가 오늘 → 수집함 → 항목 순서의 스택을 만든다.

### 빠른 캡처
19. 텍스트·사진·영상이 모두 없으면 보내기가 비활성이다.
20. 사진은 4장, 영상은 1개에서 추가 버튼이 비활성되고 이유가 보인다.
21. 제출 전 각 첨부를 개별 제거할 수 있다.
22. 업로드 진행률이 표시되고 취소할 수 있다.
23. 작성 중 내용이 있는 상태로 닫으려 하면 확인 대화상자가 나온다.
24. 성공 시 시트가 닫히고 오늘 화면의 수집함 대기 개수가 증가한다.
25. 분석 실패 시 입력 내용이 사라지지 않고 재시도할 수 있다.
26. 키보드가 올라와도 입력 영역과 미디어 툴바가 가려지지 않는다.

### 수집함
27. 확신도가 퍼센트 바가 아니라 등급 텍스트로 표시된다.
28. 확신 0.7 미만 필드에 "확인 필요" 표시가 붙는다.
29. 대상 모듈을 바꾸면 필드 폼이 해당 모듈에 맞게 바뀐다.
30. 필드를 편집한 뒤 승인하면 편집한 값으로 항목이 생성된다.
31. 일괄 승인이 임계값(0.85)을 화면에 표시하고 대상 항목 목록을 보여준 뒤 확인을 받는다.
32. 승인은 서버 응답을 기다리며 낙관적으로 반영하지 않는다.
33. 서버가 고정한 항목(영상 소스)이 최상단 "고정" 섹션에 읽기 전용으로 표시되고, 사용자 고정 토글 UI는 없다.
34. 실패 항목에 재분석이 아닌 "직접 채워서 승인" 경로가 있다.

### 할 일 · 루틴
35. 오늘 화면에서 체크한 할 일이 할 일 목록에서도 완료로 보인다.
36. 상태 필터·라벨 필터를 조합해도 그룹 헤더(지남/오늘/예정/완료)가 유지된다.
37. 마감 시간만 단독으로 저장할 수 없고 날짜를 먼저 요구한다.
38. 지남 상태가 색 외에 심볼과 "N일 지남" 텍스트로 표시된다.
39. 스와이프 삭제도 확인 대화상자를 거치며, 같은 삭제가 상세 화면에도 있다.
40. 라벨 삭제 시 대체 라벨을 반드시 선택한다.
41. 라벨 순서를 바꾸면 즉시 반영되고 서버에 저장된다.
42. 루틴은 요일을 하나 이상 고르지 않으면 저장되지 않는다.
43. 루틴 상세에 삭제(`DELETE`, 기록까지 제거)와 중단(종료일 설정, 기록 유지)이 모두 있고 차이가 한 줄로 설명된다.
44. 루틴의 과거 기록은 편집할 수 없고 읽기 전용임이 명시된다.

### 일정
45. 월/아젠다 전환이 세그먼트 컨트롤로 이루어지고 전역 내비게이션에 쓰이지 않는다.
46. 월 그리드 셀이 44×44 이상이고 SE 폭(320pt)에서 겹치지 않는다.
47. 접근성 최대 크기에서 월 셀의 점이 개수 텍스트로 바뀐다.
48. 종일 일정에 시간이 표시되지 않는다.
49. 여러 날 일정이 걸친 모든 날짜에 표시되고 아젠다에서 "N일차"로 구분된다.
50. 반복 일정 편집·삭제 시 this/future/all 범위를 묻는다.
51. 종료가 시작보다 이르면 인라인 오류가 난다.

### 스크랩
52. 사진·영상은 그리드로, 메모·링크는 목록으로 표시된다.
53. 미디어가 없는 항목(404)이 사라지지 않고 자리표시와 재첨부 경로를 갖는다.
54. 링크 미리보기가 실패해도 주소를 열 수 있다.
55. 미디어 교체는 업로드 완료 전 저장이 비활성이다.
56. 댓글 추가가 즉시 목록에 반영된다.
57. 태그 필터로 결과가 없으면 "필터 지우기"가 제공된다.

### 가계부
58. 월 합계와 카테고리 금액이 모두 `.monospacedDigit()`으로 정렬된다.
59. 금액 입력에 숫자 키패드가 뜨고 천단위 구분이 표시된다.
60. `₩ , 원`을 포함해 입력해도 원 단위 정수로 저장된다.
61. 0원 이하 금액이 인라인 오류를 낸다.
62. 지출 삭제 후 되돌리기 토스트가 제공된다.
63. 카테고리 순서 변경이 저장된다.
64. 카테고리 삭제가 서버에서 거절되면 그 이유가 그대로 표시된다.
64a. 월 전환이 서버 왕복 없이 이미 받은 전체 지출 목록에서 즉시 이뤄진다.

### 동기화 (SSE · 동시성)
64b. 앱이 포그라운드인 동안 `GET /events` SSE가 연결되고, 백그라운드에서 끊겼다가 복귀 시 재연결하며 현재 화면을 재조회한다.
64c. 다른 기기에서 할 일을 추가하면 이 기기의 열려 있는 할 일 목록·오늘 화면이 몇 초 안에 스스로 갱신된다(수동 새로고침 없이).
64d. `resync` 이벤트를 받으면 열려 있는 모든 목록이 전체 재검증된다.
64e. 편집 시트가 열려 있는 동안에는 그 화면이 밑에서 바뀌지 않고, 저장 시 최신 버전과 비교한다.
64f. 같은 레코드를 다른 기기가 먼저 수정한 뒤 저장을 누르면 409가 나고, 시트가 닫히지 않으며 "다른 기기에서 먼저 수정했습니다" 안내와 덮어쓰기 선택지가 나온다.
64g. 모든 `PUT` 요청에 `If-Match: "<version>"` 헤더가 실린다.

### 상태 · 접근성 · 지역화
65. 오늘·할 일·일정·스크랩·수집함·가계부 각각에서 로딩·빈·오프라인·오류·401 상태가 별도 화면 없이 같은 화면 안에서 표현된다.
66. 오프라인에서 쓰기 동작을 시도하면 비활성 상태 또는 안내 토스트가 나온다.
67. 오프라인 배너에 마지막 갱신 시각이 표시된다.
68. 스켈레톤이 오늘·목록 화면에만 쓰이고 상세·폼에는 쓰이지 않는다.
69. 모든 파괴적 동작에 확인 대화상자가 있다.
70. 한국어 긴 문자열("홍길동이 보내준 기획안 검토하기")이 어느 행에서도 잘리거나 겹치지 않는다.
71. 기기 언어를 영어로 바꾸면 전체 UI가 영어로 표시되고 날짜·통화 형식이 함께 바뀐다.
72. 다크 모드에서 모든 텍스트 대비가 4.5:1 이상이다.
73. 사용자가 고른 강조색이 다크·라이트 양쪽에서 대비 기준을 만족한다.
74. Dynamic Type `.accessibility5`에서 잘림·겹침이 없고 모듈 타일이 목록으로 전환된다.
75. VoiceOver로 오늘 화면을 처음부터 끝까지 훑을 때 배너 → 섹션 → 항목 순서로 읽힌다.
76. 체크 항목이 label·value·hint를 모두 갖는다.
77. Reduce Motion에서 진행 바 애니메이션이 단계 텍스트 갱신으로 대체된다.
78. Increase Contrast에서 경계가 두꺼워지고 배경 대비가 강해진다.
79. iPhone SE(320pt 폭)에서 모든 화면이 가로 스크롤 없이 표시된다.
80. 모든 탭 대상이 44×44pt 이상이다.

---

## 8. 남은 질문

1. 수집함 재분석을 서버가 지원할 수 있는가? 실패 항목이 쌓이면 사용자가 직접 채우는 부담이 크다.
2. 가계부 카테고리 삭제 시 대체 카테고리 개념을 다른 모듈과 통일할 것인가?
3. R2 자격증명 입력을 iOS에서도 제공해야 하는가? 지금은 상태 표시만 두었다.
4. 오프라인 쓰기 큐를 지원할 것인가? 지금은 쓰기 비활성이 기본이다.
5. 알림(분석 완료, 오늘 루틴 리마인더)을 서버가 푸시할 수 있는가? `GET /events` SSE는 앱이 켜져 있을 때만 유효하다 — 백그라운드 알림은 APNs가 따로 필요하다. 딥링크 경로는 준비돼 있다.
6. `/events`가 인증 없이 공개다(페이로드는 무효화 신호뿐). 원격 배포에서 이대로 두는가, 아니면 게이트할 계획이 있는가?
