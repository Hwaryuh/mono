# mono iOS — 디자인 시스템 명세

기준 저장소: `mono` (Tauri 2 + React 데스크톱 앱, Rust `mono-api` 서버)
대상: iPhone, 세로 우선, SwiftUI, iOS 26 관례
프로토타입: `prototype/prototype.dc.html` · 와이어프레임: `prototype/wireframes.dc.html` · IA 후보: `prototype/ia-a-today.dc.html`, `prototype/ia-b-today.dc.html`

원칙: 데스크톱 웹 컴포넌트 라이브러리를 그대로 옮기지 않는다. 의도(따뜻한 중성 배경, 정밀한 여백과 경계, 조용한 표면, 의미 있는 강조색 하나, 밀도 있지만 차분한 정보 표현)를 네이티브 컨트롤로 번역한다.

> **2026-09-02~03 패치** — 서버 API 대조(0.3.5) 결과 `HANDOFF-swiftui.md` §5가 개정됐다. 이 문서 변경: §7-4에 "저장 충돌(409)"·"원격 변경 반영(SSE)" 행 추가, §8에 스크랩 `file` 종류 표현 추가. 나머지 시각 명세(색·타이포·여백·모션)는 변동 없음.

---

## 1. 색

### 1-1. 시맨틱 역할

앱 UI는 시스템 시맨틱 색을 쓴다. 고정 hex는 브랜드 배경 두 개와 데이터 색(라벨·카테고리)에만 쓴다.

| 역할 | 라이트 | 다크 | SwiftUI |
|---|---|---|---|
| 화면 배경 | `#F7F6F3` (커스텀) | `#1B1B1B` (커스텀) | `Color("Canvas")` — asset catalog, 아래 근거 |
| 표면 (그룹 행, 카드) | `#FFFFFF` | `#252524` | `Color("Surface")` |
| 1차 텍스트 | `#2B2A28` | `#F3F1EC` | `.primary` (Canvas 위 대비 검증됨) |
| 2차 텍스트 | `label.secondary` | 동일 | `.secondary` |
| 3차 텍스트 / 플레이스홀더 | `label.tertiary` | 동일 | `.tertiary` |
| 구분선 | `separator` | 동일 | `Divider()` / `.listRowSeparatorTint` |
| 강조 / tint | 사용자 선택 (기본 시스템 블루) | 다크 변형 | `.tint(theme.accent)` |
| 위험 / 파괴적 | `#D22C1F` | `#FF6B5E` | `.red` (시스템 red로 충분 — 커스텀 불필요) |
| 긍정 / 완료 | `#3C7A5A` | `#67C99A` | `Color("Positive")` |
| 주의 / 확신 보통 | `oklch(0.603 0.109 75.876)` → `#A97A2E` / `#D9A94B` | | `Color("Caution")` |
| 배지 (주의 필요 개수) | 시스템 red | 동일 | `.badge()` / `Capsule().fill(.red)` |

**Canvas / Surface를 커스텀 asset으로 두는 근거**: `systemGroupedBackground`는 중성 회색이다. mono의 정체성은 따뜻한 중성(저장소 `tokens.css`의 `oklch(0.98 0.004 106)` 계열)이다. 이 두 색만 asset catalog에 라이트/다크 쌍으로 정의하고, 나머지는 전부 시스템 시맨틱을 쓴다. Increase Contrast 대응으로 asset catalog의 High Contrast 변형을 함께 채운다.

### 1-2. 강조색 → SwiftUI tint

데스크톱은 사용자가 강조색을 자유롭게 고르고 서버가 oklch로 정규화해 저장한다(`normalizeColorToOklch`).

iOS 구현:

- 저장은 서버 계약을 그대로 따른다 — oklch 문자열.
- 앱은 oklch → `Color`로 변환해 루트에 `.tint(_)` 한 번만 적용한다. 개별 뷰에 색을 박지 않는다.
- **자유 색상 선택기를 쓰지 않는다.** 큐레이션된 5색(시스템 블루 / 저장소 남색 / 초록 / 주황 / 보라)과 라이트·다크 각각의 변형을 제공한다. 사용자가 고른 색이 다크 모드에서 대비 4.5:1을 넘지 못하는 경우가 생기기 때문이다.
- 다크 모드 변형은 같은 hue를 유지하고 lightness를 올린다.

