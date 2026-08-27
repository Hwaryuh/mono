# Rust API 포팅 (Option C) — 진행 상황 · 핸드오프

## 목표

데스크톱(Tauri v2)의 Node/Fastify API(`apps/api`)를 Tauri 바이너리에 임베드된 axum
서버로 재작성한다. 완료되면 sidecar zip · PowerShell 빌드 스크립트가 사라지고
`tauri build`가 Windows·macOS 양쪽에서 단일 바이너리를 만든다.

배경: 현재 release는 Node 런타임 + 번들 API를 zip으로 exe에 임베드해 첫 실행 때 풀어
자식 프로세스로 띄운다(`apps/desktop/src-tauri/src/api_sidecar.rs`). 이 구조라 macOS
빌드 불가(OS별 node·better-sqlite3 바이너리, PS 스크립트).

전송 방식 결정: **임베드 axum HTTP 유지**. 프론트 `http-client.ts` + 13개
`http-*-repository.ts` 무변경. 계약 경계 불변.

## 마이그레이션 하네스 (리버스 프록시)

이관 중 Rust와 Node 공존:

- Rust axum → `127.0.0.1:4174` (프론트가 항상 여기로, `VITE_API_BASE_URL` 기본값)
- Node sidecar → `127.0.0.1:4175` (내부 업스트림)
- Rust는 포팅된 라우트는 네이티브 처리, 나머지는 `src/api/proxy.rs`가 4175로 reqwest 패스스루
- 같은 `mono.sqlite` 파일을 둘 다 연다 (WAL, 로컬 단일 사용자라 경합 무시)

경계 하나 포팅 = `mod.rs`에서 `.merge()` 추가 → 그 라우트가 프록시 대신 네이티브로.
마지막 경계 넘어가면 프록시·sidecar·zip·PS 스크립트·`apps/api` 통째로 삭제 (cutover).

포트 배선: `api_sidecar.rs` `.env("PORT", "4175")`, `apps/api/src/main.ts` 기본값 4175.
dev도 동일 — `npm run dev -w @mono/api`가 4175, `npm run desktop:dev`의 Rust가 4174.

## 완료 (커밋)

| 커밋 | 경계 | 파일 |
|---|---|---|
| `8e90933` | Phase 0 토대 + todo | `src/api/{mod,db,error,color,proxy,todo}.rs` |
| `051400e` | ledger | `src/api/ledger.rs` |
| `462c408` | calendar | `src/api/calendar.rs` |
| `34ca935` | scrap | `src/api/scrap.rs` |
| `f8500d9` | routine (+ todo read-model join) | `src/api/routine.rs`, `src/api/todo.rs` |
| (this) | inbox | `src/api/inbox.rs`, `src/api/ledger.rs` (create_expense 노출) |

`cargo test --lib` 72개 통과. `cargo build --release` 클린. JS 스위트 무변경(api 142 / desktop 147).

네이티브 처리 중: `/todo/*` `/ledger/*` `/calendar/*` `/scrap/*` `/routine/*` `/inbox/*`
프록시 중: `/dashboard/*` `/media/*` `/ai/*` `/media-credentials/*` `/link-previews/*`

inbox 노트:
- `SqliteInboxRepository`는 이제 순수 DB — analysisProvider 안 씀(리팩터로 빠짐). 캡처 분석 경로 없음.
- approve 시 대상 테이블(todo/calendar/ledger/scrap)에 sibling repo 우회하고 직접 INSERT.
  ledger만 `ledger::create_expense`(원화 정규화 재사용) 경유.
- 라벨/분류 매칭: `normalize_name`(공백 제거+소문자) 후 이름 비교 → fallback(work/hobby/other/첫 항목).
- 일시/마감 파싱: `/\d{4}-\d{2}-\d{2}/` `/\d{1,2}:\d{2}/`를 바이트 스캐너로 손수(정규식 크레이트 없음).
- JSON 컬럼(`fields_json`/`images_json`/`videos_json`)은 `serde_json::from_str` 수동 파싱.

routine 노트:
- occurrence는 결정 키 `routine-occurrence:{routineId}:{date}`로 멱등 생성. `is_scheduled`는
  ISO 날짜의 UTC 요일(chrono `weekday().num_days_from_sunday()`, JS `getUTCDay`와 동일)로 판정.
