# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

이 저장소는 Tauri 2 데스크톤 앱(Windows + macOS Apple Silicon)이다. React/Vite UI를
설치형 데스크톱 앱으로 제공하며 웹 브라우저 배포 대상이 아니다. 최소 창 너비 960px,
반응형 모바일 레이아웃 없음. 예정된 iOS 앱은 **별도 네이티브 Swift/SwiftUI 코드베이스**로,
이 저장소의 UI 코드를 공유하지 않는다(공유 대상은 API 계약·데이터 의미·동작 규칙뿐).

## Users

단일 사용자 — 제품 소유자 본인. 한 사람이 Windows 데스크톱과 Mac에서 같은 데이터를
오간다. 계정·로그인·멀티테넌시·앱 레벨 인증이 없는 것이 설계 전제다. 장기적으로 소규모
공개 가능성은 열어 두되(각자 자기 서버로 운영), 현재 모든 결정은 단일 사용자 기준이다.

## Product Purpose

모듈형 개인 관리 플랫폼. 한 앱에서 대시보드·수집함·할 일·루틴·일정·스크랩·가계부를
다룬다. 어디서든 단축키 하나(⌘K/Ctrl+K)로 빠르게 캡처하면 AI가 분류 후보를 만들고,
사용자가 수집함에서 승인해 각 모듈로 보낸다. 성공은 "생각난 것을 놓치지 않고 적고, 나중에
제자리에서 찾는다".

## Positioning

로컬 우선(local-first) 개인 관리 도구. 계정도 SaaS 서버도 없이 진짜 단일 사용자로 동작하고,
상태 원본을 자체 SQLite로 소유한다(비밀 정보는 마스터 키로 서버 암호화). 여러 기기 공유가
필요하면 공인 인터넷에 한 번도 노출하지 않고 개인 Tailnet의 자기 VPS에서 API 서버를 돌린다.
이웃한 노트/PKM 앱이 그대로 따라 할 수 없는 지점은 "클라우드 계정 없는 다기기 + 데이터 완전
소유 + 사설망 셀프호스팅"의 결합이다.

## Operating Context

- 설치형 데스크톱 앱. 좌측 사이드바 내비게이션 + 상단바 + 모달 편집기. 키보드 우선:
  주요 액션마다 단축키(⌘,/⌘K/⌘N), macOS는 ⌘·Windows는 Ctrl로 플랫폼별 modifier 처리.
- 상태 원본은 API 서버의 SQLite. 앱은 실행 시 연결을 결정한다 — 임베드(로컬
  `127.0.0.1:4174`) 또는 원격(Tailscale VPS). `설정 > 서버`에서 전환하며 적용은 재시작 후.
- 원격 모드: 여러 데스크톱이 같은 VPS SQLite를 원본으로 본다. 오프라인 편집 병합 없음.
  Tailscale/VPS 연결이 끊기면 원격 데이터 기능 정지.
- 빠른 캡처는 AI 제공자(Gemini 또는 OpenAI) 한 곳으로 텍스트·이미지를 보내 분류를 받는다.
  API 키는 서버에 암호화 저장되고 화면으로 다시 노출되지 않는다.
- 미디어(사진·영상)는 Cloudflare R2에 저장. 자격증명도 서버 암호화.
- 서버는 매일 SQLite + 마스터 키를 함께 백업. 배포는 CI 통과한 main 커밋을 workflow_dispatch로
  VPS에 반영(`.github/workflows/deploy-server.yml`).
- UI 언어는 한국어. 문서·커밋 관례는 한국어 평어체, UTF-8.

## Capabilities and Constraints

- 모듈: 대시보드 / 수집함(AI 분류 + 승인) / 할 일(라벨) / 루틴(반복 규칙) / 일정(카테고리) /
  스크랩(태그·미디어) / 가계부(지출 카테고리).
- 빠른 캡처: 전역 단축키, 텍스트 + 이미지 드롭, AI 분석 후보.
- 서버 모드: 임베드 / 원격. 원격 API 주소는 http는 4174, https는 443/4174 포트만 허용하고
  경로·쿼리·자격증명을 포함할 수 없다. 앱 레벨 인증은 없음 — 보안은 네트워크 레벨(Tailscale)
  전제. 인터넷 노출 시 인증은 필수(미구현, 후속).
