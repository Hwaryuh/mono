# 원격 서버 배포와 백업

`mono-api`는 앱 인증이 없는 개인용 서버다. API와 SSH 모두 공인 인터넷에 노출하지 않고
Tailscale 사설망에서만 접근한다. 운영 서버는 소스를 받거나 컴파일하지 않는다.

## 1. 운영 상태와 파일

- API: `http://100.89.224.115:4174`
- 실행 파일: `/opt/mono/mono-api`
- 환경 파일: `/etc/mono/mono.env`
- 데이터: `/var/lib/mono/mono.sqlite`, `/var/lib/mono/mono.secret.key`
- 백업: `/var/backups/mono`, 매일 03:30 UTC부터 최대 10분 지연, 최근 14개
- systemd: `mono-api.service`, `mono-api-backup.service`, `mono-api-backup.timer`

SQLite와 마스터 키는 반드시 함께 백업·복원한다. R2 미디어 원본은 이 백업에 포함되지 않는다.

## 2. 배포 구조

`.github/workflows/deploy-server.yml`의 `Deploy server`는 `workflow_dispatch` 전용이다.

1. 선택 ref가 `main`인지 확인한다.
2. 같은 커밋의 `CI` push 실행이 성공했는지 GitHub API로 확인한다.
3. GitHub-hosted Ubuntu 24.04에서 Linux x86_64 `mono-api`를 테스트·빌드한다.
4. 빌드 결과와 SHA-256을 30일 보존 Actions artifact로 남긴다.
5. 공식 `tailscale/github-action@v4`와 GitHub OIDC로 임시 Tailscale 노드를 만든다.
6. 전용 `mono-deploy` SSH 키로 바이너리와 systemd 기준 파일을 staging에 올린다.
7. VPS의 root 소유 배포 helper가 백업, 원자적 교체, `daemon-reload`, 재시작, `/health` 검사를 한다.
8. 실패하면 이전 바이너리를 원자적으로 복원하고 다시 `/health`를 검사한다.

동시 배포는 GitHub concurrency와 VPS `flock`으로 이중 차단한다. self-hosted runner, Lightsail 기본
키, 공인 SSH, 공인 API 포트는 사용하지 않는다. 빌드 job은 production environment와 OIDC 권한을
받지 않는다. 별도 deploy job만 검증된 artifact와 배포 자격증명을 받는다. Tailscale Action은
검증한 v4.1.3 전체 commit SHA로 고정했다.

Tailscale SSH는 이번 구조에서 쓰지 않는다. 활성화하면 Tailscale IP의 22번 연결을 Tailscale SSH가
가로채 현재 OpenSSH 접속 정책까지 바뀐다. 전용 OpenSSH 키와 제한된 sudo helper가 기존 접속을
보존하면서도 권한 범위를 더 명확히 제한한다.

## 3. Tailscale 최소 권한 설정

기존 tailnet 정책에 `deploy/tailscale-policy.example.hujson`의 항목을 병합한다. 기존의 `* -> *`
또는 `tag:github-deploy -> *` 허용 규칙이 있으면 아래 제한은 무효다. grants는 우선순위로 거부하지
않고 모든 허용을 합친다.

- 실행 노드 태그: `tag:github-deploy`
- 도착지: `100.89.224.115`
- 허용 포트: TCP 22만
- 서버 장치 태그 변경: 없음
- 공인 Lightsail 방화벽 변경: 없음

Tailscale Admin Console의 **Trust credentials > Credential > OpenID Connect**에서 federated
identity를 만든다.

- Issuer: GitHub Actions
- Subject: `*`
- Custom claim `repository`: `Hwaryuh/mono`
- Custom claim `environment`: `server-production`
- Custom claim `ref`: `refs/heads/main`
- Custom claim `workflow_ref`: `Hwaryuh/mono/.github/workflows/deploy-server.yml@refs/heads/main`
- Scope: **Auth Keys > Write**만
- Tag: `tag:github-deploy`

Subject를 `*`로 두는 이유는 2026-07-15 이후 생성되거나 opt-in한 GitHub 저장소의 OIDC subject에
immutable owner/repository ID가 들어가기 때문이다. 대신 위 네 custom claim을 모두 정확히
일치시켜 저장소, 환경, branch, workflow를 고정한다. Client ID와 Audience는 비밀값이 아니지만
공식 Action 예시대로 GitHub Environment secret에 보관한다.

공식 근거:

