# 원격 서버 배포와 백업

`mono-api`는 개인용 단일 사용자 서버다. 앱 레벨 인증이 없으므로 공인 인터넷에 직접 노출하지
않고 Tailscale/WireGuard 사설망에서만 접근시킨다.

## 1. 서버 빌드와 상태 파일

Linux 서버와 같은 아키텍처의 환경에서 빌드한다.

```bash
cargo build --release -p mono-api
```

서버를 구성하는 상태 파일은 둘이다.

- `mono.sqlite`: 일정, 할 일, 가계부, 설정과 암호화된 자격증명
- `mono.secret.key`: 자격증명 복호화 마스터 키

둘 중 하나만 백업하거나 복원하면 AI/R2 자격증명을 복호화할 수 없다. R2의 미디어 원본은 이
백업에 포함되지 않으므로 R2 보존 정책은 별도로 관리한다.

## 2. systemd 배포

`deploy/systemd`의 파일을 다음 위치에 배치한다.

```text
/opt/mono/mono-api
/etc/mono/mono.env
/etc/systemd/system/mono-api.service
/etc/systemd/system/mono-api-backup.service
/etc/systemd/system/mono-api-backup.timer
```

전용 사용자와 디렉터리를 준비하고 `/etc/mono/mono.env`의 `MONO_BIND_ADDR`를 서버의 실제
Tailscale IP로 바꾼다. `0.0.0.0:4174`로 공인 NIC에 바인드하지 않는다.

```bash
sudo useradd --system --home /var/lib/mono --shell /usr/sbin/nologin mono
sudo install -d -o root -g root -m 755 /opt/mono
sudo install -d -o mono -g mono -m 700 /var/lib/mono /var/backups/mono
sudo install -d -o root -g mono -m 750 /etc/mono
sudo install -o root -g root -m 755 target/release/mono-api /opt/mono/mono-api
sudo install -o root -g mono -m 640 deploy/systemd/mono.env.example /etc/mono/mono.env
sudo install -o root -g root -m 644 deploy/systemd/mono-api.service /etc/systemd/system/
sudo install -o root -g root -m 644 deploy/systemd/mono-api-backup.service /etc/systemd/system/
sudo install -o root -g root -m 644 deploy/systemd/mono-api-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mono-api.service mono-api-backup.timer
```

확인은 Tailscale에 연결된 다른 기기에서 한다.

```bash
curl http://<tailscale-ip>:4174/health
```

## 3. 데스크톱 원격 모드

데스크톱은 시작 시 다음 순서로 API 주소를 결정한다.

1. `MONO_API_BASE_URL` 실행 환경변수
2. 앱 데이터 디렉터리의 `server.json`
3. 둘 다 없으면 기존 임베드 서버 `http://127.0.0.1:4174`

Windows 앱 데이터 디렉터리는 일반적으로
`%APPDATA%\com.mono.platform.desktop`, macOS는
`~/Library/Application Support/com.mono.platform.desktop`이다. 원격 모드는 해당 위치에 다음
파일을 만든 뒤 앱을 다시 시작한다.

```json
{
  "mode": "remote",
  "apiBaseUrl": "http://mono-server:4174"
}
```

`mono-server`는 Tailscale MagicDNS 이름 또는 Tailscale IP로 바꾼다. HTTP는 4174 포트만,
HTTPS는 443 또는 4174 포트만 허용한다. 원격 모드에서는 로컬 SQLite와 임베드 API 서버를
열지 않는다.

기존 로컬 데이터를 최초로 옮길 때는 데스크톱 앱을 완전히 종료한 뒤 앱 데이터 디렉터리의
`mono.sqlite`와 `mono.secret.key`를 서버의 `/var/lib/mono`로 함께 복사한다. 앱이 실행 중일 때
WAL 파일을 제외하고 `mono.sqlite`만 복사하면 최신 쓰기가 누락될 수 있다.

로컬 모드로 되돌릴 때는 `server.json`을 삭제하거나 다음 내용으로 바꾼다.

```json
{
  "mode": "embedded"
}
```

## 4. 백업과 복원

백업 명령은 실행 중인 SQLite에도 일관된 SQLite Online Backup API를 사용하고 완료 후
`PRAGMA integrity_check`를 수행한다. 다음 명령은 새 타임스탬프 디렉터리를 만들고 최신 14개만
보존한다.

```bash
sudo -u mono /opt/mono/mono-api backup /var/backups/mono --keep 14
```

각 백업에는 `mono.sqlite`, `mono.secret.key`, `manifest.json`이 들어간다. 같은 VPS 디스크의
백업만으로는 서버 장애나 계정 정지를 견딜 수 없으므로 이 디렉터리를 암호화해 별도 저장소로
복제한다.

복원할 때는 쓰기 경쟁을 피하려고 서버를 멈추고 두 상태 파일을 함께 교체한다.

```bash
sudo systemctl stop mono-api.service
sudo install -o mono -g mono -m 600 <backup>/mono.sqlite /var/lib/mono/mono.sqlite
sudo install -o mono -g mono -m 600 <backup>/mono.secret.key /var/lib/mono/mono.secret.key
sudo systemctl start mono-api.service
```