### 1-3. 데이터 색 (라벨 · 카테고리)

할 일 라벨, 일정 카테고리, 가계부 카테고리는 서버가 색을 갖는다(`labelColor`, `categoryColor` — oklch 문자열). 이 색은 **테마 색이 아니라 데이터**다. 강조색과 무관하게 그대로 렌더한다.

표현 규칙:

- 7–9pt 원형 점 + **항상 이름 텍스트를 함께 둔다.** 색만으로 라벨을 구분하지 않는다.
- 일정 카드는 왼쪽 3pt 세로 바.
- 가계부 구성 그래프는 색 + 이름 + 비율 + 금액을 함께 적는다.

---

## 2. 타이포그래피

SF Pro + Dynamic Type. **고정 pt를 쓰지 않는다.**

| 용도 | 텍스트 스타일 | 비고 |
|---|---|---|
| 최상위 화면 제목 | `.largeTitle` (navigationBarTitleDisplayMode `.large`) | 오늘 화면만 |
| 상세 화면 제목 | `.title2` bold | 할 일·일정·스크랩·루틴 상세의 본문 제목 |
| 금액 (가계부 월 합계) | `.largeTitle` + `.monospacedDigit()` | |
| 내비게이션 바 제목 | 시스템 기본 (`.inline`) | 직접 지정하지 않는다 |
| 목록 행 제목 | `.body` | |
| 목록 행 보조 | `.footnote` `.secondary` | |
| 섹션 헤더 | `.footnote` semibold `.secondary` | |
| 배지 · 태그 | `.caption` | |
| 금액 · 시간 · 개수 | 해당 스타일 + `.monospacedDigit()` | 표 정렬용 |

한국어 대응:

- 긴 한국어 문자열은 줄바꿈 위치가 영어와 다르다. 모든 행 제목은 `.lineLimit(2)` + `.truncationMode(.tail)`, 상세 화면 본문은 제한 없음.
- 「홍길동이 보내준 기획안 검토하기」처럼 긴 제목을 기준 케이스로 잡는다.
- `.multilineTextAlignment(.leading)`, 중앙 정렬 본문 금지.

접근성 크기:

- 목록 행은 고정 높이를 주지 않는다 — `.frame(minHeight: 44)` 만.
- 오늘 화면 모듈 타일(3열)은 `.accessibility1` 이상에서 2열, `.accessibility3` 이상에서 목록 행으로 떨어뜨린다 (`ViewThatFits` 또는 `@Environment(\.dynamicTypeSize)` 분기).
- 라벨 점 + 이름 조합은 접근성 크기에서 세로 스택으로 바뀐다.

---

## 3. 여백 · 반경 · 구분선

여백 스케일 (4의 배수): **2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28**

- 화면 좌우 여백: 20
- 카드 내부 여백: 14 (세로), 14 (좌우)
- 목록 행 세로 여백: 10–11, 최소 높이 44
- 섹션 간 간격: 20–22
- 섹션 헤더와 내용 사이: 6

모서리 반경:

| 대상 | 반경 |
|---|---|
| 그룹 카드 / 목록 컨테이너 | 14 |
| 오늘 화면 타일, 일정 카드, 스크랩 썸네일 | 12 |
| 칩 / 태그 | 15 (pill) |
| 버튼 | 12 |
| 시트 상단 | 시스템 기본 (직접 지정하지 않음) |

구분선:

- 목록 행 사이 0.5pt hairline, `separator` 색.
- 리딩 아이콘이 있는 행은 아이콘 폭 + 간격만큼 인셋 (예: 52pt).
- 카드 경계는 0.5pt `separator` — 그림자를 쓰지 않는다.

---

## 4. 재질 · 그림자

- 내비게이션 바 · 시트 배경: 시스템 기본 재질. 직접 blur를 만들지 않는다.
- 모듈 풀다운 메뉴: SwiftUI `Menu` 기본 재질.
- **그림자를 쓰지 않는다.** 표면 구분은 배경 대비 + 0.5pt 경계로만 한다. 예외: 토스트 하나.
- 유리 효과를 손으로 만들지 않는다.

---

## 5. SF Symbols

