# PC 데스크톱 구현 인계

- 최종 갱신: 2026-08-21
- 대상: `apps/desktop`
- 현재 범위: Windows PC 데스크톱

## 범위 원칙

- 기존 모바일 디자인은 폐기했다.
- iOS, 모바일 웹, App Store 관련 작업을 하지 않는다.
- 서버, SQLite 영속화, 실제 AI 분류는 아직 구현하지 않는다.
- 프로토타입의 `sc-for`, `sc-if`, `DCLogic` 런타임은 복사하지 않는다.
- 프로토타입의 SVG path, 색상, 크기, 간격, 상태 표현은 시각 명세로 재사용한다.
- 실제 교체 가능한 플랫폼·데이터 경계에만 인터페이스를 둔다.
- 기존 저장소 경계를 유지하고 실제 데이터 교체 경계인 `CalendarRepository`, `ScrapRepository`, `LedgerRepository`를 추가했다.

## 완료 작업

### 디자인 시스템

- 기본 강조색을 `#B03A55`로 변경했다.
- 앱 내부 강조색의 단일 원본은 `packages/ui/src/styles/tokens.css`의 `--color-accent`다.
- hover와 soft 상태는 `color-mix()`로 `--color-accent`에서 파생한다.
- `npm run desktop:dev`, `npm run desktop:build` 전에 Windows 앱 SVG와 ICO가 같은 토큰에서 자동 동기화된다.
- 동기화 스크립트는 `scripts/sync-windows-branding.ps1`이다.
- 프로토타입 인라인 SVG path를 `packages/ui/src/icons.tsx`의 공통 아이콘 체계로 옮겼다.
- Lucide 의존성을 제거했다.
- Component Sheet 기준 공통 React 컴포넌트를 `packages/ui`에 구현했다.
  - 버튼과 아이콘 버튼
  - 입력과 텍스트 영역
  - 칩과 배지
  - 체크박스
  - 확신도 표시
  - 상태 표시
  - 카드와 섹션 헤더
  - 모달과 드로어 기반
- 화면별 중복 스타일을 공통 컴포넌트와 토큰으로 교체했다.

### 폰트

- SUIT Variable WOFF2를 로컬 자산으로 번들했다.
- SIL Open Font License 원문을 포함했다.
- 네트워크 폰트 의존성과 CSP 확장은 없다.

### 앱 셸과 대시보드

- 224px 확장/56px 축소 사이드바, 52px 헤더, 16px 콘텐츠 여백 기준을 맞췄다.
- 라이트·다크 테마와 사이드바 축소 상태를 검증했다.
- Tauri 기본 창 내부 크기를 1440×920으로 설정했다.
- Windows 예약 포트 충돌 때문에 Vite와 Tauri 개발 URL을 4173으로 통일했다.
- 실제 release 바이너리를 실행하고 Tauri 창을 캡처해 시각 검증했다.

### 수집함

- 수집함 placeholder를 실제 화면으로 교체했다.
- `InboxRepository`와 mock 구현을 추가했다.
- 대기·승인·실패 탭, 확신도, 분류 결과, 필드, 단건 승인, 고확신도 일괄 승인을 구현했다.
- 공통 Drawer로 필드 수정, 직접 분류, 대상 모듈 변경을 구현했다.
- 공통 Modal로 버리기 확인과 취소를 구현했다.
- approve, update, discard mutation 상태와 오류를 항목별로 분리했다.
- 탭 키보드 이동, Drawer·Modal focus trap, Escape 닫기, 기존 focus 복귀를 구현했다.
- 공통 Modal·Drawer에 `aria-labelledby`, 초기 focus, focus 복귀 처리를 추가했다.
- 필드 행은 접근 가능한 `button`을 사용하되 원본 HTML처럼 단일 `1px` 테두리만 사용한다. 네이티브 button appearance와 inset shadow를 다시 추가하지 않는다.

### 공유 mock 상태

