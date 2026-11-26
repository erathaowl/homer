#!/usr/bin/env bash
set -euo pipefail

image="${1:?Docker image required}"
name="homer-smoke-$$"
cleanup() {
    docker logs "$name" 2>/dev/null || true
    docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for enabled in 1 0; do
    docker run -d --name "$name" -p 127.0.0.1::8080 \
        -e ADMIN_ENABLED="$enabled" -e ADMIN_USERNAME=test \
        -e ADMIN_PASSWORD=ci-only "$image"
    address="$(docker port "$name" 8080/tcp | head -n1)"
    origin="http://$address"
    curl --retry 20 --retry-all-errors --retry-delay 1 --fail --silent "$origin/" -o /dev/null
    node scripts/smoke-admin.mjs "$origin" "$enabled"
    cleanup
done
trap - EXIT
