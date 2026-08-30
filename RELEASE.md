# 릴리즈 정책

- 제품 버전의 단일 원본은 루트 `Cargo.toml`의 `[workspace.package].version`이다. 변경은 `npm run version:set -- X.Y.Z`로 한다.
- `v*` 태그를 푸시하면 CI가 검사 → 번들 생성 → 초안 자산 검증 → 동일 SHA 서버 배포 → 서버 버전 검증 → 클라이언트 릴리즈 공개 순서를 강제한다.
- 공개 릴리즈는 최신 5개만 유지한다. 오래된 릴리즈와 자산은 삭제하지만 Git 태그와 GitHub Deployments 기록은 보존한다.
