#!/usr/bin/env bash
set -euo pipefail

test "$(bash scripts/release-version.sh v1.2)" = v1.2.0
test "$(bash scripts/release-version.sh v26.11.5)" = v26.11.5
for tag in v1 v1.2.3.4 v1.2-rc1 v01.2 1.2.3; do
    if bash scripts/release-version.sh "$tag"; then exit 1; fi
done

test "$(bash scripts/image-tag.sh develop)" = develop
test "$(bash scripts/image-tag.sh feature/admin)" = feature-admin
test "$(bash scripts/image-tag.sh feature/admin release-candidate)" = release-candidate
test "$(bash scripts/image-tag.sh main)" = main
test "$(bash scripts/image-tag.sh foo/bar/Baz)" = foo-bar-Baz
long="$(printf '%0130d' 0 | tr 0 a)"
test "$(bash scripts/image-tag.sh "$long" | wc -c)" = 129
for tag in latest Latest v26.11.5 26.11.5 v1.2 'a/b' 'a b' '-bad' '.bad' "$long" $'good\nbad'; do
    if bash scripts/image-tag.sh develop "$tag"; then exit 1; fi
done
if bash scripts/image-tag.sh ""; then exit 1; fi
echo "Tag tests passed."
