#!/usr/bin/env bash
# 버전 올림 → 커밋 → main 푸시 → v태그 푸시. 이후는 CI(ci.yml, v* 트리거)가 전부 함.
# 사용법: npm run release -- X.Y.Z
# 전제: 코드 변경은 이미 커밋됨, 작업 트리 clean, 브랜치 main.
set -euo pipefail

version="${1:?사용법: npm run release -- X.Y.Z}"

[ -z "$(git status --porcelain)" ] || { echo "작업 트리가 dirty하다 — 코드 변경 먼저 커밋해라." >&2; exit 1; }
[ "$(git branch --show-current)" = "main" ] || { echo "main 브랜치가 아니다." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "태그 v$version 가 이미 있다." >&2; exit 1; }

npm run version:set -- "$version"
git commit -am "chore(release): bump version to $version"
git push origin main
git tag "v$version"
git push origin "v$version"

echo "v$version 푸시 완료. CI가 번들·서버 배포·릴리즈 공개를 진행한다."
