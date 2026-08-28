# 데스크톱 Release

GitHub Release는 Windows·macOS 설치 파일과 안정 버전 보관용이다. 서버 배포는 별도
`Deploy server` workflow가 담당하며 Release asset을 서버에 배포하지 않는다.

## v0.1.2 준비 상태

- npm workspace, Tauri, Rust crate 버전: `0.1.2`
- Windows: NSIS `*-setup.exe`
- macOS: Apple Silicon `.dmg`
- macOS 서명: ad-hoc
- Apple Developer ID 서명·공증: 없음
- Intel Mac: 미지원
- 데스크톱 자동 업데이트: 없음

`CI` workflow는 `v*` tag에서 Windows와 macOS bundle을 만든다. 각 runner는 파일이 없으면
실패한다. 별도 publish job이 두 artifact를 받은 뒤 draft Release에 한 번에 첨부하고,
`verify-release-assets`가 NSIS 1개와 DMG 1개가 있는지 검사한다. macOS bundle runner는 공식
ARM64 label인 `macos-26`으로 고정했다.

Runner 근거: [GitHub Actions runner images](https://github.com/actions/runner-images)

## 게시 절차

1. 버전 변경 커밋을 main에 반영한다.
2. main의 `CI`가 성공했는지 확인한다.
3. 로컬 tag `v0.1.2`를 만들고 push한다.
4. tag CI의 `bundle` 두 job과 `verify-release-assets` 성공을 확인한다.
5. draft Release에서 파일명, 버전, 다운로드를 확인한다.
6. 릴리스 노트와 macOS 제한을 검토한 뒤 draft를 게시한다.

tag push, draft 게시, 실제 asset 다운로드 검증은 GitHub 외부 상태를 바꾼다. 사용자 확인 전에는
수행하지 않는다. `workflow_dispatch`로 `CI`를 실행하면 bundle artifact만 만들며 Release에는
첨부하지 않는다.

권장 v0.1.2 릴리스 노트 요약:

- 여러 데스크톱이 Tailscale 전용 VPS API와 SQLite 데이터를 공유하는 원격 서버 모드
- 서버 백업과 재부팅 시 Tailscale 초기화 지연 재시도
- Windows NSIS와 Apple Silicon macOS DMG
- macOS는 ad-hoc 서명, 미공증, Intel 미지원
- 오프라인 동기화와 자동 업데이트 없음
