#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  echo "bootstrap failed: $*" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || die "must run as root"
[[ "$#" -eq 1 ]] || die "usage: bootstrap-mono-deploy.sh <deployment-public-key-file>"

public_key_file="$(realpath -e -- "$1")"
[[ -f "$public_key_file" ]] || die "public key file not found"
[[ "$(wc -l < "$public_key_file")" -eq 1 ]] || die "public key file must contain exactly one key"
public_key="$(<"$public_key_file")"
[[ "$public_key" == ssh-ed25519\ * ]] || die "only an Ed25519 public key is accepted"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
deploy_dir="$(cd -- "$script_dir/.." && pwd)"

if ! id mono-deploy >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/mono-deploy --shell /bin/bash mono-deploy
fi
passwd --lock mono-deploy >/dev/null

install -d -o mono-deploy -g mono-deploy -m 0700 /home/mono-deploy/.ssh /var/tmp/mono-deploy
printf 'restrict %s\n' "$public_key" > /home/mono-deploy/.ssh/authorized_keys
chown mono-deploy:mono-deploy /home/mono-deploy/.ssh/authorized_keys
chmod 0600 /home/mono-deploy/.ssh/authorized_keys

# 오프사이트 백업 푸시에 rclone 필요(mono-api-backup.service의 ExecStartPost).
# ponytail: apt로 설치. Debian/Ubuntu 가정 — 다른 배포판이면 수동 설치 후 재실행.
if ! command -v rclone >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq rclone || die "rclone install failed; install it manually and rerun"
fi

install -o root -g root -m 0755 "$script_dir/deploy-mono-api" /usr/local/sbin/deploy-mono-api
for unit in mono-api.service mono-api-backup.service mono-api-backup.timer; do
  install -o root -g root -m 0644 "$deploy_dir/systemd/$unit" "/etc/systemd/system/$unit"
done

sudoers_tmp="$(mktemp)"
trap 'rm -f -- "$sudoers_tmp"' EXIT
printf '%s\n' 'mono-deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy-mono-api' > "$sudoers_tmp"
chmod 0440 "$sudoers_tmp"
visudo -cf "$sudoers_tmp" >/dev/null
install -o root -g root -m 0440 "$sudoers_tmp" /etc/sudoers.d/mono-deploy

systemctl daemon-reload
systemctl enable mono-api.service mono-api-backup.timer >/dev/null

echo "Deployment identity installed. Existing data, environment, binary, and running service were not changed."
