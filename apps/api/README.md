# API

Fastify + Drizzle + better-sqlite3 기반 서버. 2단계 영속화의 원본이다(`.refs/architecture-decisions.md` §4, §9).

## 실행

```powershell
npm run dev --workspace @mono/api    # tsx watch, 127.0.0.1:4174
npm test --workspace @mono/api
```

- `MONO_DB_PATH`로 DB 경로를 정한다. 기본 `mono.sqlite`, 테스트는 `:memory:`.
- `PORT` 기본 4174.

## 현재 범위

**7경계 모두 구현했다.** Todo, Ledger, Routine, Calendar, Scrap, Inbox, Dashboard — 데스크톱 각 `*Repository` 인터페이스와 같은 op·에러 시맨틱을 SQLite에 대해 만족한다.

- 검증은 `@mono/contracts` Zod 스키마를 재사용한다. 요청·응답 타입을 수동 중복하지 않는다(§3).
- 라우트는 인터페이스를 HTTP로 노출한다. 오류는 error handler가 404/422/400으로 매핑한다.
- 인증은 스텁이다(§5). 로컬 디스크 파일 저장은 아직 없다.

### 경계별 비고

- **Ledger**: mock이 고정값으로 심었던 전월 동기 비교(`comparison`)를 실제 지출 합계로 계산한다. "기타" 분류는 예약 id `other`로 DB 생성 시 자동 시드하고 삭제를 막는다(`LEDGER_OTHER_CATEGORY_ID`, `db/client.ts`).
- **Routine**: 라벨은 Todo 라벨 테이블을 공유한다(별도 라벨 테이블 없음). occurrence는 결정 키(`routineId:occurrenceDate`)로 멱등 생성한다. `toggleOccurrenceById`는 `RoutineRepository` 공개 인터페이스 밖의 추가 메서드로, Dashboard가 occurrence를 항목 단위로 토글할 때 쓴다.
- **Inbox**: 승인(`approve`)은 대상 경계(Todo/Calendar/Scrap/Ledger) 테이블에 직접 쓴다. Scrap 승인은 kind(image/video/url/text)·mediaId를 다뤄야 해서 `ScrapRepository.create`(텍스트·URL 전용)를 거치지 않는다 — mock과 동일한 설계다. 라벨/분류가 비어 있으면 (mock처럼 존재를 가정해 크래시하는 대신) 명확한 오류를 던진다.
- **Dashboard**: 다른 5경계 저장소 인스턴스를 조합해 read-model을 파생한다. 자체 상태는 최근 캡처 로그(`dashboard_captures`)뿐이다. `capture()`의 AI 분류는 `CaptureAnalysisProvider` 포트 뒤에 `nullCaptureAnalysisProvider`(항상 실패)로 스텁했다 — 실제 AI 연동 전까지 모든 캡처는 상태 `failed`로 들어간다.
- `fields`/`images`/`videos`(Inbox), `days`(Routine)는 조회 쿼리 대상이 아닌 소량 구조화 payload라 JSON 텍스트 컬럼에 둔다. 정규화는 필요해지면 승격한다.

## 다음

- 스키마가 안정되면 idempotent DDL을 drizzle-kit 마이그레이션으로 승격한다.
- 실제 AI 캡처 분류(`CaptureAnalysisProvider` 구현체)와 영속 작업 테이블은 §7 2단계 남은 항목이다.
- 파일 저장소(`FileStore`, 로컬 디스크)는 아직 없다 — Scrap의 `mediaId`는 참조만 저장한다.
- 데스크톱 mock→HTTP 저장소 교체는 다음 세션에서 경계 뒤 실제 작업이다. 그 전까지 데스크톱은 mock을 유지한다.
