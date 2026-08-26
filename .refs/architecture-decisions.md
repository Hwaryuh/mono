# 아키텍처 결정 기록

- 상태: 초안 합의
- 최종 갱신: 2026-08-14
- 대상: 모듈형 개인 관리 플랫폼

현재 구현 상태와 다음 작업은 [PC 데스크톱 구현 인계 문서](./desktop-implementation-handoff.md)에서 관리한다. 아키텍처 결정과 진행 상태를 섞지 않는다.

## 1. 제품 전제

- 개인용 단일 사용자 서비스다.
- 우선 지원 대상은 PC 데스크톱 앱이다.
- 모바일 지원은 후순위다.
- 기존 모바일 디자인은 폐기한다.
- iOS를 지원할 때 기존 데스크톱 UI를 이식하지 않는다. SwiftUI 표준 컴포넌트와 Apple 플랫폼 관례를 따른 별도 네이티브 UI를 만든다.
- iOS 앱은 장기적으로 심사 및 배포를 목표로 한다. 단, 현재 개발의 우선순위나 데스크톱 구조를 좌우하는 요구사항은 아니다.

## 2. 선택한 기술

### PC 데스크톱

- 언어: TypeScript
- UI: React
- 빌드 도구: Vite
- 데스크톱 셸: Tauri 2
- 라우팅: React Router
- 서버 상태: TanStack Query
- 런타임 검증: Zod

React 기반 UI를 웹 브라우저 전용으로 취급하지 않는다. Tauri가 React UI를 설치형 데스크톱 앱으로 제공하고, 파일 시스템·알림·트레이·전역 단축키 같은 운영체제 기능은 Tauri 경계를 통해 사용한다.

### 서버

- 언어: TypeScript
- HTTP API: Fastify
- 데이터베이스: SQLite
- ORM 및 마이그레이션: Drizzle ORM
- API 명세: OpenAPI
- 파일: 데이터베이스 BLOB가 아닌 별도 파일 저장소

단일 사용자와 낮은 쓰기 동시성을 전제로 SQLite를 사용한다. PostgreSQL, Redis, BullMQ는 현재 범위에서 운영 복잡도만 높이므로 도입하지 않는다.

AI 분류처럼 재시작 후에도 복구돼야 하는 작업은 영속 작업 테이블로 관리한다. 초기에는 별도 메시지 브로커를 두지 않는다.

### iOS — 후순위

- 언어: Swift
- UI: SwiftUI
- 네트워크: 서버의 OpenAPI 명세로부터 Swift 클라이언트와 모델 생성
- 로컬 저장소: 오프라인 요구가 확정될 때 SwiftData 캐시와 outbox 검토

iOS와 PC는 UI 구현 코드를 공유하지 않는다. 공유하는 것은 API 계약, 데이터 의미, 동작 규칙이다.

## 3. 구조 원칙

권장 저장소 구조:

```text
apps/
  desktop/      React/Vite UI + Tauri 셸
  api/          Fastify API
packages/
  domain/       프레임워크 비의존 도메인 규칙
  contracts/    Zod 스키마와 OpenAPI 계약
  ui/           PC용 공통 UI 컴포넌트
```

외부 시스템과 플랫폼 기능은 포트로 격리한다.

```ts
interface CaptureClassifier
interface FileStore
interface SecretStore
interface CalendarProvider
interface BackupStore
```

- 인터페이스는 실제 교체 가능성이 있는 경계에만 둔다.
- 단순 코드 포장용 서비스나 메서드는 만들지 않는다.
- UI, 애플리케이션 규칙, 저장소 구현의 의존 방향을 분리한다.
- Tauri API를 React 컴포넌트에서 직접 넓게 호출하지 않는다.
- 서버와 클라이언트의 요청·응답 타입을 수동으로 중복 선언하지 않는다.

## 4. 데이터와 동기화

모바일 지원 시 서버 데이터베이스를 유일한 원본으로 둔다.

```text
서버 SQLite = 원본
PC 로컬 데이터 = 캐시
iOS 로컬 데이터 = 캐시
```

PC와 iOS가 각각 독립 원본 데이터베이스를 가진 뒤 파일 단위로 병합하는 구조는 사용하지 않는다. 충돌과 데이터 손상 가능성이 커진다.

초기 데스크톱 단계의 오프라인 동작 범위는 아직 확정하지 않았다. 구현 전에 아래 둘 중 하나를 선택한다.

1. API 서버를 처음부터 원본으로 사용한다.
2. 로컬 저장소를 저장소 인터페이스 뒤에 두고, 모바일 착수 전에 서버 원본 구조로 전환한다.

