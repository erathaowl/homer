#!/usr/bin/env bash
set -euo pipefail

tag="${1:-}"
if [[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$ ]]; then
    printf 'v%s.%s.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[4]:-0}"
else
    echo "Invalid release tag: $tag (expected vX.Y or vX.Y.Z)" >&2
    exit 1
fi