- `todo.rs get_snapshot`이 `routine::today_todo_rows`로 오늘 occurrence를 todo item처럼 맨 앞에
  join. `todo.rs toggle_complete`는 id가 occurrence면 `routine::toggle_occurrence_by_id`로 위임.
  `todo.rs delete_label` 트랜잭션이 `routine_items.label_id`도 대체 라벨로 이동(라벨 풀 공유).
  → Node `todo-repository.ts`는 이 join을 안 하지만 mock(`mock-routine-occurrences.ts`)은 함.
  Rust는 mock 동작에 맞췄다. 프록시 중인 Node dashboard도 같은 sqlite `routine_occurrences`를
  읽으므로 결정 키가 같아 정합.
- `toggle`의 `completedAt`은 Node와 동일하게 `now_iso()` (mock의 "방금" 아님).

## 토대 모듈

- `db.rs` — `Db = Arc<Mutex<Connection>>`. DDL·SEED는 `apps/api/src/db/client.ts`에서
  그대로 복사(idempotent). `open(path)` / `open_memory()` (테스트용).
- `error.rs` — `ApiError { NotFound→404 {error}, Validation→422 {error:[{message}]},
  BadRequest→400 {error}, Internal→400 }`. `apps/api/src/server.ts` setErrorHandler와 동일.
  `ApiResult<T>`, `ApiError::validation(msg)` 헬퍼.
- `color.rs` — `normalize_color_to_oklch` (`packages/domain/src/color.ts` 포팅). 라벨 색 검증.
- `proxy.rs` — catch-all `handler`, 4175로 패스스루. 바디 버퍼링(스트리밍 X, 128MB 한도).
- `mod.rs` — `spawn(db_path) -> JoinHandle`. 전용 std::thread + tokio multi-thread + axum.
  `build_router(db)` = boundary merge + `.fallback(proxy::handler)` +
  `DefaultBodyLimit::disable()` + CORS(server.ts origin 목록 동일). `#[cfg(test)]` 라우터 테스트.
- `lib.rs` — setup에서 `ApiSidecar::spawn(...)` 다음 `api::spawn(data_dir.join("mono.sqlite"))`.

## 새 경계 포팅 패턴 (todo.rs / ledger.rs 참고)

1. `apps/api/src/repositories/<b>-repository.ts` + `routes/<b>.ts` + contracts 스키마 + `<b>-repository.test.ts` 읽기.
2. `src/api/<b>.rs`:
   - **DTO** — `#[derive(Serialize/Deserialize)] #[serde(rename_all = "camelCase")]`.
     null 필드 `Option<String>`. 응답에서 seq/order_index 제외.
   - **검증** — 손수. zod 스키마의 trim/min/max/enum + 커스텀 메시지를 그대로.
     `ApiError::validation(...)`. 색은 `color::normalize_color_to_oklch`.
   - **저장소 로직** — TS repo 함수 1:1. `chrono::Local::now().date_naive().to_string()` = today,
     `chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)` = `new Date().toISOString()`.
     `uuid::Uuid::new_v4()`. `MAX(seq)+1`. 트랜잭션은 `conn.transaction()` (`&mut Connection` 필요).
   - **라우트** — `routes/<b>.ts` 경로 그대로. axum 0.8 path param `{id}`. 성공 `{"ok": true}`,
     생성 201.
   - **테스트** — `#[cfg(test)] mod tests`, `db::open_memory()`. TS 테스트 케이스 전부 이식.
3. `mod.rs` — `mod <b>;` + `.merge(<b>::routes(database.clone()))`.
4. 프록시 fallback 테스트(`mod.rs`)가 방금 포팅한 경로를 쓰고 있으면 아직 미포팅인 경로로 교체.
5. `cargo test --lib` + `cargo build --release` + 각 경계 독립 커밋.

## 함정

- raw string에 `#` 있으면 `r##"..."##` (예: hex 색 `#b03a55`).
- `serde_json::Value`를 rusqlite `params!`에 직접 넘기면 JSON 인코딩된 문자열로 저장됨
  (`"x"` 형태). 네이티브 타입(String, Option<String>, i64)으로 넘길 것. `serde_json` rusqlite
  feature 안 씀.