- 조립부에서 하나의 `MockPlatformState`를 만들고 모든 mock Repository에 주입한다.
- 빠른 캡처가 수집함 대기 항목, 대시보드 최근 캡처, 사이드바 수집함 배지에 즉시 반영된다.
- 수집함 approve, update, discard가 같은 backing state를 변경한다.
- 수집함에서 `todo` 대상으로 승인한 항목은 같은 state의 할 일 목록과 대시보드 프로젝트에 즉시 반영된다.
- `MockPlatformState`는 구체 구현이다. 범용 인터페이스로 추상화하지 않는다.
- `MockPlatformState.routine.items`와 `routine.occurrences`가 루틴의 단일 원본이다.
- 과거 임시 복제였던 `dashboard.tasks`의 루틴 항목과 `dashboard.routines`는 backing state에서 제거했다. 대시보드 스냅샷에서 공유 루틴 상태로 파생한다.
- `MockPlatformState.scrap.items`와 `scrap.tags`가 스크랩의 단일 원본이다.
- 과거 대시보드 전용 복제였던 `dashboard.scraps`는 backing state에서 제거했다. 대시보드 최근 스크랩과 사이드바 배지는 공유 스크랩 상태에서 파생한다.
- `MockPlatformState.ledger.expenses`, `ledger.categories`, `ledger.comparison`이 가계부의 단일 원본이다.
- 과거 대시보드 전용 복제였던 `dashboard.monthlyExpense`는 backing state에서 제거했다. 대시보드 월 지출과 분류별 금액은 현재 월 ledger 거래에서 파생한다.
- 금액은 원 단위 양의 정수, 날짜는 ISO `YYYY-MM-DD`를 원본으로 저장한다.

### 할 일

- `TodoRepository`와 메모리 mock 구현을 추가했다.
- `TodoRepository.createLabel`과 `todoLabelWriteInputSchema`를 추가했다. 라벨 이름은 trim하며 6자리 HEX 색상은 소문자로 정규화한다.
- 상태·라벨 필터, 활성 필터 칩, 목록, 완료 토글, 전체 빈 상태, 필터 결과 없음 상태를 구현했다.
- 할 일 필터와 편집 Modal의 `라벨 관리` 진입점에서 공유 Todo 원본 상태에 라벨을 추가할 수 있다. 같은 이름은 거부하며 이름 변경·삭제·사용자 색상 선택은 구현하지 않았다.
- 라벨 관리에는 원본의 460px 공통 중앙 Modal, 기존 라벨별 항목 수, 5개 기본 색상, 이름 입력을 사용한다.
- 색상 선택은 방향키·Home·End로 이동한다. 생성 pending 동안 입력을 잠그고 실패 시 값과 선택 색상을 보존한 뒤 이름 입력으로 focus를 복귀한다.
- 공통 Modal로 새 할 일 생성과 기존 할 일 수정을 구현했다.
- 원본 명세의 삭제 동작을 중첩 확인 Modal로 구현했다.
- 생성·수정·완료·삭제 pending과 오류를 항목별로 분리했다.
- 상태 필터와 라벨 필터 키보드 이동, Modal focus trap, Escape 닫기, 기존 focus 복귀를 구현했다.
- 중첩 Modal에서는 최상단 overlay만 키보드 이벤트를 처리하도록 공통 overlay 스택을 보강했다.
- 할 일 버튼은 `appearance: none`, `border: 0`, `box-shadow: none`으로 네이티브 스타일을 초기화했다.
- 원본 디자인의 할 일 서랍 대신 이번 구현 요구에 따라 공통 Modal을 사용했다.
- 지정 요일의 활성 루틴 occurrence를 할 일 스냅샷 상단에 자동 반영한다.
- 루틴 occurrence 항목을 열면 할 일 Modal이 아니라 해당 루틴의 수정 Drawer로 이동한다.

### 루틴

- `/routine` placeholder를 Platform Wireframe 기준 실제 루틴 화면으로 교체했다.
- 반복 요일, 기간·만료 상태, 기간 진행률, 최근 2주 이력, 오늘 완료 토글, 빈 상태를 구현했다.
- 원본 명세대로 공통 우측 `Drawer`를 사용해 새 루틴 생성과 기존 루틴 수정을 구현했다.
- 삭제 동작은 추가하지 않았다.
- `RoutineRepository`와 메모리 mock 구현을 추가했다.
- mock 기준 날짜는 `MockPlatformState.todo.today`만 사용한다.
- 지정 요일이고 기간 안인 루틴만 오늘 occurrence를 만든다.
- occurrence ID와 중복 판정은 `routineId + occurrenceDate` 결정 키를 사용한다. 반복 조회로 중복 저장하지 않는다.
- 루틴 화면, 할 일 화면, 대시보드에서 같은 occurrence 완료 상태를 읽고 변경한다.
- 수집함 직접 분류 대상에 루틴을 추가했고, `routine` 승인 항목을 공유 루틴 상태와 대시보드에 반영한다.
- 사이드바 루틴 배지는 공유 루틴 상태의 실제 항목 수에서 파생한다.
- 생성·수정 mutation 오류는 Drawer에, 오늘 완료 pending·오류는 해당 루틴 카드에만 표시한다.
- Drawer focus trap, Escape 닫기, 생성·수정 진입점 focus 복귀는 기존 공통 overlay 수명주기를 재사용한다.

