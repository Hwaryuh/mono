# API

Fastify + Drizzle + better-sqlite3 기반 서버. 2단계 영속화의 원본이다(`.refs/architecture-decisions.md` §4, §9).

## 실행

```powershell
npm run dev --workspace @mono/api    # tsx watch, 127.0.0.1:4174
npm test --workspace @mono/api
npm run build --workspace @mono/api  # esbuild로 dist/server.cjs 단일 파일 번들(패키징용)
```

- `MONO_DB_PATH`로 DB 경로를 정한다. 기본 `mono.sqlite`, 테스트는 파일마다 격리된 임시 경로(`src/test/setup.ts`).
- `MONO_SECRET_KEY_PATH`로 비밀 정보 복호화 마스터 키 경로를 정한다. 기본 `mono.secret.key`(CWD 상대) — 절대 커밋하지 않는다(`.gitignore`).
- `PORT` 기본 4174.
- 실행 진입점은 `src/main.ts`다. `src/server.ts`는 `buildServer()`만 export하는 순수 모듈이고, 테스트는 이걸 직접 불러 `app.inject`로 검증한다(listen 없이).

## 현재 범위

**7경계 모두 구현했다.** Todo, Ledger, Routine, Calendar, Scrap, Inbox, Dashboard — 데스크톱 각 `*Repository` 인터페이스와 같은 op·에러 시맨틱을 SQLite에 대해 만족한다. 데스크톱은 전부 이 API를 HTTP로 호출한다(mock 저장소는 테스트 전용으로만 남아 있다).

- 검증은 `@mono/contracts` Zod 스키마를 재사용한다. 요청·응답 타입을 수동 중복하지 않는다(§3).
- 라우트는 인터페이스를 HTTP로 노출한다. 오류는 error handler가 404/422/400으로 매핑한다.
- 인증은 스텁이다(§5). 로컬 디스크 파일 저장은 아직 없다.
- 캡처 AI 분류는 Gemini·OpenAI 중 설정에서 고른 provider로 실제 동작한다(`repositories/selectable-capture-analysis-provider.ts`). API 키는 `secrets` 테이블에 AES-256-GCM으로 암호화 저장한다(`security/secret-crypto.ts`).

### 경계별 비고

- **Ledger**: mock이 고정값으로 심었던 전월 동기 비교(`comparison`)를 실제 지출 합계로 계산한다. "기타" 분류는 예약 id `other`로 DB 생성 시 자동 시드하고 삭제를 막는다(`LEDGER_OTHER_CATEGORY_ID`, `db/client.ts`).
- **Routine**: 라벨은 Todo 라벨 테이블을 공유한다(별도 라벨 테이블 없음). occurrence는 결정 키(`routineId:occurrenceDate`)로 멱등 생성한다. `toggleOccurrenceById`는 `RoutineRepository` 공개 인터페이스 밖의 추가 메서드로, Dashboard가 occurrence를 항목 단위로 토글할 때 쓴다.
- **Inbox**: 승인(`approve`)은 대상 경계(Todo/Calendar/Scrap/Ledger) 테이블에 직접 쓴다. Scrap 승인은 kind(image/video/url/text)·mediaId를 다뤄야 해서 `ScrapRepository.create`(텍스트·URL 전용)를 거치지 않는다. 라벨/분류가 비어 있으면 명확한 오류를 던진다.
- **Dashboard**: 다른 5경계 저장소 인스턴스를 조합해 read-model을 파생한다. 자체 상태는 최근 캡처 로그(`dashboard_captures`)뿐이다. `capture()`는 활성 AI provider로 분류를 시도하고, 실패하면 provider가 던진 실제 원인을 수집함 항목의 "원인" 필드에 남긴다(하드코딩된 문구로 뭉개지 않는다).
- **AI 설정**: `/ai/keys/:provider`(GET/POST/DELETE), `/ai/keys/:provider/test`, `/ai/provider`로 provider별 키와 활성 provider를 다룬다. provider 추가는 `secret-store.ts`·`routes/ai.ts` 양쪽의 `AiProviderId` 유니온과 관련 매핑 몇 곳만 늘리면 된다(파라미터화돼 있다).
- `fields`/`images`/`videos`(Inbox), `days`(Routine)는 조회 쿼리 대상이 아닌 소량 구조화 payload라 JSON 텍스트 컬럼에 둔다. 정규화는 필요해지면 승격한다.

## 패키징

데스크톱 exe는 이 서버를 별도 설치 없이 자식 프로세스로 띄운다 — `scripts/build-sidecar.mjs`가 esbuild로 `dist/server.cjs` 단일 파일을 만들고(better-sqlite3만 네이티브 addon이라 external), 루트의 `scripts/build-api-sidecar.ps1`이 Node 런타임과 함께 데스크톱 exe 옆 `sidecar/` 폴더로 묶는다. 자세한 내용은 루트 [README.md](../../README.md)의 "패키징" 절과 `apps/desktop/src-tauri/src/api_sidecar.rs`.

## 다음

- 스키마가 안정되면 idempotent DDL을 drizzle-kit 마이그레이션으로 승격한다.
- 파일 저장소(`FileStore`, 로컬 디스크)는 아직 없다 — Scrap의 `mediaId`는 이 PC의 Tauri 미디어 저장소만 가리키고, 서버에는 바이트가 없다(§4 위반 상태 — iOS 붙이면 미디어가 안 보인다).
- 백업 보존 정책은 아직 없다(§9 "아직 결정하지 않은 사항").