- `#[serde(rename_all = "camelCase")]` 빠뜨리면 body 파싱 실패. `{labelIds}` `{nextTag}`
  `{replacementCategoryId}` 등.
- 프록시 fallback 테스트는 항상 "아직 미포팅" 경로를 골라야 함.
- 검증 메시지는 이식 테스트가 직접 검사 안 하는 경우가 많음 — 구조(422/404/400)만 맞추면 됨.

## 남은 작업 (순서)

### 1. routine → inbox → dashboard (크로스 경계)

- **routine** — ✅ 완료. 위 "routine 노트" 참고.
- **inbox** — ✅ 완료. 위 "inbox 노트" 참고.
- **dashboard** — 모든 경계 집계(`dashboard-repository.ts`). todo/calendar/ledger/routine/scrap가
  전부 네이티브인 뒤에 마지막으로. `dashboard-repository.ts` 정독 필요 — routine occurrence를
  todo task로 병합(routine.rs `today_todo_rows` 재사용 가능), 월 지출 집계는 ledger 로직과 겹침.
  AI 분석 provider(`recentCaptures`?)도 확인. 다음 세션 목표.

### 2. 인프라 청크

- **secret-store + secret-crypto** — `aes-gcm` 크레이트. AES-256-GCM,
  `iv:tag:ciphertext` hex 포맷 (`apps/api/src/security/secret-crypto.ts`). 마스터 키 파일
  `mono.secret.key` (`MONO_SECRET_KEY_PATH`, `api::spawn`에 경로 인자 추가 필요).
  `/media-credentials` 라우트 + R2 자격증명 저장.
- **R2 media store** — `aws-sdk-s3` 또는 `rust-s3`/`object_store`. S3 호환.
  `/media` 라우트 (multipart 업로드, 스트림 다운로드). `r2-media-store.ts` +
  `media-reference-repository.ts`. 이거 넘어가면 proxy 바디 버퍼링 이슈 무의미해짐.
- **AI capture-analysis** — `reqwest`. OpenAI + Gemini provider
  (`openai-capture-analysis-provider.ts`, `gemini-capture-analysis-provider.ts`),
  프롬프트 빌드(`capture-analysis-prompt.ts`), 응답 검증(`capture-analysis-validation.ts`),
  provider 선택(`selectable-capture-analysis-provider.ts`). `/ai` 라우트.
- **link-preview** — `reqwest` + HTML 파싱(`scraper` 크레이트). OG 태그 추출 후 이미지 프록시
  (`link-preview-image-provider.ts`). `/link-previews/image` 라우트. CSP에 이미 4174 허용됨.

### 3. cutover

- 삭제: `src/api/proxy.rs`, `src/api_sidecar.rs`, `sidecar.zip`, `build.rs`의 zip 로직,
  `src/api/mod.rs`의 `include_bytes!`... (없음, sidecar.rs에 있음),
  `scripts/build-api-sidecar.ps1`, `scripts/export-desktop-release.ps1`의 sidecar 부분,
  `apps/api/` 통째로, `apps/desktop/package.json`의 sidecar 스크립트 참조.
- `lib.rs`에서 `ApiSidecar::spawn` 호출 제거.
- `tauri.conf.json` — macOS `bundle` 설정 추가 (`bundle.active: true`, targets, 아이콘).
- `.refs/architecture-decisions.md` §9 갱신 (API 서버가 이제 Rust 임베드).
- CI: GitHub Actions `windows-latest` + `macos-latest` 매트릭스로 `tauri build`.

## 검증 명령

```
cd apps/desktop/src-tauri && cargo test --lib          # Rust 유닛 테스트
cd apps/desktop/src-tauri && cargo build --release     # 릴리스 빌드
cd apps/api && npx vitest run                          # 참조 API 무변경 확인 (142)
cd apps/desktop && npx vitest run                      # 프론트 무변경 확인 (147)
```

E2E (네이티브 창): `npm run dev -w @mono/api` (4175) + `npm run desktop:dev`.
포팅한 화면이 Rust에서, 나머지가 프록시로 정상 동작하는지 + `netstat`으로 4174·4175 LISTEN.

## 참고

- 상세 계획: `C:\Users\imabo\.claude\plans\mossy-crafting-piglet.md`
- 프론트는 절대 안 건드림 — 계약 경계가 하네스의 핵심.
