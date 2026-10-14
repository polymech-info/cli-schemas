#!/usr/bin/env sh
# Forward every argument to generate-cli-schema.mjs.
#   ./generate-cli-schema.sh ffmpeg
#   ./generate-cli-schema.sh ffmpeg --no-web
#   ./generate-cli-schema.sh ffmpeg --stamp-groups
set -eu
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$dir/generate-cli-schema.mjs" "$@"