- [Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action)
- [Tailscale workload identity federation](https://tailscale.com/docs/features/workload-identity-federation)
- [Tailscale grants 문법](https://tailscale.com/docs/reference/syntax/grants)
- [GitHub OIDC subject](https://docs.github.com/en/actions/reference/security/oidc)
- [GitHub Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

## 4. GitHub Environment 설정

Repository **Settings > Environments**에서 `server-production`을 만든다. Deployment branches는
Selected branches and tags의 `main`만 허용한다. `workflow_dispatch` 자체가 배포 버튼이므로 한 번
누르는 흐름을 원하면 required reviewer를 추가하지 않는다.

Environment secrets:

- `TS_OAUTH_CLIENT_ID`: Tailscale federated identity Client ID
- `TS_AUDIENCE`: 같은 identity의 Audience
- `MONO_DEPLOY_SSH_PRIVATE_KEY`: 새 Ed25519 전용 키의 private key 전체

Environment variables:

- `MONO_SERVER_HOST`: `100.89.224.115`
- `MONO_SERVER_USER`: `mono-deploy`
- `MONO_SERVER_SSH_HOST_KEY`: VPS의 `ssh-ed25519 AAAA...` host public key 부분

실제 비밀값은 이 문서, 커밋, 채팅에 넣지 않는다. host key는 공개 정보지만 반드시 현재 신뢰된
`ssh mono-server` 연결에서 `/etc/ssh/ssh_host_ed25519_key.pub`를 읽어 등록한다. 실행 중
`ssh-keyscan`으로 즉석 신뢰하지 않는다.

전용 키와 workflow는 root shell을 얻지는 못하지만 `mono` 사용자로 실행될 바이너리를 교체한다.
따라서 운영 SQLite와 마스터 키를 읽고 바꿀 수 있는 data-plane 권한이다. Secret 노출 시 즉시 키를
교체하고 Tailscale federated identity를 폐기한다.

## 5. VPS 1회 bootstrap

이 단계만 현재 관리자 접속 `ssh mono-server`로 수행한다. 기존 `mono` 사용자, 데이터, 환경 파일,
실행 바이너리를 만들거나 교체하지 않는다. `mono-deploy` 사용자, 전용 public key, 고정 sudo helper,
검토된 systemd unit만 설치한다. helper는 배포 payload의 unit을 root로 설치하지 않고 설치본과
비교한다. unit이 바뀐 커밋은 bootstrap을 다시 검토·실행하기 전까지 안전하게 배포 실패한다.

Windows에서 키를 생성한다.

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\mono-github-deploy" -C "github-actions-mono-deploy"
scp -r deploy mono-server:/tmp/mono-deploy-bootstrap
scp "$env:USERPROFILE\.ssh\mono-github-deploy.pub" mono-server:/tmp/mono-github-deploy.pub
ssh mono-server "sudo bash /tmp/mono-deploy-bootstrap/scripts/bootstrap-mono-deploy.sh /tmp/mono-github-deploy.pub"
```

private key는 `MONO_DEPLOY_SSH_PRIVATE_KEY`에 직접 등록한다. 기본 Lightsail 키는 등록하지 않는다.
bootstrap 재실행은 `mono-deploy` authorized key와 systemd unit을 현재 입력으로 교체하므로 반드시
diff 검토 후 수행한다. 이 단계는 외부 서버 상태 변경이므로 실행 전 사용자 확인이 필요하다.

## 6. 수동 배포와 확인

GitHub Actions에서 **Deploy server > Run workflow > main > Run workflow**를 누른다. 다른 branch,
CI 미통과 커밋, systemd drift, 백업 실패, checksum 불일치, health 실패는 배포를 중단한다.

성공 후 별도 확인:

```powershell
ssh mono-server "systemctl is-active mono-api.service"
ssh mono-server "curl --fail http://100.89.224.115:4174/health"
```

배포 실패 시 Actions 로그와 다음 로그를 확인한다.

```powershell
ssh mono-server "sudo journalctl -u mono-api.service -n 100 --no-pager"
```

## 7. 데스크톱 원격 모드

데스크톱은 `MONO_API_BASE_URL`, 앱 데이터 디렉터리의 `server.json`, 로컬 임베드 서버 순서로
API 주소를 결정한다. 원격 모드에서는 로컬 SQLite와 임베드 API 서버를 열지 않는다.

```json
{
  "mode": "remote",
  "apiBaseUrl": "http://100.89.224.115:4174"
}
```

Windows 파일 위치:

```text
%APPDATA%\com.mono.platform.desktop\server.json
```

macOS 사용 절차:

1. Mac에 Tailscale을 설치하고 VPS와 같은 tailnet 계정으로 로그인한다.
2. DMG에서 앱을 Applications로 복사한다.
3. `~/Library/Application Support/com.mono.platform.desktop/server.json`을 위 내용으로 만든다.
4. 앱을 다시 시작하고 VPS 연결을 확인한다.

Windows와 Mac은 같은 VPS SQLite를 원본으로 사용하므로 같은 데이터를 본다. 로컬 변경을 나중에
합치는 오프라인 동기화 기능은 없다. Tailscale 또는 VPS 연결이 끊기면 원격 데이터 기능도
동작하지 않는다.

현재 macOS DMG는 Apple Silicon 전용, ad-hoc 서명이다. Apple Developer ID 서명·공증이 없어서
Gatekeeper가 실행을 막을 수 있다. Intel Mac은 지원하지 않는다. Gatekeeper 전체 비활성화는
권장하지 않는다. 허용 가능한 개인 기기라면 Finder의 컨텍스트 메뉴 **열기**로 개별 승인한다.

`server.json` 직접 편집은 임시 운영 방식이다. 앱 내부 서버 연결 설정·연결 테스트·embedded 복귀
화면은 별도 후속 작업으로 구현한다. 이번 배포 자동화 범위에는 넣지 않는다.

## 8. 백업과 복원

배포 직전과 매일 timer 백업은 SQLite Online Backup API와 `PRAGMA integrity_check`를 사용한다.

```bash
sudo -u mono /opt/mono/mono-api backup /var/backups/mono --keep 14
```

복원은 서비스 중지 후 SQLite와 마스터 키를 함께 교체한다.

```bash
sudo systemctl stop mono-api.service
sudo install -o mono -g mono -m 600 <backup>/mono.sqlite /var/lib/mono/mono.sqlite
sudo install -o mono -g mono -m 600 <backup>/mono.secret.key /var/lib/mono/mono.secret.key
sudo systemctl start mono-api.service
```

같은 VPS 디스크의 백업은 서버 장애나 계정 정지를 견디지 못한다. 암호화된 외부 복제는 별도
후속 작업이다.