### 일정

- `/calendar` placeholder를 Platform Wireframe 기준 실제 일정 화면으로 교체했다.
- 월 42칸 그리드, 이전·다음·오늘 이동, 오늘 강조, 셀당 일정 2개와 `+N개 더`, 일정표 보기를 구현했다.
- 원본 명세대로 공통 중앙 `Modal`을 사용해 새 일정 생성과 기존 일정 수정을 구현했다.
- 삭제 동작은 추가하지 않았다.
- 제목, 시작·종료 날짜/시간, 장소, 분류, 메모를 편집하며 종일 일정은 시작·종료 시간을 모두 비운 값으로 표현한다.
- `CalendarRepository`와 메모리 mock 구현을 추가했다.
- `MockPlatformState.calendar.events`와 `calendar.categories`가 일정의 단일 원본이다.
- 과거 대시보드 전용 복제였던 `dashboard.events`는 backing state에서 제거했다. 대시보드 오늘 일정과 사이드바 일정 배지는 공유 일정 상태에서 파생한다.
- 수집함에서 `calendar` 대상으로 승인한 항목은 같은 일정 상태와 대시보드 오늘 일정에 반영된다.
- 생성·수정 pending과 오류를 분리하고, 종료가 시작보다 빠른 값과 시간 한쪽만 입력한 값을 저장하지 않는다.
- 월·일정표 탭 방향키 이동, 공통 Modal focus trap, Escape 닫기, 생성·수정 진입점 focus 복귀를 구현했다.
- 일정이 없는 달에는 월·일정표 각각 첫 생성 액션이 있는 빈 상태를 표시한다.
- 원본에서 `div`였던 일정 블록과 일정표 행은 접근 가능한 `button`으로 바꾸고 `appearance: none`, 기본 border·shadow 제거를 명시했다.

### 스크랩

- `/scrap` placeholder를 Platform Wireframe 기준 실제 스크랩 화면으로 교체했다.
- 4열 카드, 태그 필터, 전체 빈 상태, 필터 결과 없음, 긴 제목 두 줄 제한을 구현했다.
- 원본 명세대로 공통 우측 520px `Drawer`를 상세·댓글에, 공통 480px `Modal`을 생성에 사용했다.
- 원본 명세에 없는 수정·삭제·외부 URL 수집 동작은 추가하지 않았다.
- 파일 업로드는 이번 범위 제한에 따라 원본 드롭존을 구현하지 않았다.
- `ScrapRepository`와 메모리 mock 구현을 추가했다.
- 스크랩 원본 상태에서 대시보드 최근 스크랩과 사이드바 배지를 파생한다.
- 수집함에서 `scrap` 대상으로 승인한 항목은 같은 스크랩 원본 상태와 대시보드에 반영된다.
- 생성, 태그 추가, 댓글 mutation의 pending·오류를 분리했다. 댓글 pending·오류는 스크랩 ID별로 격리한다.
- 태그 필터 방향키·Home·End 이동, Enter 선택, 태그 추가 Enter·Escape, mutation 후 진입점 focus 복귀를 구현했다.
- 스크랩 카드와 필터 버튼은 `appearance: none`, 기본 shadow 제거를 명시했다.

### 가계부

