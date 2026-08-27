# Mono Platform

개인 관리 플랫폼의 PC 데스크톱 앱이다. 현재 구현 대상은 Windows·macOS와 Tauri 2다.

## 개발 명령

API 서버는 Tauri 바이너리에 임베드된 Rust axum 서버다(`apps/desktop/src-tauri/src/api`,
127.0.0.1:4174). 별도로 띄울 것이 없다.

```powershell
npm install
npm run desktop:dev
```

## 검증 명령

```powershell
npm run typecheck
npm test                                     # 프론트 vitest
npm run build
cd apps/desktop/src-tauri; cargo test --lib  # 임베드 API 서버 유닛 테스트
npm run desktop:build
```

## 패키징

`npm run desktop:build` 결과물은 `release/mono-desktop.exe` 하나다. API 서버가 바이너리에
임베드돼 있어 별도 런타임·사이드카가 없다 — 이 파일만 옮기면 된다.

## 문서

- [아키텍처 결정](.refs/architecture-decisions.md)
- [PC 데스크톱 구현 인계](.refs/desktop-implementation-handoff.md)
- [API 서버 Rust 이관](.refs/rust-api-porting.md)
