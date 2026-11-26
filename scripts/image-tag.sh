#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

branch="${1:-}"
custom="${2:-}"
if [[ -n "$custom" ]]; then
    tag="$custom"
else
    tag="$(printf '%s' "$branch" | sed -E 's/[^a-zA-Z0-9_.-]+/-/g; s/^[.-]+//; s/[.-]+$//')"
    tag="${tag:0:128}"
fi
if [[ ! "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
    echo "Invalid Docker image tag." >&2
    exit 1
fi
if [[ "${tag,,}" == latest || "$tag" =~ ^v?[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
    echo "Tag '$tag' is reserved for the release workflow." >&2
    exit 1
fi
printf '%s\n' "$tag"