- `/ledger` placeholder를 Platform Wireframe 기준 실제 가계부 화면으로 교체했다.
- 현재 월 지출 합계, 명시적 전월 동기 비교 데이터, 분류별 금액·비율, 전체 지출 목록을 구현했다.
- 월 합계와 분류별 비율은 현재 월 거래만 사용하고, 목록은 원본처럼 과거 월 거래도 표시한다.
- `LedgerRepository`와 메모리 mock 구현을 추가했다.
- 공통 중앙 `Modal`로 항목, 금액, 날짜, 분류, 선택 메모를 입력하는 지출 추가 흐름을 구현했다. 실제 Modal 폭은 440px다.
- 원화 기호·쉼표 정규화, 양의 안전 정수 금액, 실제 존재하는 ISO 날짜 검증을 `packages/contracts`에 추가했다.
- 분류 선택은 방향키, Home, End로 focus를 이동하고 Enter·Space로 선택한다.
- 생성 pending·오류를 Modal 내부에 표시하며 실패 시 입력값을 보존하고 항목 입력으로 focus를 이동한다.
- 성공·취소·Escape 닫기 후에는 공통 overlay 수명주기로 상단 `지출 추가` 진입점에 focus를 복귀한다.
- 수집함에서 `ledger` 대상으로 승인한 항목은 같은 ledger 원본 상태에 추가한다. 승인 후 ledger와 Dashboard query를 모두 갱신한다.
- 전월 동기 비교는 컴포넌트 문자열이 아니라 ledger snapshot의 `direction`과 `percentage` 데이터로 모델링했다.
- 가계부 사이드바 배지는 추가하지 않았다. 상세·수정·삭제·수입·예산·검색·필터·월 이동 등 원본 범위 밖 기능도 추가하지 않았다.

### 회귀 테스트

- 빠른 캡처 제출
- 빠른 캡처 후 수집함 및 배지 반영
- 할 일 완료 토글
- 테마 전환
- 사이드바 확장·축소
- 라우팅
- Dashboard mock 저장소
- Inbox mock 저장소
- 공유 mock 저장소 연결
- 수집함 탭 필터와 키보드 이동
- 단건·일괄 승인
- 필드 수정과 직접 분류
- 버리기·취소·focus 복귀
- 항목별 mutation 오류
- 할 일 상태·라벨 필터와 필터 결과 없음
- 할 일 생성·수정·완료·삭제
- 할 일 라벨 생성·중복 거부·HEX 정규화
- 라벨 생성 pending·실패 입력 보존·색상 키보드 이동·Modal focus 복귀
- 할 일 전체 빈 상태
- 상단 `새 할 일` Modal과 focus 복귀
- 수집함 승인→할 일 목록·대시보드 반영
- 루틴 생성·수정과 Drawer focus 복귀
- 반복 요일·기간·만료·최근 2주 상태
- 루틴 오늘 완료 항목별 pending·오류
- 비지정 요일과 종료일 이후 비활성
- occurrence 결정 키 멱등성
- 루틴 완료→할 일·대시보드 동기화
- 수집함 승인→루틴 목록·대시보드 반영
- 일정 월 경계 42칸·오늘·긴 제목·월/일정표 키보드 전환
- 일정 생성·수정과 Modal focus 복귀
- 일정 전체 빈 상태와 첫 생성 진입
- 일정 생성·수정 pending·실패와 종료 일시 경계 조건
- 수집함 승인→일정 목록·대시보드 오늘 일정 반영
- 사이드바 일정 배지의 공유 상태 파생과 상단 생성 액션
- 스크랩 정상·전체 빈 상태·필터 결과 없음·긴 제목·상세 Drawer
- 스크랩 태그 키보드 이동과 생성·태그 추가 focus 복귀
- 스크랩 생성·댓글 mutation 성공·pending·실패의 항목별 격리
- 수집함 승인→스크랩 목록·대시보드 반영
- 대시보드·사이드바 스크랩 상태 파생과 상단 생성 액션
- 가계부 정상 월 합계·분류별 집계와 다른 달 합계 제외
- 전체 빈 상태와 월 합계 0의 유한 비율 경계
- 긴 항목명·큰 금액·쉼표와 원화 기호가 포함된 금액 입력
- 지출 생성 성공·pending·실패와 실패 입력값 보존
- 지출 Modal focus trap·Escape·진입점 focus 복귀
- 분류 방향키·Home·End·Enter 이동
- 수집함 ledger 승인→가계부·Dashboard 월 지출 반영
- Dashboard 월 지출의 ledger 원본 상태 파생
- 상단 `지출 추가` 액션 연결

현재 테스트는 18개 파일, 87개다.

### 검증 상태