- 데스크톱 전용, 최소 960px, 모바일/반응형 없음.
- 자동 업데이트 없음(릴리스에서 직접 재설치). 오프라인 동기화 없음.
- macOS 빌드는 Apple Silicon 전용, ad-hoc 서명, 미공증. Intel Mac 미지원.
- 아키텍처 경계: 교체 가능성이 실재하는 포트에만 인터페이스(`CaptureClassifier`, `FileStore`,
  `SecretStore`, `CalendarProvider`, `BackupStore`, 각 `*Repository`, `*SettingsStore`).
  Tauri API를 컴포넌트에서 직접 넓게 호출하지 않는다. 서버·클라이언트 요청/응답 타입을
  수동 중복 선언하지 않는다.
- 미정: 인터넷 노출 시 인증 방식, 데스크톱 오프라인 동작 범위, R2 보존 정책, 외부 백업 복제.

## Brand Commitments

- 이름: **mono** (소문자).
- 서체: 본문/UI는 **SUIT Variable**, 코드·숫자·측정값은 **Orbit**(둘 다 self-host, `@mono/ui`).
- 색: OKLCH 토큰 시스템, 라이트/다크 대응. 강조색(`--color-accent`)은 사용자가 설정에서 변경.
- 아이콘: `@mono/ui`의 단일 stroke SVG 세트(24×24, Lucide 계열). 이모지·유니코드 글리프로
  아이콘을 대체하지 않는다.
- iOS 앱을 만들 때 데스크톱 UI를 이식하지 않는다 — SwiftUI 표준 컴포넌트와 Apple 플랫폼
  관례를 따른 별도 네이티브 UI.
- 폐기된 구 모바일 디자인은 참조하지 않는다.

## Evidence on Hand

- 동작하는 앱과 테스트: 프론트 159개, Rust 126개(`mono-api` 119 + `mono-desktop` 7).
- GitHub 릴리스 v0.1.2 (Windows NSIS + macOS arm64 DMG), 저장소 `Hwaryuh/mono`(private).
- 결정·설계 기록: `.refs/architecture-decisions.md`, `.refs/rust-api-porting.md`,
  `.refs/server-deployment.md`, `.refs/desktop-release.md`,
  `.refs/desktop-implementation-handoff.md`. API 계약은 `packages/contracts`(Zod + OpenAPI).
- 없음(향후 작업이 지어내면 안 되는 것): 고객·사용자 후기·사례 연구·언론·가격·라이선스.
  개인 프로젝트다.

## Product Principles

1. **단일 사용자, 기본값이 사생활** — 기본 경로에 계정도 제3자 서버도 없다.
2. **데이터 소유** — 상태는 자체 SQLite에 있고 사용자가 옮기고 백업하고 셀프호스팅할 수 있다.
3. **로컬 우선, 네트워크는 선택** — 한 기기에서는 오프라인으로 완전히 동작한다. 다기기 공유는
   opt-in이며 사설망(Tailnet) 안에서만.
4. **키보드 우선 데스크톱** — 모든 주요 액션에 단축키가 있고 마우스는 선택이다.
5. **캡처에 마찰이 없다** — 어디서든 단축키 하나, 분류는 AI가 한다.
6. **UI는 공유하지 않고 계약을 공유한다** — 플랫폼별 앱은 각자 그 플랫폼 관례를 따르되
   API·데이터 의미·동작 규칙은 하나다.

## Accessibility & Inclusion

- UI 언어는 한국어. 한국어 사용자 기준으로 카피·레이블·오류 메시지를 쓴다.
- 오버레이(모달·드로어)는 포커스 트랩과 ESC 닫기, 포커스 복원을 구현한다.
- 라이트/다크 테마와 `prefers-reduced-motion`을 존중한다(애니메이션은 축소 모션에서 꺼진다).
- 공식 WCAG 목표는 아직 설정하지 않았다. 대비·포커스 링·타깃 크기는 토큰 시스템과
  impeccable craft floor 기준을 따른다.
