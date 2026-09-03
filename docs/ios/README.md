# mono iOS — 구현 핸드오프

`mono-api` 서버(Rust/axum) 위에 올라가는 새 SwiftUI 클라이언트를 위한 핸드오프. 데스크톱(`apps/desktop`) 코드는 재사용하지 않는다 — 서버·API 계약·디자인 의도만 공유한다.

## 읽는 순서

1. **`HANDOFF-swiftui.md`** — IA, 내비게이션, 화면·컴포넌트 인벤토리, API 매핑, 상태 모델, 수용 기준 80+. 상단 "패치 이력"에 서버 실측 대조 결과(0.3.5 기준)가 있다.
2. **`HANDOFF-design-system.md`** — 색·타이포·여백·컴포넌트·모션·접근성 명세.
3. **`realtime-multi-device-sync.md`** — SSE `/events` 기반 멀티기기 동기화 설계(원본). HANDOFF §5-3이 이걸 iOS 관점으로 요약한다.
4. **`prototype/prototype.dc.html`** — HTML 목업(픽셀 레퍼런스). `prototype/`은 Claude Design 산출물이며 프로덕션 코드가 아니다. 시각 결과만 맞추고 내부 구조는 따르지 않는다.

## 스코프 확인

착수 전 `HANDOFF-swiftui.md` §5-1(서버 공백)·§8(남은 질문)을 사용자와 확인한다.

## 계약 동기화

API 모델은 `packages/contracts/src/index.ts`(zod)가 원천이다. 손으로 Swift 모델을 유지하지 말고 OpenAPI 생성을 쓴다 — `HANDOFF-swiftui.md` §5-2 참조.
