# Mono Platform

개인 관리 플랫폼의 PC 데스크톱 앱이다. 현재 구현 대상은 Windows·macOS와 Tauri 2다.

## 개발 명령

API 서버는 별도 크레이트(`crates/mono-api`)의 Rust axum 서버다. 데스크톱은 이를 임베드해
(`mono_api::spawn`, 127.0.0.1:4174) 실행하므로 별도로 띄울 것이 없다. 같은 서버를
standalone으로 돌려(`cargo run -p mono-api`) 여러 기기가 공유할 수도 있다 — `MONO_BIND_ADDR`
`MONO_DB_PATH` `MONO_SECRET_KEY_PATH` `MONO_CORS_ORIGINS` env로 설정하고, 데스크톱은
앱 데이터 디렉터리의 `server.json` 또는 실행 환경의 `MONO_API_BASE_URL`로 그 주소를 가리킨다.

```powershell
npm install
npm run desktop:dev
```

## 검증 명령

```powershell
npm run typecheck
npm test                                     # 프론트 vitest
npm run build
cargo test --lib -p mono-api                  # API 서버 유닛 테스트
npm run desktop:build
```

## 패키징

`npm run desktop:build` 결과물은 `release/mono-desktop.exe` 하나다. API 서버가 바이너리에
임베드돼 있어 별도 런타임·사이드카가 없다 — 이 파일만 옮기면 된다.

## 문서

- [아키텍처 결정](.refs/architecture-decisions.md)
- [PC 데스크톱 구현 인계](.refs/desktop-implementation-handoff.md)
- [API 서버 Rust 이관](.refs/rust-api-porting.md)
- [원격 서버 배포와 백업](.refs/server-deployment.md)
- [데스크톱 Release](.refs/desktop-release.md)