- `npm run typecheck`, `npm test`, `npm run build`를 통과했다.
- `npm run desktop:build`를 통과했고 release 실행 파일을 갱신했다.
- 1440×920 라이트·다크, 224px·56px 사이드바 상태를 검증했다.
- 공통 Drawer와 버리기 Modal, 캡처→수집함 흐름을 실제 렌더링으로 확인했다.
- 할 일 긴 제목, 전체 빈 상태, 필터 결과 없음, 생성 Modal, mutation pending·실패를 테스트와 브라우저 렌더링으로 확인했다.
- 라벨 관리 460px Modal, 긴 라벨, 중복 오류, 라이트·다크 테마를 1440×920 Chrome 렌더링으로 확인했다. 스크린샷은 `.artifacts/todo-labels/*.png`다.
- 새로 빌드한 release 실행 파일에서 1440×920 라이트·다크와 224px·56px 사이드바 네 상태를 직접 캡처했다.
- 수집함 필드 테두리 수정 후 계산 스타일이 `appearance: none`, `1px solid`, `box-shadow: none`인지 확인했다.
- 최신 할 일 release 스크린샷은 `.artifacts/desktop-todo-release-*.png`다.
- 루틴 화면의 긴 제목은 230px 영역에서 `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`을 확인했다.
- 만료 루틴과 오늘 비지정 루틴은 오늘 완료 버튼이 비활성이고 occurrence가 생성되지 않는 것을 테스트와 실제 렌더링으로 확인했다.
- 루틴 완료 후 루틴·할 일·대시보드 세 화면의 같은 occurrence가 모두 완료 상태인지 실제 렌더링으로 확인했다.
- 루틴 mutation pending·실패와 전체 빈 상태는 회귀 테스트로 확인했다.
- 새로 빌드한 release 실행 파일에서 루틴 화면의 1440×920 라이트·다크, 224px·56px 사이드바 네 상태를 직접 캡처했다.
- 최신 루틴 release 스크린샷은 `.artifacts/desktop-routine-release-*.png`다. 생성 Drawer와 긴 제목 렌더 스크린샷도 `.artifacts/desktop-routine-*.png`에 있다.
- 일정 원본 HTML을 실제 렌더링하고 월 화면·중앙 Modal을 구현 화면과 대조했다.
- 일정의 1440×920 라이트·다크, 224px·56px 사이드바 네 상태를 브라우저 렌더링으로 확인했다.
- 생성·수정·일자 Modal, 일정표, 긴 제목, 일정 없는 달을 실제 렌더링으로 확인했다.
- 일정 블록의 계산 스타일이 `appearance: none`, 상단 border `0px`, 좌측 border `2px`, `box-shadow: none`인지 확인했다.
- 일정 Modal 폭 520px, 사이드바 폭 224px·56px, 강조색 `#b03a55`, 긴 제목의 `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`을 확인했다.
- 최신 일정 브라우저 스크린샷은 `.artifacts/desktop-calendar-*-web.png`, 원본 비교 캡처는 `.artifacts/desktop-calendar-design-*.png`다.
- 새로 빌드한 release 실행 파일에서 일정 화면의 1440×920 라이트·다크, 224px·56px 사이드바 네 상태와 생성 Modal을 직접 캡처했다.
- 최신 일정 release 스크린샷은 `.artifacts/desktop-calendar-release-*.png`다.
- 스크랩 원본 HTML을 실제 렌더링하고 목록·상세 Drawer·생성 Modal을 구현 화면과 대조했다.
- 스크랩의 1440×920 라이트·다크, 224px·56px 사이드바 상태를 브라우저 렌더링으로 확인했다.
- 스크랩 카드 계산 스타일은 `appearance: none`, `1px solid`, `box-shadow: none`, 4열을 확인했다.
- 상세 Drawer 폭 520px, 생성 Modal 폭 480px, 강조색 `#b03a55`, 긴 제목 34px 두 줄 영역과 241px 카드 높이를 확인했다.
- 전체 빈 상태, 필터 결과 없음, 생성·댓글 mutation 성공·pending·실패는 회귀 테스트로 확인했다.
- 최신 스크랩 브라우저 스크린샷은 `.artifacts/desktop-scrap-*-web.png`, 원본 비교 캡처는 `.artifacts/desktop-scrap-design-*.png`다.
- 가계부 원본 HTML을 실제 Chromium으로 렌더링하고 목록과 지출 추가 Modal을 구현 화면과 대조했다.
- 가계부의 1440×920 라이트·다크, 224px·56px 사이드바 네 상태와 440px 생성 Modal을 실제 스크린샷으로 확인했다.
- 전체 빈 상태, 긴 항목명·큰 금액, 생성 pending·실패도 별도 실제 렌더링 스크린샷으로 확인했다.
- 강조색은 `packages/ui/src/styles/tokens.css`의 `--color-accent` 외에 새 원본 값을 추가하지 않았다.
- 새로 빌드한 `mono-desktop.exe`를 실행했고 5초 후에도 조기 종료 없이 실행 중임을 확인한 뒤 검증 프로세스만 종료했다.
- 루트에는 `npm run branding`, `npm run desktop` 스크립트가 없다. 실제 검증 명령은 `branding:sync`, `desktop:build`다.