| 대상 | Symbol |
|---|---|
| 할 일 | `checklist` |
| 루틴 | `arrow.triangle.2.circlepath` |
| 일정 | `calendar` |
| 스크랩 | `paperclip` |
| 가계부 | `wonsign.circle` |
| 수집함 | `tray.full` |
| 빠른 캡처 | `sparkles` |
| 설정 | `slider.horizontal.3` |
| 모듈 메뉴 (좌측 상단) | `square.grid.2x2` |
| 미완료 체크 | `circle` |
| 완료 체크 | `checkmark.circle.fill` |
| 지남 / 주의 | `exclamationmark.triangle.fill` |
| 확신 높음 | `checkmark.seal` |
| 확신 낮음 | `questionmark.circle` |
| 고정 | `pin.fill` |
| 사진 스크랩 | `photo` |
| 영상 스크랩 | `video` |
| 링크 스크랩 | `link` |
| 메모 스크랩 | `doc.text` |
| 오프라인 | `wifi.exclamationmark` |
| 댓글 | `text.bubble` |

모든 심볼은 `.imageScale(.medium)` + 텍스트 스타일에 맞춘 크기. 아이콘 단독 버튼은 44×44 최소, `accessibilityLabel` 필수.

---

## 6. 버튼 위계

| 위계 | 형태 | 사용처 |
|---|---|---|
| 1차 | `.borderedProminent`, 화면 폭, minHeight 50 | 상세 화면의 주요 동작(완료로 표시, 승인, 연결 테스트) |
| 2차 | `.bordered` 또는 tint 텍스트 | 저장, 재시도, 필터 지우기 |
| 3차 (내비게이션) | 툴바 텍스트/아이콘 버튼 | 편집, 전체, 라벨 |
| 파괴적 | `.bordered` + `.foregroundStyle(.red)` | 삭제, 버리기, 중단, 토큰 삭제 |
| 인라인 링크 | tint 텍스트 | 섹션 헤더의 "전체" |

파괴적 동작은 항상 확인 대화상자(`.confirmationDialog` 또는 `.alert`)를 거친다. 스와이프만으로 삭제되지 않는다 — 스와이프 삭제도 확인을 띄우고, 같은 동작이 컨텍스트 메뉴와 상세 화면에도 노출된다.

---

## 7. 컴포넌트

### 7-1. 네이티브로 충분한 것

| 컴포넌트 | SwiftUI |
|---|---|
| 목록 · 섹션 | `List` + `Section`, `.listStyle(.insetGrouped)` |
| 검색 | `.searchable(text:)` |
| 로컬 뷰 전환 (월/아젠다, 상태 필터, 월 선택) | `Picker` + `.pickerStyle(.segmented)` |
| 스와이프 동작 | `.swipeActions(edge:allowsFullSwipe: false)` |
| 컨텍스트 메뉴 | `.contextMenu` |
| 모듈 선택 (좌측 상단) | `Menu` in `ToolbarItem(placement: .topBarLeading)` |
| 생성 · 편집 폼 | `.sheet` + `Form` |
| 날짜 · 시간 | `DatePicker` |
| 사진 · 영상 선택 | `PhotosPicker` |
| 토글 | `Toggle` |
| 확인 | `.confirmationDialog`, `.alert` |
| 새로고침 | `.refreshable` |
| 순서 변경 | `.onMove` + `EditButton` |
| 배지 | `.badge(_:)` |

### 7-2. 커스텀이 필요한 것 (이유 포함)

**`MonthGridView`** — SwiftUI에 월 캘린더 그리드가 없다. `LazyVGrid(columns: 7)`. 각 셀은 날짜 + 최대 3개 카테고리 점. 접근성 크기에서 점 대신 개수 텍스트. `accessibilityLabel`은 "8월 9일, 일정 2건". 셀 최소 44×44.

**`WeekdayPicker`** — 루틴 요일 다중 선택. 시스템 컴포넌트로 표현하면 7행 토글 목록이 되어 한 화면을 다 먹는다. 44×44 원형 토글 7개. `accessibilityAddTraits(.isButton)` + 선택 상태를 `accessibilityValue`로.

**`ConfidenceIndicator`** — AI 확신도. 진행 바나 퍼센트로 표현하면 실제보다 정확해 보인다. 등급 텍스트(매우 높음 / 높음 / 보통 / 낮음 / 분석 실패) + 심볼 + 보조로 소수값. 등급별 색은 있지만 텍스트가 항상 함께 있다.

