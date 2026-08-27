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
| `9881bd8` | inbox | `src/api/inbox.rs`, `src/api/ledger.rs` (create_expense 노출) |
| `bbdb8f6` | dashboard (snapshot + toggleTask, capture 제외) | `src/api/dashboard.rs`, `src/api/todo.rs` (toggle_complete 노출) |
| `b0b8908` | secret-store + crypto (AI 키 · R2 자격증명 CRUD) | `src/api/secret.rs`, `mod.rs`, `lib.rs`, `Cargo.toml` |
| `c8a9bde` | R2 media store (`/media/*` 전부) | `src/api/media.rs`, `src/api/secret.rs` (get_r2_config 노출), `Cargo.toml` |
| `7c8a493` | AI capture-analysis (`/dashboard/capture` + `/ai/keys/{p}/test`) | `src/api/ai.rs`, `src/api/dashboard.rs`, `src/api/secret.rs` (get_api_key·get_active_provider 노출) |
| (this) | link-preview (`/link-previews/image`) — **모든 경계 포팅 완료** | `src/api/link_preview.rs`, `mod.rs` |

`cargo test --lib` 117개 통과. `cargo build --release` 클린. JS 스위트 무변경(api 142 / desktop 147).

**모든 라우트 네이티브.** proxy는 fallback으로 아직 배선돼 있지만 도달 불가 — 다음은 cutover.

link-preview 노트:
- `scraper` 크레이트 안 씀 — `<meta>` 태그 스캔 + 속성 토크나이저 + HTML 엔티티 디코더 손수.
- SSRF 방어 `isPrivateAddress` 로직 그대로 이식(IPv4 0/10/127/100.64/169.254/172.16-31/192.168/
  198.18-19/224+, IPv6 loopback·unspecified·ULA fc/fd·link-local fe80-febf·v4-mapped 재귀).
- DNS는 `tokio::net::lookup_host`, 검증된 첫 주소로 `reqwest::Client::resolve` pin. 리디렉션은
  `Policy::none()` + 수동 루프(≤4), 매 홉 호스트 재검증. 응답은 `Response::chunk()`로 스트리밍
  누적하며 상한(HTML 2MB / 이미지 10MB) 검사(`bytes()` 버퍼링 회피).
- 30분 TTL · 32개 FIFO 캐시는 `Arc<Mutex<Vec<..>>>`(라우터 state). 음수 캐시(None)도 저장.
- **실제 HTTP 왕복 in-repo 검증 없음** — SSRF 판정·URL 검증·메타 파싱·엔티티 디코드만 유닛 테스트.

ai 노트:
- capture-analysis-prompt/validation + openai/gemini provider + selectable dispatch를 `ai.rs`로.
  프롬프트 문자열·모델(gpt-5-nano / gemini-2.5-flash-lite)·엔드포인트·gemini responseJsonSchema
  전부 Node 그대로. reqwest는 `json` feature 없어 `.body(payload.to_string())` + content-type 헤더 수동.
- `analyze`/`test_connection`은 `Result<_, String>` — capture는 실패를 삼켜 inbox `status:"failed"`
  (`fields:[{원인, msg}]`)로 저장하고 201 반환. `/ai/keys/{p}/test`는 실패를 400으로.
- dashboard `routes`가 이제 `SecretState`를 받음(capture가 활성 provider·API 키·context 필요).
  snapshot/toggle 핸들러도 `state.db` 사용.
- **AI 실제 HTTP 왕복은 in-repo 검증 없음** — JS도 fetch 목킹. 프롬프트 빌드·응답 파싱·검증·
  capture 실패/영상 경로만 유닛 테스트(11 + 3).
- `SelectableCaptureAnalysisProvider`(호출 시점 active provider 재조회)는 capture 안에서
  `secret::get_active_provider` + `secret::get_api_key`로 인라인.

media 노트:
- aws-sdk 대신 SigV4 손수 서명(`hmac`+`sha2`) + `reqwest`. 6개 op만: put/get/delete/head-bucket/list.
  서명은 AWS 문서 "GET Object" 벡터로 유닛 테스트(canonical request + signing key 전체 검증).
- 배치 DeleteObjects 안 씀 — 개별 DELETE 루프(GC는 드묾, Content-MD5/XML 회피).
- ListObjectsV2 페이지네이션 미구현(페이지당 1000, 미디어 수가 그보다 적음). XML은 손수 태그 추출.
- `/media` 멀티파트는 axum `multipart` feature. R2 자격증명은 `secret::get_r2_config`로 복호화.
- **R2 왕복 자체는 in-repo 검증 없음** — JS도 S3 SDK를 목킹해 실제 HTTP는 안 침. 서명·파싱·참조계산만 테스트.
- `SecretState { db, crypto }`를 secret·media 두 라우터가 공유(`build_router`에서 clone).

secret 노트:
- `secret-crypto.ts` 이식: AES-256-GCM, `iv:tag:ciphertext` 전부 hex(`aes-gcm` + `getrandom`
  크레이트, hex는 손수). Node `cipher.encrypt`는 `ct||tag` 반환 → `split_off(len-16)`으로 tag 분리.
- 마스터 키: `SecretCrypto::load_or_create(path)`. `api::spawn`에 `secret_key_path` 인자 추가,
  lib.rs가 sidecar와 **동일 경로**(`data_dir/mono.secret.key`) 전달 — 두 프로세스가 같은 암호문을
  읽어야 하므로. dev는 원래 DB·키 경로 정합이 안 맞음(Node `npm run dev`는 cwd 상대 경로) — E2E 시 주의.
- `build_router(db, crypto)` 시그니처 변경. `SecretState { db, crypto: Arc<SecretCrypto> }` axum State.
- active provider("active_ai_provider")는 평문 저장(Node와 동일), API 키·R2는 암호문.
- `getApiKey`(복호화)는 AI provider가 쓰는데 그건 아직 프록시 → `decrypt`에 `#[allow(dead_code)]`.
- `/ai/keys/{p}/test`, `/media/credentials/test`는 reqwest/S3 연결 확인이라 AI·media 경계로 미룸.

dashboard 노트:
- read-model 조합. sibling `get_snapshot` 안 부름 — todo.rs get_snapshot이 이제 occurrence를
  merge하므로 dashboard가 그걸 쓰면 routineTasks가 중복됨. `todo_items` 테이블 직접 쿼리(최근 2),
  routineTasks는 `routine::today_todo_rows` 재사용.
- `toggle_handler`는 `todo::toggle_complete` 그대로 재사용(occurrence→todo 위임 시맨틱 동일).
- `capture`는 analysisProvider(OpenAI/Gemini) 호출이라 AI 경계 포팅 후 네이티브로. 그때까지 프록시.
  → cutover는 AI 경계까지 끝나야 가능(dashboard capture가 마지막 프록시 의존).

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
- **dashboard** — ✅ snapshot + toggleTask 완료. `POST /dashboard/capture`만 프록시(AI 얽힘).
  위 "dashboard 노트" 참고.

### 2. 인프라 청크

- **secret-store + secret-crypto** — ✅ 완료. 위 "secret 노트" 참고.
- **R2 media store** — ✅ 완료. 위 "media 노트" 참고.
- **AI capture-analysis** — ✅ 완료. 위 "ai 노트" 참고.
- **link-preview** — ✅ 완료. 위 "link-preview 노트" 참고.

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
