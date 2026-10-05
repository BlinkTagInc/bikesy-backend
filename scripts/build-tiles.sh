#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'This release requires the regional admin, graph, access and stair gates.' 'Use scripts/rebuild-variant.py inside the pinned isolated toolchain; see docs/DATA.md.' >&2
exit 1