모바일 지원이 확실하므로 기본 권장은 1번이다.

## 5. 인증과 비밀 정보

- 단일 사용자라는 사실은 인증이 불필요하다는 뜻이 아니다.
- API가 인터넷에 노출되면 인증은 필수다.
- AI 및 외부 서비스 API 키를 React 번들이나 모바일 앱에 포함하지 않는다.
- 비밀 정보는 서버에서 암호화해 보관하거나 운영체제 보안 저장소를 사용한다.
- 사설망 전용 운영 여부와 인증 방식은 배포 환경 결정 때 확정한다.

## 6. iOS 배포 방향

- App Store 공개 출시는 개인 기기에서 앱을 실행하기 위한 필수 조건이 아니다.
- 무료 Apple 계정의 Personal Team으로 Xcode에서 직접 설치할 수 있지만 프로비저닝 프로파일이 7일 후 만료돼 반복 설치가 필요하다.
- 유료 Apple Developer Program의 Ad Hoc 배포는 등록 기기에 직접 설치할 수 있다.
- TestFlight 빌드는 공개 출시 없이 설치할 수 있지만 각 빌드의 사용 기간은 최대 90일이다.
- 장기 목표는 심사 및 정식 배포다. 현재 단계에서는 관련 작업을 선행하지 않는다.
- SwiftUI 개발, 실제 기기 빌드, 서명에는 macOS와 Xcode가 필요하다.

## 7. 단계별 범위

### 1단계 — 지금

- PC 데스크톱 개발 환경 구성
- React/Vite와 Tauri 셸 구성
- 디자인 토큰과 공통 컴포넌트 기반 마련
- 데스크톱 화면 구현
- 서버·저장소 경계 확정

### 2단계

- Fastify API와 SQLite 영속화
- 파일 저장, 백업, 외부 서비스 키 관리
- AI 캡처 분류와 영속 작업 처리

### 3단계 — 후순위

- SwiftUI 기반 iOS 앱 설계
- OpenAPI 기반 Swift 클라이언트 생성
- 네이티브 알림, 공유 확장, 카메라·파일 접근 검토
- App Store 심사 및 배포

## 8. 채택하지 않은 선택

- Next.js: SEO와 SSR 이점이 작고 서버·클라이언트 경계 복잡도가 불필요하다.
- NestJS: 현재 규모에 비해 DI와 데코레이터 구조가 무겁다.
- Electron: Tauri보다 런타임과 메모리 비용이 크다.
- React Native 또는 Capacitor iOS: SwiftUI 표준 경험을 목표로 하므로 사용하지 않는다.
- SwiftUI 멀티플랫폼 PC 앱: 현재 PC 대상과 기존 HTML 기반 디자인 자산 활용에 불리하다.
- PostgreSQL·Redis: 현재 사용자 수와 동시성에 비해 과설계다.

## 9. 결정 사항

### 2단계 착수 결정 (2026-08-26 확정)

- 오프라인 범위: **API 서버를 처음부터 원본으로 사용한다** (§4 1번). 로컬 독립 원본을 두지 않는다.
- API 운영 위치: **2단계는 localhost 개발.** 홈 서버·NAS·VPS 배포 위치는 모바일 착수 때 확정한다.
- 인증: **2단계 localhost 구간은 인증 스텁만 둔다.** 실제 인증(§5)은 인터넷 노출 배포를 결정할 때 확정한다.
- 파일 저장소: **로컬 디스크**를 `FileStore` 포트 뒤에 둔다. S3 호환 저장소는 배포 때 재검토한다.
- 네 결정 모두 "나중에 교체 가능한 경계 뒤"에 둔다. 지금 배포·인증·클라우드 저장소를 선구현하지 않는다.

### 아직 결정하지 않은 사항

- 백업 보존 정책과 암호화 방식
- Windows 외 데스크톱 운영체제 지원 범위
- iOS 최소 지원 버전

## 참고

- [PC 데스크톱 구현 인계](./desktop-implementation-handoff.md)
- [주 디자인 시안](../.designs/project/Platform%20Wireframe.dc.html)
- [기능 명세](../.designs/project/uploads/DESIGN-SPEC.md)
- [Tauri 2 공식 문서](https://v2.tauri.app/)
- [SwiftUI 공식 문서](https://developer.apple.com/documentation/swiftui)
- [Apple Developer 멤버십 비교](https://developer.apple.com/support/compare-memberships/)
- [SQLite 선택 기준](https://www.sqlite.org/whentouse.html)