**`ExpenseBreakdownBar`** — 가로 비율 바. Swift Charts를 쓸 수도 있지만 단일 스택 바 하나에 차트 프레임워크를 들이는 것은 과하다. `GeometryReader` 없이 `HStack` + `.layoutPriority` 비율로 구현. 접근성에서는 바를 숨기고(`.accessibilityHidden(true)`) 아래 이름·비율·금액 목록만 읽게 한다.

**`RoutineDayDots`** — 루틴 목록 행의 요일 표시. 데스크톱 시각 언어를 그대로 옮기는 유일한 요소. 읽기 전용.

**`RoutineStreakGrid`** — 루틴 상세의 최근 기록. GitHub 컨트리뷰션 그래프 형태의 10주 × 7일 격자, 일요일 시작, 16pt 정사각형(반경 3). `LazyHGrid(rows: 7)`으로 감쌀 수 있지만 셀 상태 판정·요약 계산·접근성 병합이 전부 커스텀이라 별도 컴포넌트로 둔다.

- 세 가지 상태만 그린다: **완료**(강조색 채움) · **건너뜀**(2차 배경 + 0.5pt 실선) · **해당 요일 아님**(투명 + 0.5pt 점선).
- 마지막 열은 오늘이 속한 주이고, 오늘 이후 칸은 렌더하지 않는다. "예정" 상태를 만들지 않는다 — 아직 오지 않은 날을 건너뜀과 구분되게 그리면 상태가 넷이 되고 범례가 무거워진다.
- 색만으로 구분하지 않는다. 격자 아래에 세 상태 범례를 항상 둔다.
- 정사각형 크기는 Dynamic Type에 반응하지 않는다(격자 폭이 화면을 넘기 때문). 요일 라벨도 고정 12pt로 두어 셀 피치와 어긋나지 않게 한다 — 이 컴포넌트에서만 허용하는 고정 폰트 크기다.
- VoiceOver는 70개 칸을 개별로 읽지 않는다. 격자 전체를 하나의 `.accessibilityElement`로 묶고 「최근 10주 기록, 예정 N일 중 M일 완료, 현재 연속 K회」를 읽는다.
- 연속 횟수는 최근 예정일부터 거꾸로 센다.

**`OfflineBanner` / `StateBanner`** — 화면 상단 인라인 배너. 시스템 컴포넌트가 없다. 심볼 + 제목 + 상세 + 재시도 버튼. `List` 위 `Section` 헤더 자리 또는 `safeAreaInset(edge: .top)`.

**`CaptureSheet` 미디어 트레이** — 첨부 4+1 관리. `PhotosPicker`는 선택만 하고 제거·진행 표시는 직접 만든다.

### 7-3. 목록 행 패턴

세 가지만 쓴다.

1. **체크 행** — 리딩 원형 체크(30×30 탭 영역) + 제목/보조 + 트레일링 라벨 점·이름 + 셰브런. 할 일, 루틴(오늘 해당분).
2. **탐색 행** — 리딩 아이콘(선택) + 제목/보조 + 트레일링 값 + 셰브런. 설정, 수집함, 스크랩 목록, 가계부 내역.
3. **값 행** — 키 + 트레일링 값, 셰브런 없음. 상세 화면의 속성 표시.

셰브런은 **실제로 push되는 행에만** 둔다. 순서 변경 행, 댓글, 읽기 전용 기록에는 두지 않는다.

### 7-4. 상태 컴포넌트

