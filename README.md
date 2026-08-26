# Mono Platform

개인 관리 플랫폼의 PC 데스크톱 앱이다. 현재 구현 대상은 Windows와 Tauri 2다.

## 개발 명령

```powershell
npm install
npm run desktop:dev
```

## 검증 명령

```powershell
npm run typecheck
npm test
npm run build
npm run desktop:build
```

## 패키징

`npm run desktop:build` 결과물은 `release/mono-desktop.exe`와 그 옆의 `release/sidecar/`
(Node 런타임 + 번들된 API 서버) 두 개다. `mono-desktop.exe`는 실행 시 같은 폴더의
`sidecar/node.exe`를 자식 프로세스로 띄워 API를 자동으로 연다 — 이 PC에 Node가 따로
없어도 뜬다. **옮기거나 배포할 때 `sidecar/` 폴더를 반드시 exe와 함께 옮긴다.**

## 문서

- [아키텍처 결정](.refs/architecture-decisions.md)
- [PC 데스크톱 구현 인계](.refs/desktop-implementation-handoff.md)
- [디자인 인계 안내](.designs/README.md)