## 강조색 변경 방법

아래 한 값만 변경한다.

```css
/* packages/ui/src/styles/tokens.css */
--color-accent: #b03a55;
```

- 앱 UI의 hover·soft·focus·active 상태는 자동 파생된다.
- `npm run desktop:dev` 또는 `npm run desktop:build`가 Tauri SVG와 Windows ICO도 자동 동기화한다.
- 수동 동기화만 필요하면 `npm run branding:sync`를 실행한다.
- `app-icon.svg`와 `icons/icon.ico`를 직접 편집하지 않는다.

## 현재 주요 경계 (2026-08-21 기준, 이후 상태는 아래 "이후 진행" 참고)

```text
DashboardRepository
InboxRepository
TodoRepository
RoutineRepository
CalendarRepository
ScrapRepository
LedgerRepository
```

- 일곱 경계의 현재 구현은 메모리 mock이며 하나의 `MockPlatformState`를 공유한다.
- 서버나 영속 저장소를 React 컴포넌트에 직접 붙이지 않는다.
- 화면 동작 하나를 감싸기 위한 서비스·인터페이스는 추가하지 않는다.

## 다음 권장 작업 (2026-08-21 기준)

PC 데스크톱의 수집함, 할 일, 루틴, 일정, 스크랩, 가계부와 Dashboard 연결은 완료됐다. 이후 작업도 현재 일곱 저장소 경계와 공유 상태 파생 규칙을 유지해야 한다.

- 추가 화면 구현보다 현재 단일 원본·파생 snapshot 구조를 보존한다.
- 서버·SQLite 전환 전에는 현재 mock 저장소 경계 밖에 영속화 코드를 넣지 않는다.

## 이후 남은 범위 (2026-08-21 기준 — 서버·SQLite·AI는 이후 진행에서 완료됨)

- 현재 명시된 PC 데스크톱 모듈 화면의 placeholder는 남아 있지 않다.
- 서버, SQLite 영속화, 실제 AI 분류는 구현하지 않았다.
- iOS와 모바일 웹은 현재 범위가 아니다.

## 이후 진행 (2026-08-26~27)

이 문서는 2026-08-21 시점 스냅샷이다. 그 이후 다음이 완료돼 위 세 섹션의 "서버·SQLite·AI 미구현", "일곱 경계는 메모리 mock" 서술은 더 이상 맞지 않는다.

- **서버·SQLite 영속화**: 처음엔 `apps/api`(Fastify + Drizzle + better-sqlite3)로 전 경계 구현. **2026-08-27 Tauri 바이너리에 임베드된 Rust axum 서버로 전면 이관 완료** — `apps/api`는 삭제됨. 계약 경계(HTTP)는 불변이라 프론트(`http-*-repository.ts`)·mock은 무변경. 상세: [rust-api-porting.md](./rust-api-porting.md), [architecture-decisions.md](./architecture-decisions.md) §9.
- **AI 캡처 분류**: Gemini·OpenAI 중 설정에서 고른 provider로 실제 분류. API 키는 AES-256-GCM 암호화 저장.
- **패키징**: `release/mono-desktop.exe` 단독 실행. API 서버가 바이너리에 임베드돼 별도 런타임·사이드카 없음(Node 이관 전에는 Node 사이드카를 zip으로 임베드했음).
- **설정 화면**: AI provider 선택·API 키 관리, 저장공간(미사용 미디어 정리) 패널 추가.
- 안 된 것: 파일 저장소(`FileStore`), 백업 정책, iOS. `.refs/architecture-decisions.md` §9 "아직 결정하지 않은 사항" 그대로 유효.

## 검증 명령