| 상태 | 표현 |
|---|---|
| 초기 로딩 | 오늘 화면과 목록 화면만 스켈레톤(공간 연속성이 있는 곳). 상세·폼은 스켈레톤을 쓰지 않고 `ProgressView` |
| 새로고침 | `.refreshable` 기본 인디케이터 + 기존 내용 유지 |
| 빈 데이터 | 점선 경계 카드 + 제목 + 한 줄 설명 + 1차 동작. 필터로 인한 빈 상태는 문구가 다르고 "필터 지우기"를 제공 |
| 부분 데이터 | 섹션별 빈 상태 한 줄. 섹션 자체를 숨기지 않는다 |
| 인라인 검증 | 필드 바로 아래 `.footnote` red + 필드 경계 red. 제출 버튼 비활성화 대신 눌렀을 때 오류를 보여준다 |
| 복구 가능한 오류 | 상단 배너 + 재시도. 내용은 캐시된 것을 유지 |
| 오프라인 | 상단 배너("서버에 연결할 수 없습니다 · HH:mm 기준") + 쓰기 동작 비활성 + 시도 시 토스트 |
| 타임아웃 | 오프라인과 같은 화면, 문구만 다르다 |
| 401 | 배너 문구가 "인증이 만료되었습니다" + 동작이 "설정 열기" → 서버 연결 화면 push |
| 서버 버전 낮음 | 경고 배너(차단 아님) + 설정 > 정보에 상세 |
| 저장 충돌 (409) | 편집 시트를 닫지 않고 상단에 인라인 경고("다른 기기에서 먼저 수정했습니다") + 최신 값 재조회 + 「덮어쓰기 / 취소」. 배너 아님, 시트 안에서 처리 |
| 원격 변경 반영 | SSE `change` 이벤트로 목록·오늘 화면이 조용히 갱신된다. 사용자가 스크롤 중이거나 시트를 열고 있으면 갱신을 미룬다. 별도 표시 없음 |
| 성공 | 하단 토스트 2.2초. 목록 삭제는 되돌리기를 함께 제공 |

---

## 8. 미디어 표현

- 스크랩 목록: 사진·영상은 2열 그리드(썸네일 104pt), 메모·링크·파일은 목록 행. 실제 데이터 구성(사진 2 / 링크 2 / 메모 1 / 영상 1)에 맞춘 하이브리드.
- 파일(`kind "file"`): 목록 행에 `doc.fill` 아이콘 + 파일명(`.lineLimit(1)`, `.truncationMode(.middle)`) + 크기(`ByteCountFormatter`). 상세에서 `ShareLink`/`QuickLook`으로 열기. 썸네일 없음.
- 상세: 190pt 고정 높이 미리보기, `.aspectRatio(contentMode: .fill)` + `.clipped()`.
- 영상은 썸네일 우하단에 "영상" 배지.
- 미디어 누락(`GET /media/:id` 404): 항목을 지우지 않고 점선 자리표시 + "사진 다시 첨부"(파일이면 "파일 다시 첨부").
- 링크 미리보기 실패: 주소는 그대로 열 수 있게 남기고 미리보기 영역만 대체 문구.
- 업로드 진행: 인라인 진행 바 + 취소. 업로드 중 저장 버튼 비활성.

---

## 9. 모션

원칙: 네이티브 전환만 쓴다. NavigationStack push/pop, 시트 상승, 목록 삽입·삭제 애니메이션.

| 대상 | 기본 | Reduce Motion |
|---|---|---|
| 화면 이동 | 시스템 push/pop | 시스템이 자동으로 교차 페이드 |
| 시트 | 시스템 | 시스템 처리 |
| 체크박스 토글 | `.spring(response: 0.28)` | 즉시 상태 변경, 애니메이션 없음 |
| 목록 행 삽입·삭제 | `withAnimation(.default)` | `withAnimation(nil)` |
| 업로드·분석 진행 | 진행 바 애니메이션 | 단계 텍스트만 갱신, 바는 이동하지 않음 |
| 토스트 | 페이드 + 상승 | 페이드만 |

`@Environment(\.accessibilityReduceMotion)` 하나로 분기한다. 장식용 애니메이션은 없다.

---

## 10. 접근성 체크리스트

- 모든 탭 대상 44×44 이상 — 체크박스 탭 영역은 시각 크기 22pt, 탭 영역 30pt + 행 높이로 보장.
- 왼쪽 에지 24pt 영역에 인터랙티브 요소를 두지 않는다 (에지 스와이프 백 보존).
- VoiceOver: 체크박스는 label(제목) + value(완료/미완료) + hint(두 번 탭하면 완료), 라벨 점은 `.accessibilityHidden(true)` 후 이름만 읽게 병합.
- 읽기 순서: 배너 → 섹션 헤더 → 항목. `.accessibilityElement(children: .combine)`으로 행을 하나로 묶는다.
- 상태를 색만으로 알리지 않는다 — 지남은 삼각형 심볼 + "2일 지남" 텍스트, 완료는 채워진 원 + 취소선, 확신도는 등급 텍스트.
- Increase Contrast: asset catalog High Contrast 변형 + 경계 두께 0.5 → 1pt.
- Dynamic Type `.accessibility5`까지 잘림·겹침 없음.
