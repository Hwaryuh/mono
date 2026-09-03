# 멀티 기기 실시간 갱신과 충돌 방지

상태: 2026-08-31 구현 및 자동 검증 완료

## 1. 목표

같은 standalone API 서버를 사용하는 데스크톱들이 서버 변경을 열린 화면에 즉시 반영한다.
오래된 편집 화면이 더 최신인 서버 값을 조용히 덮어쓰지 못하게 한다.

이번 범위에서 **동기화**는 원격 서버의 SQLite를 단일 원본으로 사용하는 온라인 동작을 뜻한다.
각 기기에 독립 원본을 두고 나중에 병합하는 오프라인 동기화는 포함하지 않는다.

## 2. 결정

### 서버 변경 알림은 SSE

- `GET /events`가 모듈 단위 변경 이벤트를 보낸다.
- 이벤트는 변경 데이터 자체가 아니라 `{ revision, modules }` 무효화 신호다.
- 클라이언트는 관련 React Query 키만 무효화하고 기존 snapshot API로 최신 원본을 다시 읽는다.
- 단일 사용자·서버→클라이언트 단방향 알림이므로 WebSocket은 사용하지 않는다.
- 서버의 성공한 mutation 응답만 이벤트를 발행한다. 실패한 요청은 발행하지 않는다.

SSE는 영속 변경 로그가 아니다. 서버 재시작이나 연결 단절 사이의 모든 이벤트 재생을 보장하지
않는다. 클라이언트는 SSE 연결 및 재연결 때 현재 캐시를 무효화해 누락 가능성을 제거한다.

### 편집 충돌은 레코드 버전으로 차단

- 사용자가 편집 후 저장하는 레코드는 양의 정수 `version`을 가진다.
- 클라이언트는 읽었던 버전을 `If-Match` 요청 헤더로 보낸다.
- 서버는 `UPDATE ... WHERE id = ? AND version = ?`로 값 변경과 버전 증가를 원자적으로 수행한다.
- 레코드가 존재하지만 버전이 다르면 `409 Conflict`를 반환한다.
- 클라이언트는 최신 snapshot을 다시 읽고 기존 편집값을 유지한 채 충돌 사실을 표시한다.

토글처럼 서버의 현재값에 원자적으로 적용하는 명령, 생성, 서버에서 존재 여부를 검증하는 삭제는
이번 버전 검사 대상에서 제외한다. 동일 레코드 전체를 오래된 폼 값으로 덮는 update 경로를 우선
보호한다.

### 호환성과 배포 순서

- 기존 SQLite에는 시작 시 누락된 `version` 컬럼을 기본값 1로 추가한다.
- snapshot의 `version`은 전환 기간 동안 클라이언트 계약에서 선택값으로 읽되, 새 서버는 항상 보낸다.
- `If-Match`가 없는 구버전 클라이언트 요청은 전환 기간 동안 허용한다. 새 클라이언트는 항상 보낸다.
- 서버를 먼저 배포하고 데스크톱을 갱신한다. 모든 데스크톱 갱신 후 헤더 필수화를 후속 검토한다.

## 3. 이벤트 모듈 매핑

| mutation 경로 | 무효화 모듈 |
| --- | --- |
| `/todo` | todo, routine, dashboard |
| `/routine` | routine, todo, dashboard |
| `/calendar` | calendar, dashboard |
| `/scrap` | scrap, dashboard |
| `/ledger` | ledger, dashboard |
| `/inbox` | inbox, todo, calendar, scrap, ledger, dashboard |
| `/dashboard` | dashboard, inbox, todo, routine |

설정·미디어 유지보수 요청은 화면 snapshot 변경 이벤트에 포함하지 않는다.

## 4. 오류와 복구

- SSE 연결 실패는 데이터 쓰기를 막지 않는다. EventSource의 자동 재연결을 사용한다.
- 재연결 성공 시 모든 snapshot 쿼리를 무효화한다.
- `409 Conflict`는 네트워크 오류와 구분한다. 편집 폼을 닫거나 입력을 버리지 않는다.
- 서버 연결이 끊기면 기존 원격 데이터 기능과 동일하게 읽기·쓰기가 중단된다.

## 5. 제외 범위

- 오프라인 편집 큐와 outbox
- 기기별 로컬 SQLite 원본
- CRDT·OT·문자 단위 공동 편집
- 사용자 presence, 커서, 편집자 표시
- 영속 이벤트 로그와 과거 이벤트 재생
- 인터넷 공개용 인증 설계

현재 운영 전제는 Tailscale 안의 단일 사용자 서버다. 선택적 베어러 토큰 인증은 `auth` 모듈이 이미
지원한다(`MONO_API_TOKEN`). SSE `/events`는 인증에서 예외로 둔다 — 브라우저 EventSource가 커스텀
헤더를 실을 수 없고, 토큰을 URL 쿼리로 넘기면 로그·프록시에 노출되기 때문이다. 이벤트 페이로드는
`{ revision, modules }` 무효화 신호뿐이라 실제 데이터가 없고, 데이터 재조회는 게이트된 snapshot
경로가 막는다.

## 6. 검증 기준

1. 두 클라이언트가 같은 서버를 보고 있을 때 한쪽의 성공한 mutation이 다른 쪽 관련 snapshot을
   다시 읽게 한다.
2. 연결이 끊겼다가 복구되면 열린 클라이언트가 전체 snapshot 캐시를 다시 검증한다.
3. 같은 버전을 읽은 두 클라이언트가 같은 레코드를 수정하면 첫 저장만 성공하고 둘째는 409를 받는다.
4. 서로 다른 레코드 수정은 서로 충돌하지 않는다.
5. 기존 DB를 열 때 데이터 손실 없이 version 컬럼이 추가된다.

## 7. 구현 결과

- Rust API에 `GET /events`, 모듈 변경 발행 middleware, 재동기화 이벤트를 추가했다.
- 데스크톱은 EventSource 연결·재연결 및 모듈 이벤트에 맞춰 React Query snapshot을 무효화한다.
- 편집 가능한 레코드 snapshot에 `version`을 추가하고 update 요청에 `If-Match`를 보낸다.
- 서버 update는 버전 일치 조건에서만 실행되며 오래된 저장은 `409 Conflict`로 반환한다.
- 기존 SQLite에는 시작 시 `version INTEGER NOT NULL DEFAULT 1`을 데이터 손실 없이 추가한다.

자동 검증 결과:

- Rust API 단위·HTTP·SSE 통합 테스트 146개 통과
- 데스크톱 단위·컴포넌트 테스트 158개 통과
- TypeScript typecheck(`tsc -b`), Rust `cargo check --workspace`, Vite production build 통과
- origin/main(0.1.261) 최신 위로 이식. 카테고리 version은 공용 `category::Categories::update`에서
  중앙 처리하고, 캘린더 이벤트 version은 반복 마스터 행 기준으로 전개 occurrence에 실린다.