```text
npm run branding:sync
npm run typecheck
npm test
npm run build
npm run desktop:build
```

Tauri 실행 파일:

```text
apps/desktop/src-tauri/target/release/mono-desktop.exe
```

## 주요 파일

```text
packages/ui/src/styles/tokens.css
packages/ui/src/styles/components.css
packages/ui/src/icons.tsx
packages/ui/src/index.tsx
packages/contracts/src/index.ts
scripts/sync-windows-branding.ps1
apps/desktop/src/shell/AppShell.tsx
apps/desktop/src/features/dashboard/DashboardPage.tsx
apps/desktop/src/features/inbox/InboxPage.tsx
apps/desktop/src/features/todo/TodoPage.tsx
apps/desktop/src/features/routine/RoutinePage.tsx
apps/desktop/src/features/calendar/CalendarPage.tsx
apps/desktop/src/features/scrap/ScrapPage.tsx
apps/desktop/src/features/ledger/LedgerPage.tsx
apps/desktop/src/features/ledger/ledger-summary.ts
apps/desktop/src/features/dashboard/dashboard-repository.ts
apps/desktop/src/features/inbox/inbox-repository.ts
apps/desktop/src/features/todo/todo-repository.ts
apps/desktop/src/features/routine/routine-repository.ts
apps/desktop/src/features/calendar/calendar-repository.ts
apps/desktop/src/features/scrap/scrap-repository.ts
apps/desktop/src/features/ledger/ledger-repository.ts
apps/desktop/src/infrastructure/mock/mock-platform-state.ts
apps/desktop/src/infrastructure/mock/mock-dashboard-repository.ts
apps/desktop/src/infrastructure/mock/mock-inbox-repository.ts
apps/desktop/src/infrastructure/mock/mock-todo-repository.ts
apps/desktop/src/infrastructure/mock/mock-routine-repository.ts
apps/desktop/src/infrastructure/mock/mock-calendar-repository.ts
apps/desktop/src/infrastructure/mock/mock-scrap-repository.ts
apps/desktop/src/infrastructure/mock/mock-ledger-repository.ts
apps/desktop/src/infrastructure/mock/mock-routine-occurrences.ts
apps/desktop/src/features/capture-inbox-flow.test.tsx
apps/desktop/src/features/inbox/InboxPage.test.tsx
apps/desktop/src/features/todo/TodoPage.test.tsx
apps/desktop/src/infrastructure/mock/mock-repository-connection.test.ts
apps/desktop/src/infrastructure/mock/mock-todo-repository.test.ts
apps/desktop/src/infrastructure/mock/mock-routine-repository.test.ts
apps/desktop/src/features/routine/RoutinePage.test.tsx
apps/desktop/src/features/calendar/CalendarPage.test.tsx
apps/desktop/src/infrastructure/mock/mock-calendar-repository.test.ts
apps/desktop/src/features/scrap/ScrapPage.test.tsx
apps/desktop/src/infrastructure/mock/mock-scrap-repository.test.ts
apps/desktop/src/features/ledger/LedgerPage.test.tsx
apps/desktop/src/features/ledger/ledger-summary.test.ts
apps/desktop/src/infrastructure/mock/mock-ledger-repository.test.ts
apps/desktop/src/styles/global.css
apps/desktop/src-tauri/tauri.conf.json
```

## 다음 세션 시작 기준

- 먼저 이 문서(특히 위 "이후 진행")와 `.refs/architecture-decisions.md`, `apps/api/README.md`를 UTF-8로 읽는다.
- 테스트 파일·통과 개수는 이 문서가 아니라 `npm test` 실행 결과를 source of truth로 삼는다(여기 적힌 "18개 파일 87개"는 2026-08-21 desktop 전용 수치로 이미 낡았다 — 이후 서버 테스트가 추가됐고 desktop 쪽도 늘었다).
- 수집함, 할 일, 루틴, 일정, 스크랩, 가계부, occurrence 연결을 재구현하거나 대규모 리팩터링하지 않는다. 공유 상태는 이제 mock이 아니라 API SQLite가 원본이다.
- Dashboard의 `monthlyExpense`는 ledger 원본 상태에서 파생한다. 대시보드 전용 복제 상태를 다시 만들지 않는다.
- 새 기능도 현재 저장소 경계와 단일 원본·파생 스냅샷 원칙을 유지한다.
